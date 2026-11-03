import { createHash } from 'crypto'
import { mkdir, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import type { TtsConnectionTestResult, TtsSynthesisRequest, TtsSynthesisResult, TtsVoiceReadiness } from '@gamechat/type'
import { FishTtsProviderSettings, LocalTtsProviderSettings, TtsProvider } from '@gamechat/type'
import { AppError } from '../errors/AppError'
import { logger } from '../logging/index'
import { getCharacterTtsVoicePath } from '../characters/paths'
import { getTtsAudioRoot } from './paths'
import { assertPathSegment, readResponseCapped, replaceFileAtomic } from '@gamechat/core'
import { request } from '@gamechat/core'
import { getCharacterSettings, getCharacterTtsFishPreset } from '../characters/index'
import { getAppSettings } from '../settings/app-settings'
import { resolveFishCharacterReferenceId } from '@gamechat/schema'
import { getTtsAudioUrl } from './protocol'
import { normalizeTextForTts } from './text-normalizer'
import { IndexTtsEngine } from './local/index-tts'

const TTS_PROFILE_VERSION = 'index-tts-v1'
const FISH_TTS_ENDPOINT = 'https://api.fish.audio/v1/tts'
const MAX_TTS_TEXT_LENGTH = 500

type AudioExtension = 'mp3' | 'wav'
type ActiveSynthesis = {
  requestId: string
  controller: AbortController
  cancelled: boolean
}

/**
 * @description 合成前提解析结果：provider 分支判断与引擎调用所需的全部解析产物。
 */
type TtsSynthesisPreconditions = {
  // 当前生效的 TTS provider。
  provider: TtsProvider
  // 当前 provider 的模型标识，参与缓存键。
  model: string
  // 当前 provider 的音色标识；local 固定为角色 ID，fish 为解析后的 referenceId。
  referenceId: string
  // local provider 的角色参考音色文件路径；fish 恒为空字符串。
  voicePath: string
  // fish provider 的完整配置；仅 synthesize 引擎调用使用。
  fishSettings: FishTtsProviderSettings
  // local provider 的完整配置；仅 synthesize 引擎调用使用。
  localSettings: LocalTtsProviderSettings
}

/**
 * @description 校验来自渲染进程的 TTS 合成请求。
 */
function validateSynthesisRequest(request: TtsSynthesisRequest): string {
  const text = request.text.trim()
  if (!request.requestId.trim() || !request.messageId.trim() || !request.characterId.trim()) {
    throw new AppError('TTS_RUNTIME_ERROR', 'TTS synthesis request is missing identifiers', {
      safeMessage: '语音请求无效，请重试。'
    })
  }
  if (!text) {
    throw new AppError('TTS_RUNTIME_ERROR', 'TTS synthesis request contains empty text', {
      safeMessage: '没有可合成的文本。'
    })
  }
  if (text.length > MAX_TTS_TEXT_LENGTH) {
    throw new AppError(
      'TTS_RUNTIME_ERROR',
      `TTS synthesis text exceeds ${MAX_TTS_TEXT_LENGTH} characters`,
      {
        safeMessage: `单次语音合成不能超过 ${MAX_TTS_TEXT_LENGTH} 个字符。`
      }
    )
  }
  return text
}

/**
 * @description 为 provider、音色、模型和输入文本生成稳定的缓存文件名。
 * @param text 已规范化的待合成文本。
 * @param provider TTS provider 标识。
 * @param model 当前 provider 的模型标识。
 * @param referenceId 当前 provider 的音色标识。
 * @param extension 缓存音频扩展名。
 * @returns 不含目录的缓存文件名。
 */
function createCacheFileName(
  text: string,
  provider: string,
  model: string,
  referenceId: string,
  extension: AudioExtension
): string {
  const cacheKey = [provider, model, referenceId, TTS_PROFILE_VERSION, text].join('\n')
  return `${createHash('sha256').update(cacheKey).digest('hex')}.${extension}`
}

/**
 * @description 判断候选路径是否为非空的音频缓存文件。
 * @param filePath 候选音频文件路径。
 * @param minimumSize 最小有效文件大小。
 * @returns 文件存在且超过最小长度时返回 true。
 */
async function isUsableAudio(filePath: string, minimumSize: number): Promise<boolean> {
  try {
    const fileStat = await stat(filePath)
    return fileStat.isFile() && fileStat.size > minimumSize
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      await logger.warn('tts', 'tts-cache-stat-failed', 'Failed to inspect cached TTS audio', {
        filePath,
        error: error instanceof Error ? error.message : String(error)
      })
    }
    return false
  }
}

/**
 * @description 调用 Fish Audio HTTP TTS 端点并将返回的 MP3 写入临时文件。
 * @param apiKey Fish Audio 的 API Key。
 * @param model Fish Audio TTS 模型标识。
 * @param referenceId Fish Audio 音色模型标识。
 * @param text 已规范化的待合成文本。
 * @param outputPath 要写入的临时音频路径。
 * @param controller 用于取消 HTTP 请求的控制器。
 * @returns 成功时临时文件已完整写入。
 */
async function runFishAudio(
  apiKey: string,
  model: string,
  referenceId: string,
  text: string,
  outputPath: string,
  controller: AbortController
): Promise<void> {
  let response: Response
  try {
    response = await request(FISH_TTS_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', model },
      body: JSON.stringify({
        text,
        reference_id: referenceId,
        format: 'mp3',
        latency: 'balanced',
        normalize: true
      }),
      signal: controller.signal,
      timeoutMs: null,
      allowErrorStatus: true
    })
  } catch (error) {
    if (controller.signal.aborted) {
      throw new AppError('TTS_RUNTIME_ERROR', 'Fish Audio synthesis was cancelled', {
        safeMessage: '已停止语音合成。',
        cause: error
      })
    }
    throw new AppError('NETWORK_ERROR', 'Failed to reach Fish Audio TTS endpoint', {
      safeMessage: '无法连接在线语音服务，请检查网络连接。',
      cause: error
    })
  }
  if (!response.ok) {
    throw new AppError('TTS_RUNTIME_ERROR', `Fish Audio returned HTTP ${response.status}`, {
      details: { status: response.status, statusText: response.statusText },
      safeMessage:
        response.status === 402
          ? 'Fish Audio 当前模型需要可用额度。请充值，或在设置中选择 s2.1-pro-free。'
          : '在线语音服务拒绝了请求，请检查 API Key、模型和音色设置。'
    })
  }
  if (controller.signal.aborted) {
    throw new AppError('TTS_RUNTIME_ERROR', 'Fish Audio synthesis was cancelled', {
      safeMessage: '已停止语音合成。'
    })
  }
  try {
    const audio = await readResponseCapped(response, { url: FISH_TTS_ENDPOINT })
    await writeFile(outputPath, audio)
  } catch (error) {
    if (controller.signal.aborted) {
      throw new AppError('TTS_RUNTIME_ERROR', 'Fish Audio synthesis was cancelled', {
        safeMessage: '已停止语音合成。',
        cause: error
      })
    }
    throw new AppError('NETWORK_ERROR', 'Failed to read Fish Audio response body', {
      safeMessage: '在线语音服务响应中断，请重试。',
      cause: error
    })
  }
}

/**
 * @description 管理本地引擎和 Fish Audio 合成、缓存与取消操作。
 * @remarks 服务进程范围内只允许一个合成任务；本地引擎实例按服务地址常驻，
 *   使引擎内部的参考音频上传缓存可以跨请求复用。
 */
class TtsService {
  private active: ActiveSynthesis | null = null
  /** 按引擎服务地址常驻的本地引擎实例。 */
  private readonly localEngines = new Map<string, IndexTtsEngine>()

  /**
   * @description 获取指定本地配置对应的引擎实例，缺失时创建并常驻。
   * @param settings 本地 provider 的完整配置。
   * @returns 与服务地址绑定的本地引擎。
   * @remarks 键为 index-tts 服务地址：配置改址后自然取到新引擎，无需显式失效钩子。
   */
  private getLocalEngine(settings: LocalTtsProviderSettings): IndexTtsEngine {
    const baseUrl = settings.engineConfigs.indexTts.baseUrl
    let engine = this.localEngines.get(baseUrl)
    if (!engine) {
      engine = new IndexTtsEngine(baseUrl)
      this.localEngines.set(baseUrl, engine)
    }
    return engine
  }

  /**
   * @description 解析当前 provider 下指定角色完成合成所需的全部前提，不满足时抛出带安全提示的应用错误。
   * @param characterId 目标角色标识。
   * @returns provider、模型、音色标识与本地音色路径。
   * @remarks 同时服务于 synthesize 与 checkVoiceReadiness，保证就绪判定与真实合成校验一致。
   */
  private async resolveSynthesisPreconditions(
    characterId: string
  ): Promise<TtsSynthesisPreconditions> {
    const appSettings = await getAppSettings()
    if (!appSettings.tts.enabled) {
      throw new AppError('TTS_RUNTIME_ERROR', 'TTS is disabled', { safeMessage: '语音尚未启用。' })
    }
    const isFishProvider = appSettings.tts.provider === 'fish'
    const fishSettings = appSettings.tts.providers.fish
    const localSettings = appSettings.tts.providers.local
    const model = isFishProvider
      ? fishSettings.model
      : `${localSettings.engine}:${localSettings.engineConfigs.indexTts.baseUrl}`
    const characterSettings = isFishProvider ? await getCharacterSettings(characterId) : null
    const repoPreset = isFishProvider ? await getCharacterTtsFishPreset(characterId) : undefined
    const referenceId = isFishProvider
      ? resolveFishCharacterReferenceId(characterSettings?.tts || {}, repoPreset)
      : characterId
    if (isFishProvider && (!fishSettings.apiKey || !referenceId)) {
      throw new AppError('TTS_RUNTIME_ERROR', 'Fish Audio credentials are incomplete', {
        safeMessage: referenceId
          ? '请先配置 Fish Audio API Key。'
          : '请先为当前角色配置 Fish Audio 音色 ID。'
      })
    }
    const voicePath = isFishProvider ? '' : getCharacterTtsVoicePath(characterId)
    if (!isFishProvider && !(await isUsableAudio(voicePath, 44))) {
      throw new AppError('TTS_RUNTIME_ERROR', 'Index-TTS character voice is unavailable', {
        safeMessage: '请先下载当前角色的 index-tts 音色。'
      })
    }
    return {
      provider: appSettings.tts.provider,
      model,
      referenceId,
      voicePath,
      fishSettings,
      localSettings
    }
  }

  /**
   * @description 检查指定角色在当前 provider 下是否具备语音合成前提。
   * @param characterId 目标角色标识。
   * @returns 就绪检查结果；失败时 reason 携带可直接展示的原因。
   * @remarks 供聊天发送前预检使用；只做本地状态判定，不发起网络请求，也不校验引擎在线状态。
   */
  async checkVoiceReadiness(characterId: string): Promise<TtsVoiceReadiness> {
    if (!characterId.trim()) {
      return { ok: false, reason: '语音就绪检查请求无效。' }
    }
    try {
      assertPathSegment(characterId, 'TTS voice readiness character identifier')
    } catch {
      return { ok: false, reason: '语音就绪检查请求无效。' }
    }
    try {
      await this.resolveSynthesisPreconditions(characterId)
      return { ok: true }
    } catch (error) {
      if (error instanceof AppError) {
        return { ok: false, reason: error.safeMessage }
      }
      await logger.warn(
        'tts',
        'tts-readiness-check-failed',
        'Failed to check TTS voice readiness',
        {
          characterId,
          error: error instanceof Error ? error.message : String(error)
        }
      )
      return { ok: false, reason: '语音就绪检查失败，请稍后重试。' }
    }
  }

  /**
   * @description 根据当前 provider 合成文本并返回可播放音频地址。
   * @param request 来自受控 IPC 的消息合成请求。
   * @returns 已生成或命中缓存的音频地址。
   */
  async synthesize(request: TtsSynthesisRequest): Promise<TtsSynthesisResult> {
    const requestedText = validateSynthesisRequest(request)
    const { text } = normalizeTextForTts(requestedText)
    if (this.active) {
      throw new AppError('TTS_RUNTIME_ERROR', 'A TTS synthesis task is already running', {
        details: { activeRequestId: this.active.requestId },
        safeMessage: '另一条语音正在生成，请稍候。'
      })
    }
    const { provider, model, referenceId, voicePath, fishSettings, localSettings } =
      await this.resolveSynthesisPreconditions(request.characterId)
    const isFishProvider = provider === 'fish'
    await mkdir(getTtsAudioRoot(), { recursive: true })
    const extension: AudioExtension = isFishProvider ? 'mp3' : 'wav'
    const cacheFileName = createCacheFileName(text, provider, model, referenceId, extension)
    const outputPath = join(getTtsAudioRoot(), cacheFileName)
    if (await isUsableAudio(outputPath, isFishProvider ? 128 : 44)) {
      return { audioUrl: getTtsAudioUrl(cacheFileName), cacheHit: true }
    }
    const temporaryPath = join(getTtsAudioRoot(), `${request.requestId}.tmp.${extension}`)
    const active: ActiveSynthesis = {
      requestId: request.requestId,
      controller: new AbortController(),
      cancelled: false
    }
    this.active = active
    try {
      if (isFishProvider) {
        await runFishAudio(
          fishSettings.apiKey,
          model,
          referenceId,
          text,
          temporaryPath,
          active.controller
        )
      } else {
        await this.getLocalEngine(localSettings).synthesize({
          text,
          voicePath,
          outputPath: temporaryPath,
          signal: active.controller.signal
        })
      }
      if (!(await isUsableAudio(temporaryPath, isFishProvider ? 128 : 44))) {
        throw new AppError('TTS_RUNTIME_ERROR', 'TTS provider returned no usable audio', {
          safeMessage: '语音合成未生成有效音频。'
        })
      }
      await replaceFileAtomic(temporaryPath, outputPath)
      return { audioUrl: getTtsAudioUrl(cacheFileName), cacheHit: false }
    } finally {
      if (this.active?.requestId === request.requestId) this.active = null
      try {
        await rm(temporaryPath, { force: true })
      } catch (error) {
        await logger.warn(
          'tts',
          'tts-temp-cleanup-failed',
          'Failed to remove temporary TTS audio',
          {
            requestId: request.requestId,
            temporaryPath,
            error: error instanceof Error ? error.message : String(error)
          }
        )
      }
    }
  }

  /**
   * @description 请求停止指定的正在运行的 TTS 合成任务。
   * @param requestId 渲染进程创建的合成请求标识。
   * @returns 是否找到了并停止了对应任务。
   */
  cancel(requestId: string): boolean {
    if (!requestId.trim() || this.active?.requestId !== requestId) return false
    this.active.cancelled = true
    this.active.controller.abort()
    return true
  }

  /**
   * @description 测试当前本地 TTS 引擎的 HTTP 服务是否可访问。
   * @returns 可展示给用户的连接成功说明。
   */
  async testLocalEngineConnection(): Promise<TtsConnectionTestResult> {
    const settings = await getAppSettings()
    return { message: await this.getLocalEngine(settings.tts.providers.local).testConnection() }
  }

  /**
   * @description 停止应用退出时仍在运行的 TTS 任务。
   */
  shutdown(): void {
    if (!this.active) return
    this.active.cancelled = true
    this.active.controller.abort()
  }
}

let ttsServiceInstance: TtsService | null = null

/**
 * @description 获取进程内共享的 TTS 服务。
 * @returns 惰性构造并缓存的 TtsService 单例。
 * @remarks import 本模块零副作用；服务在首次获取时才构造。
 */
export function getTtsService(): TtsService {
  if (!ttsServiceInstance) {
    ttsServiceInstance = new TtsService()
  }
  return ttsServiceInstance
}
