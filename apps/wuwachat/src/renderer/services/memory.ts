import { MemorySettingsStore } from '@gamechat/type'
/**
 * @description 读取记忆设置。
 * @returns 当前长期记忆设置快照的 Promise。
 */
export function getSettings(): ReturnType<typeof window.memory.getSettings> {
  return window.memory.getSettings()
}
/**
 * @description 保存记忆设置。
 * @param settings 要持久化的完整长期记忆设置。
 * @returns 主进程保存设置后的 Promise。
 */
export function saveSettings(
  settings: MemorySettingsStore
): ReturnType<typeof window.memory.saveSettings> {
  return window.memory.saveSettings(settings)
}
/**
 * @description 读取角色记忆 Markdown 全文。
 * @param characterId 角色 ID。
 * @returns 记忆全文的 Promise；尚无记忆时为空串。
 */
export function getMemoryMarkdown(
  characterId: string
): ReturnType<typeof window.memory.getMarkdown> {
  return window.memory.getMarkdown(characterId)
}
/**
 * @description 保存角色记忆 Markdown 全文。
 * @param characterId 角色 ID。
 * @param content 记忆全文。
 * @returns 保存后的记忆全文 Promise。
 */
export function saveMemoryMarkdown(
  characterId: string,
  content: string
): ReturnType<typeof window.memory.saveMarkdown> {
  return window.memory.saveMarkdown(characterId, content)
}
/**
 * @description 用系统默认应用打开记忆存储目录。
 * @returns 主进程打开动作完成的 Promise。
 */
export function openMemoryDirectory(): ReturnType<typeof window.memory.openDirectory> {
  return window.memory.openDirectory()
}
