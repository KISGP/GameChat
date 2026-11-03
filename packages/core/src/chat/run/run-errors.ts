/**
 * @description 判断错误是否为取消导致的中断。
 * @param error 待检查错误。
 * @returns 中断错误返回 true。
 */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/**
 * @description 将未知错误转换为可展示文本。
 * @param error 待转换错误。
 * @returns 错误消息文本。
 */
export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
