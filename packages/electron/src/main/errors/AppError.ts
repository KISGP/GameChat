import type { AppErrorCode } from './error-codes'

export type AppErrorOptions = {
  cause?: unknown
  details?: Record<string, unknown>
  safeMessage?: string
}

/**
 * @description 表示主进程中可被统一监控、序列化和安全展示的应用错误。
 * @remarks `message` 可能包含调试上下文，跨 IPC 返回给渲染器时应优先使用 `safeMessage`。
 */
export class AppError extends Error {
  readonly code: AppErrorCode
  readonly details?: Record<string, unknown>
  readonly safeMessage: string

  /**
   * @description 创建带错误码的应用错误；未提供安全提示时以 message 作为 safeMessage。
   * @param code 错误码，用于日志聚合和调用方判断。
   * @param message 面向开发者和日志的错误信息。
   * @param options 可选的原始错误、结构化详情和面向用户的安全提示。
   */
  constructor(code: AppErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause })
    this.name = 'AppError'
    this.code = code
    this.details = options.details
    this.safeMessage = options.safeMessage ?? message
  }
}
