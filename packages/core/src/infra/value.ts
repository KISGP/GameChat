/**
 * @description core 配置值校验原语。
 */

/**
 * @description 去除字符串前后空白并要求结果非空，用于校验必填配置项。
 * @param value 待校验的字符串。
 * @param label 错误消息中标识该值的名称。
 * @returns 去除前后空白后的字符串。
 * @throws 值为空或只含空白时抛出带 label 的错误。
 */
export function requireValue(value: string, label: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`${label} is required`)
  }

  return trimmed
}
