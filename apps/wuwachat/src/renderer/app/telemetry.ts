import type { RendererLogEventPayload } from '@gamechat/type'
import { track } from '@renderer/services/logs'

/**
 * @description 记录 renderer 中发生的用户界面事件。
 * @param event 事件名称。
 * @param message 事件说明。
 * @param context 可选的结构化上下文。
 * @returns 无返回值。
 * @remarks 日志写入以非阻塞方式发起，调用方无需等待其完成；未指定级别时以 info 级落盘。
 */
export function trackUiEvent(
  event: string,
  message: string,
  context?: RendererLogEventPayload['context']
): void {
  void track({
    source: 'renderer',
    event,
    message,
    context
  })
}

/**
 * @description 记录 renderer 中发生的错误，使失败现场进入应用日志查看器可读的日志流。
 * @param event 事件名称。
 * @param message 错误说明。
 * @param error 捕获到的未知错误值。
 * @param context 可选的结构化上下文。
 * @returns 无返回值。
 * @remarks 日志以 error 级写入，与界面错误提示的严重级别对应；写入以非阻塞方式发起，
 *   错误值规范化为消息字符串后并入上下文，不向调用方抛出。
 */
export function trackError(
  event: string,
  message: string,
  error: unknown,
  context?: RendererLogEventPayload['context']
): void {
  void track({
    source: 'renderer',
    level: 'error',
    event,
    message,
    context: {
      ...context,
      error: error instanceof Error ? error.message : String(error)
    }
  })
}
