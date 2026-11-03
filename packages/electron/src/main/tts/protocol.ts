import { net, protocol } from 'electron'
import type { CustomScheme } from 'electron'
import { constants } from 'fs'
import { access } from 'fs/promises'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { logger } from '../logging/index'
import { getTtsAudioRoot } from './paths'

const TTS_AUDIO_SCHEME = 'gamechat-tts'
const TTS_AUDIO_HOST = 'audio'
const TTS_CACHE_FILE_NAME_PATTERN = /^[a-f0-9]{64}\.(?:mp3|wav)$/u

/**
 * @description TTS 音频协议向 Chromium 声明的特权描述，由应用启动链在 ready 之前与其他域的协议声明合并后一次性注册。
 * @remarks stream 与 bypassCSP 是 HTML 媒体元素加载自定义协议资源所需的权限；特权注册在进程内只允许执行一次，因此本模块只提供声明。
 */
export const privilegedTtsAudioScheme: CustomScheme = {
  scheme: TTS_AUDIO_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    corsEnabled: true,
    stream: true,
    supportFetchAPI: true,
    bypassCSP: true
  }
}

/**
 * @description 为缓存音频注册受限的自定义协议处理器。
 * @remarks 仅允许固定 SHA-256 文件名，避免 renderer 通过 URL 读取任意本地文件。
 *   参考音色的试听不走本协议：媒体元素与 fetch 对自定义协议地址均受限，
 *   音色字节经 IPC 直传渲染层转 blob 播放（见 tts:getCharacterVoiceData）。
 */
export function registerTtsAudioProtocol(): void {
  protocol.handle(TTS_AUDIO_SCHEME, async (request) => {
    const url = new URL(request.url)
    const fileName = url.pathname.slice(1)

    if (url.host !== TTS_AUDIO_HOST || !TTS_CACHE_FILE_NAME_PATTERN.test(fileName)) {
      await logger.warn('tts', 'tts-audio-request-rejected', 'Rejected invalid TTS audio request', {
        url: request.url
      })
      return new Response('Not found', { status: 404 })
    }

    const filePath = join(getTtsAudioRoot(), fileName)
    try {
      await access(filePath, constants.R_OK)
      const response = await net.fetch(pathToFileURL(filePath).toString())
      await logger.info('tts', 'tts-audio-served', 'Served synthesized TTS audio', {
        fileName,
        status: response.status
      })
      return response
    } catch (error) {
      await logger.error('tts', 'tts-audio-serve-failed', 'Failed to serve synthesized TTS audio', {
        fileName,
        error: error instanceof Error ? error.message : String(error)
      })
      return new Response('Not found', { status: 404 })
    }
  })
}

/**
 * @description 为缓存文件名构造 renderer 可使用的受限音频地址。
 * @param fileName 已由主进程生成的 SHA-256 WAV 文件名。
 * @returns TTS 自定义协议 URL。
 */
export function getTtsAudioUrl(fileName: string): string {
  return `${TTS_AUDIO_SCHEME}://${TTS_AUDIO_HOST}/${fileName}`
}
