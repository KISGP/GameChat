import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { ModelProvider } from '@gamechat/type'

/**
 * @description 合并条件类名并使用 Tailwind 冲突规则生成最终类名。
 * @param inputs 待合并的类名值。
 * @returns 合并后的类名字符串。
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * @description 根据接入格式和连接凭据生成稳定的连接指纹。
 * @param provider 待生成指纹的供应商配置。
 * @returns 用于比较连接配置是否变化的指纹字符串。
 */
export function connectionFingerprint(provider: ModelProvider): string {
  return [provider.apiFormat, provider.baseUrl.trim(), provider.apiKey.trim()].join('\n')
}

/**
 * @description 判断字符串是否为 HTTP 或 HTTPS URL。
 * @param value 待校验的 URL 字符串。
 * @returns URL 格式有效且协议受支持时返回 true。
 */
export function isValidUrl(value: string): boolean {
  if (!value.trim()) return false

  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * @description 将字节数转换为便于阅读的体积字符串。
 * @param sizeBytes 字节数。
 * @returns 格式化后的体积文案。
 */
export function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`
  if (sizeBytes < 1024 * 1024 * 1024) return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
