/**
 * @description 角色表情元数据校验与路径解析。
 * @remarks 索引与本地 info.json 的 file 允许携带 emoticons/ 目录前缀，统一归一为
 *   emoticons 目录下的裸文件名；下载、落盘与读取契约都按裸文件名表达。
 */
import { isAbsolute, join } from 'path'
import { isPathSegment } from '../infra/path'
import type { ChatEmoticonDefinition } from '@gamechat/schema'
import { getCharacterDirectoryPath } from './paths'

/**
 * @description 将角色表情文件名解析到角色表情目录。
 * @param appDataRoot 应用数据根目录。
 * @param characterId 角色标识。
 * @param file 表情文件名。
 * @returns 角色表情文件的绝对路径。
 */
export function resolveEmoticonPath(appDataRoot: string, characterId: string, file: string): string {
  return join(
    getCharacterDirectoryPath(appDataRoot, characterId),
    'emoticons',
    normalizeEmoticonFile(file)
  )
}

/**
 * @description 规范化角色表情文件的相对路径。
 * @param file 表情文件相对路径。
 * @returns 使用正斜杠分隔的安全 PNG 路径。
 * @throws 路径为空、绝对路径、含非法段或非 PNG 时抛出。
 */
export function normalizeEmoticonFile(file: string): string {
  const normalized = file.replaceAll('\\', '/').trim()
  if (!normalized || normalized.startsWith('/') || isAbsolute(normalized)) {
    throw new Error('Invalid character emoticon file path')
  }
  const parts = normalized.split('/')
  if (parts.some((part) => !isPathSegment(part))) {
    throw new Error('Invalid character emoticon file path')
  }
  if (!normalized.toLowerCase().endsWith('.png')) {
    throw new Error('Character emoticon files must be PNG images')
  }
  return normalized
}

/**
 * @description 校验角色表情元数据及其文件路径，并把 file 归一为裸文件名。
 * @param definitions 待校验的表情定义数组。
 * @returns file 归一为裸文件名、以文件名派生 ID 的表情定义数组。
 * @remarks 任一定义非法即抛出错误，由调用方决定整份跳过还是降级处理。
 */
export function validateEmoticonDefinitions(definitions: unknown): ChatEmoticonDefinition[] {
  if (definitions === undefined) return []
  if (!Array.isArray(definitions)) throw new Error('Character emoticons must be an array')
  const ids = new Set<string>()
  return definitions.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error('Emoticon definition must be an object')
    }
    const value = entry as Record<string, unknown>
    const description =
      typeof value.description === 'string' ? value.description.trim() : ''
    if (!description) {
      throw new Error('Emoticon description is required')
    }
    const file = normalizeEmoticonFile(
      typeof value.file === 'string' ? value.file.replace(/^emoticons\//u, '') : ''
    )
    const id = file
    if (ids.has(id)) {
      throw new Error(`Duplicate emoticon file: ${file}`)
    }
    ids.add(id)
    return { id, description, file }
  })
}
