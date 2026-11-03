import { logger } from './index'
import { serializeError } from '../errors/index'
import type { AppErrorCode } from '../errors/index'
import type { LogSource } from '@gamechat/type'

type ErrorMonitorInput = {
  scope: LogSource
  action: string
  message: string
  error: unknown
  code?: AppErrorCode
  context?: Record<string, unknown>
}

/**
 * @description 统一捕获主进程异常并写入结构化日志。
 * @param input 异常所属范围、动作、展示消息、原始错误和附加上下文。
 * @returns 可等待的日志写入 Promise。
 * @remarks 该函数只负责监控和日志，不吞掉异常；调用方仍决定是否继续抛出或降级。
 *   上下文与错误明细经 logger 统一脱敏后落盘，本函数不做二次处理。
 */
export async function captureError(input: ErrorMonitorInput): Promise<void> {
  const error = serializeError(input.error, input.code)
  await logger.error(input.scope, input.action, input.message, {
    ...(input.context ?? {}),
    error
  })
}
