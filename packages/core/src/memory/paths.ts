/**
 * @description 记忆域路径布局：每角色一份 Markdown 与版本快照的定位。
 */
import { join } from 'path'

/**
 * @description 返回记忆存储根目录。
 * @param appDataRoot 应用数据根目录。
 * @returns 记忆根目录。
 */
export function getMemoryRoot(appDataRoot: string): string {
  return join(appDataRoot, 'memory')
}

/**
 * @description 返回角色记忆 Markdown 文件路径。
 * @param appDataRoot 应用数据根目录。
 * @param characterId 角色标识。
 * @returns 记忆文件路径。
 */
export function getCharacterMemoryFilePath(appDataRoot: string, characterId: string): string {
  return join(getMemoryRoot(appDataRoot), `${characterId}.md`)
}

/**
 * @description 返回角色记忆版本快照目录。
 * @param appDataRoot 应用数据根目录。
 * @param characterId 角色标识。
 * @returns 版本目录路径。
 */
export function getMemoryVersionsRoot(appDataRoot: string, characterId: string): string {
  return join(getMemoryRoot(appDataRoot), 'versions', characterId)
}
