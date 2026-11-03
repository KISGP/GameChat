import { trackError } from '@renderer/app/telemetry'

/**
 * @description 从 IPC 错误中提取适合在语音控件中展示的短文本。
 * @param error TTS IPC 或浏览器音频播放产生的异常。
 * @returns 去除 Electron IPC 前缀后的错误信息。
 */
export function getTtsErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method ['"][^'"]+['"]: Error:\s*/u, '')
}

/**
 * @description 记录自动语音合成失败，供日志查看器排查语音输出链路。
 * @param messageId 合成失败的消息标识。
 * @param error 合成过程抛出的异常。
 */
export function trackAutoTtsFailure(messageId: string, error: unknown): void {
  trackError(
    'voice-auto-synthesize-failed',
    'Failed to auto-synthesize voice for chat message',
    error,
    { messageId }
  )
}
