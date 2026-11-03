import { AppError } from './AppError'
import { normalizeError, toErrorStack } from './normalize-error'
import type { AppErrorCode } from './error-codes'

export type SerializedAppError = {
  name: string
  code: AppErrorCode
  message: string
  safeMessage: string
  details?: Record<string, unknown>
  stack?: string
}

/**
 * @description 将任意异常转换成可记录到日志中的纯对象。
 * @param error 任意异常值。
 * @param fallbackCode 无法识别错误类型时使用的错误码。
 * @returns 可序列化的错误对象。
 */
export function serializeError(
  error: unknown,
  fallbackCode: AppErrorCode = 'UNKNOWN_ERROR'
): SerializedAppError {
  const normalized = normalizeError(error, fallbackCode)

  return {
    name: normalized instanceof AppError ? normalized.name : 'Error',
    code: normalized.code,
    message: normalized.message,
    safeMessage: normalized.safeMessage,
    details: normalized.details,
    stack: toErrorStack(error)
  }
}
