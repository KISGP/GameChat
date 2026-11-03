/**
 * @description 清理 IPC 错误中的远程调用前缀，生成适合记录和展示的错误文本。
 * @param error IPC 调用过程中捕获的异常。
 * @returns 去除 IPC 包装前缀后的错误消息。
 */
export function getIpcErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method ['"][^'"]+['"]: Error:\s*/u, '')
}
