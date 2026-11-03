import type { CharacterLocalizedText } from './types'

/**
 * @description 将任意时间戳文本规范化为 ISO 时间。
 * @param value 原始时间戳文本。
 * @returns ISO 时间字符串；输入为空或无法解析时返回 null。
 */
export function normalizeCharacterVersion(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }

  const normalizedDate = new Date(value)
  if (Number.isNaN(normalizedDate.getTime())) {
    return null
  }

  return normalizedDate.toISOString()
}

/**
 * @description 从多语言文本块中挑选展示文本。
 * @param value 多语言文本块。
 * @param fallback 全部语言缺失时使用的回退文本。
 * @returns 中文、英文、日文依次优先的第一个非空文本。
 */
export function pickDisplayText(value: CharacterLocalizedText | undefined, fallback = ''): string {
  return value?.cn?.trim() || value?.en?.trim() || value?.jp?.trim() || fallback
}
