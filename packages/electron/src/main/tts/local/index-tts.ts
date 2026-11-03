import { readFile, stat, writeFile } from 'fs/promises'
import { AppError } from '../../errors/AppError'
import { readResponseCapped } from '@gamechat/core'
import { request } from '@gamechat/core'

/** 一次本地 TTS 合成的输入。 */
export type LocalTtsSynthesisInput = {
  text: string
  voicePath: string
  outputPath: string
  signal: AbortSignal
}

const INDEX_TTS_TIMEOUT_MS = 120_000
const INDEX_TTS_UPLOAD_PATH = 'gradio_api/upload'
const INDEX_TTS_GENERATE_PATH = 'gradio_api/run/gen_single'

type GradioFileData = {
  path: string | null
  url?: string | null
  orig_name?: string | null
  mime_type?: string | null
  meta?: { _type: 'gradio.FileData' }
}

type GradioRunResponse = {
  data?: unknown
}

/**
 * @description 为 index-tts 的 Gradio 服务构建稳定的 API 地址。
 * @param baseUrl 用户配置的 index-tts 服务根地址。
 * @param path Gradio API 相对路径。
 * @returns 可请求的完整服务地址。
 */
function createEndpoint(baseUrl: string, path: string): string {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return new URL(path, normalizedBaseUrl).toString()
}

/**
 * @description 将未知响应值解析为 Gradio 返回的文件引用。
 * @param value Gradio 合成响应中第一个输出值。
 * @returns 可供下载音频的文件引用。
 */
function parseOutputFile(value: unknown): GradioFileData {
  const resolvedValue = unwrapGradioUpdate(value)
  if (typeof resolvedValue === 'string' && resolvedValue.trim()) {
    return { path: resolvedValue, url: null, meta: { _type: 'gradio.FileData' } }
  }

  if (!resolvedValue || typeof resolvedValue !== 'object') {
    throw new AppError('TTS_RUNTIME_ERROR', 'Index-TTS returned an invalid audio result', {
      safeMessage: 'index-tts 未返回有效音频。'
    })
  }

  const file = resolvedValue as Partial<GradioFileData>
  const path = typeof file.path === 'string' && file.path.trim() ? file.path : null
  const url = typeof file.url === 'string' && file.url.trim() ? file.url : null
  if (!path && !url) {
    throw new AppError(
      'TTS_RUNTIME_ERROR',
      'Index-TTS returned an audio result without a URL or path',
      {
        details: { outputKeys: Object.keys(file) },
        safeMessage: 'index-tts 未返回有效音频。'
      }
    )
  }

  return {
    path,
    url,
    orig_name: typeof file.orig_name === 'string' ? file.orig_name : null,
    mime_type: typeof file.mime_type === 'string' ? file.mime_type : null,
    meta: { _type: 'gradio.FileData' }
  }
}

/**
 * @description 解包 Gradio 在输出组件更新时包裹的 `value` 字段。
 * @param value `gen_single` 返回的原始输出值。
 * @returns 直接文件数据、文件路径或原始未知输出。
 */
function unwrapGradioUpdate(value: unknown): unknown {
  let current = value
  for (let depth = 0; depth < 3; depth += 1) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return current
    }

    const update = current as Record<string, unknown>
    if (update.__type__ !== 'update' || !('value' in update)) {
      return current
    }
    current = update.value
  }
  return current
}

/**
 * @description 将 index-tts 的默认推理参数编码为 Gradio 所需的有序输入数组。
 * @param voice 已上传的角色参考音色文件引用。
 * @param text 已规范化的待合成文本。
 * @returns `/gen_single` 使用的完整参数数组。
 */
function createGenerationInputs(voice: GradioFileData, text: string): unknown[] {
  return [
    'Same as the voice reference',
    voice,
    text,
    'ZH',
    null,
    0.65,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    '',
    false,
    120,
    1,
    true,
    0.8,
    30,
    0.8,
    0,
    3,
    10,
    1500
  ]
}

/**
 * @description 适配 IndexTTS-2.5 Gradio API 的本地 TTS 引擎。
 */
export class IndexTtsEngine {
  /** 音色上传引用缓存：音色文件未变化时复用服务端文件引用，避免每次合成重新上传。 */
  private uploadedVoice: {
    voicePath: string
    mtimeMs: number
    sizeBytes: number
    fileData: GradioFileData
  } | null = null

  /**
   * @description 创建绑定指定 Gradio 服务地址的 index-tts 引擎。
   * @param baseUrl 用户配置的 index-tts 服务根地址。
   */
  constructor(private readonly baseUrl: string) {}

  /**
   * @description 上传角色音色、调用 index-tts 合成，并将服务端音频保存到临时文件。
   * @param input 本次 index-tts 合成输入。
   * @remarks 合成失败即作废音色上传缓存；服务端重启丢失文件引用时，下一次合成会重新上传。
   */
  async synthesize(input: LocalTtsSynthesisInput): Promise<void> {
    try {
      const voice = await this.ensureVoiceUploaded(input.voicePath, input.signal)
      const response = await this.fetchWithTimeout(
        createEndpoint(this.baseUrl, INDEX_TTS_GENERATE_PATH),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: createGenerationInputs(voice, input.text) })
        },
        input.signal
      )
      const payload = (await response.json()) as GradioRunResponse
      const output = Array.isArray(payload.data) ? payload.data[0] : undefined
      const audio = parseOutputFile(output)
      const audioUrl = audio.url
        ? new URL(audio.url, this.baseUrl).toString()
        : audio.path
          ? this.createFileUrl(audio.path)
          : null
      if (!audioUrl) {
        throw new AppError('TTS_RUNTIME_ERROR', 'Index-TTS audio URL resolution failed', {
          safeMessage: 'index-tts 未返回有效音频。'
        })
      }
      const audioResponse = await this.fetchWithTimeout(audioUrl, {}, input.signal)
      await writeFile(input.outputPath, await readResponseCapped(audioResponse, { url: audioUrl }))
    } catch (error) {
      this.uploadedVoice = null
      throw error
    }
  }

  /**
   * @description 请求服务根地址，确认 index-tts HTTP 服务可访问。
   * @returns 可展示给用户的连接成功说明。
   */
  async testConnection(): Promise<string> {
    await this.fetchWithTimeout(this.baseUrl, {})
    return 'index-tts 服务连接成功。'
  }

  /**
   * @description 取得角色音色的 Gradio 服务端文件引用，音色未变化时复用上次上传结果。
   * @param voicePath 已下载角色音色的本地路径。
   * @param signal 当前合成的取消信号。
   * @returns Gradio 服务端保存的音色文件引用。
   * @remarks 以路径、修改时间与大小判别复用；引用失效由合成失败路径统一作废缓存。
   */
  private async ensureVoiceUploaded(
    voicePath: string,
    signal: AbortSignal
  ): Promise<GradioFileData> {
    const fileStat = await stat(voicePath)
    const cached = this.uploadedVoice
    if (
      cached &&
      cached.voicePath === voicePath &&
      cached.mtimeMs === fileStat.mtimeMs &&
      cached.sizeBytes === fileStat.size
    ) {
      return cached.fileData
    }
    const fileData = await this.uploadVoice(voicePath, signal)
    this.uploadedVoice = {
      voicePath,
      mtimeMs: fileStat.mtimeMs,
      sizeBytes: fileStat.size,
      fileData
    }
    return fileData
  }

  /**
   * @description 上传本地 WAV 文件并转换为 index-tts 可引用的 Gradio 文件数据。
   * @param voicePath 已下载角色音色的本地路径。
   * @param signal 当前合成的取消信号。
   * @returns Gradio 服务端保存的音色文件引用。
   */
  private async uploadVoice(voicePath: string, signal: AbortSignal): Promise<GradioFileData> {
    const form = new FormData()
    form.append('files', new Blob([await readFile(voicePath)], { type: 'audio/wav' }), 'TTS.wav')
    const response = await this.fetchWithTimeout(
      createEndpoint(this.baseUrl, INDEX_TTS_UPLOAD_PATH),
      { method: 'POST', body: form },
      signal
    )
    const payload = (await response.json()) as unknown
    const uploadedPath = Array.isArray(payload) ? payload[0] : undefined
    if (typeof uploadedPath !== 'string' || !uploadedPath.trim()) {
      throw new AppError('TTS_RUNTIME_ERROR', 'Index-TTS upload returned no file path', {
        safeMessage: 'index-tts 未能接收角色音色文件。'
      })
    }
    return {
      path: uploadedPath,
      orig_name: 'TTS.wav',
      mime_type: 'audio/wav',
      meta: { _type: 'gradio.FileData' }
    }
  }

  /**
   * @description 从 Gradio 返回的服务端文件路径构造可下载音频地址。
   * @param path Gradio 响应中的服务端文件路径。
   * @returns 指向 Gradio 文件端点的完整地址。
   */
  private createFileUrl(path: string): string {
    return createEndpoint(this.baseUrl, `gradio_api/file=${encodeURIComponent(path)}`)
  }

  /**
   * @description 在超时和取消约束下执行一次 index-tts HTTP 请求。
   * @param url 请求地址。
   * @param init 请求方法、请求头和请求体。
   * @param signal 可选的外部取消信号。
   * @returns 成功的 HTTP 响应。
   */
  private async fetchWithTimeout(
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: BodyInit },
    signal?: AbortSignal
  ): Promise<Response> {
    try {
      const response = await request(url, {
        method: init.method,
        headers: init.headers,
        body: init.body,
        signal,
        timeoutMs: INDEX_TTS_TIMEOUT_MS,
        allowErrorStatus: true
      })
      if (!response.ok) {
        throw new AppError('TTS_RUNTIME_ERROR', `Index-TTS returned HTTP ${response.status}`, {
          details: { status: response.status, statusText: response.statusText, url },
          safeMessage: 'index-tts 服务拒绝了请求，请检查服务状态和配置。'
        })
      }
      return response
    } catch (error) {
      if (error instanceof AppError) throw error
      if (signal?.aborted) {
        throw new AppError('TTS_RUNTIME_ERROR', 'Index-TTS request was cancelled or timed out', {
          cause: error,
          safeMessage: '已停止语音合成。'
        })
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AppError('TTS_RUNTIME_ERROR', 'Index-TTS request was cancelled or timed out', {
          cause: error,
          safeMessage: 'index-tts 请求超时，请检查服务状态。'
        })
      }
      throw new AppError('TTS_RUNTIME_ERROR', 'Failed to reach Index-TTS service', {
        cause: error,
        safeMessage: '无法连接 index-tts 服务，请检查地址和服务状态。'
      })
    }
  }
}
