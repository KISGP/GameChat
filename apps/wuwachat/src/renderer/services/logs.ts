import { RendererLogEventPayload } from '@gamechat/type'
/**
 * @description 记录一条 renderer 日志事件。
 * @param payload 包含事件名、消息和可选上下文的日志载荷。
 * @returns 主进程接收日志事件后的 Promise。
 */
export function track(payload: RendererLogEventPayload): ReturnType<typeof window.logs.track> {
  return window.logs.track(payload)
}
/**
 * @description 读取日志查看器状态。
 * @returns 日志目录和查看器可用状态的 Promise。
 */
export function getViewerState(): ReturnType<typeof window.logs.getViewerState> {
  return window.logs.getViewerState()
}
/**
 * @description 读取持久化日志内容。
 * @returns 当前持久化日志文本的 Promise。
 */
export function readLogs(): ReturnType<typeof window.logs.readLogs> {
  return window.logs.readLogs()
}
/**
 * @description 用系统默认文本编辑器打开当前日志文件。
 * @returns 主进程发起打开日志文件操作后的 Promise。
 */
export function openFile(): ReturnType<typeof window.logs.openFile> {
  return window.logs.openFile()
}
/**
 * @description 清除持久化日志。
 * @returns 主进程完成日志清理后的 Promise。
 */
export function clearLogs(): ReturnType<typeof window.logs.clearLogs> {
  return window.logs.clearLogs()
}
