import { CharacterDownloadProgress, CharacterRegistry } from '@gamechat/type'
import { CharacterSettings } from '@gamechat/type'

/**
 * @description 读取当前角色注册表。
 * @returns 包含本地和远程角色状态的注册表 Promise。
 */
export function getCharacterRegistry(): Promise<CharacterRegistry> {
  return window.characters.getCharacterRegistry()
}

/**
 * @description 更新本地角色在聊天页角色栏中的可见状态。
 * @param characterId 需要更新的本地角色标识。
 * @param visible 是否在聊天页角色栏显示该角色。
 * @returns 更新后的角色注册表 Promise。
 */
export function setCharacterVisibility(
  characterId: string,
  visible: boolean
): ReturnType<typeof window.characters.setCharacterVisibility> {
  return window.characters.setCharacterVisibility(characterId, visible)
}

/**
 * @description 更新本地角色在聊天页侧栏中的置顶状态。
 * @param characterId 需要更新的本地角色标识。
 * @param pinned 是否将该角色置顶。
 * @returns 更新后的角色注册表 Promise。
 */
export function setCharacterPinned(
  characterId: string,
  pinned: boolean
): ReturnType<typeof window.characters.setCharacterPinned> {
  return window.characters.setCharacterPinned(characterId, pinned)
}

/**
 * @description 读取角色级用户配置。
 */
export function getCharacterSettings(characterId: string): Promise<CharacterSettings> {
  return window.characters.getCharacterSettings(characterId)
}

/**
 * @description 更新角色 Fish Audio 音色覆盖。
 */
export function setCharacterFishVoice(
  characterId: string,
  referenceId: string
): Promise<CharacterSettings> {
  return window.characters.setCharacterFishVoice(characterId, referenceId)
}

/**
 * @description 将远端角色加入下载或更新队列。
 */
export function downloadCharacter(
  characterId: string
): ReturnType<typeof window.characters.downloadCharacter> {
  return window.characters.downloadCharacter(characterId)
}

/**
 * @description 取消尚未开始的角色下载任务。
 */
export function cancelCharacterDownload(
  characterId: string
): ReturnType<typeof window.characters.cancelCharacterDownload> {
  return window.characters.cancelCharacterDownload(characterId)
}

/**
 * @description 删除本地角色：撤出下载队列并将角色目录移入系统回收站，可选同时删除名下会话。
 * @param characterId 待删除的本地角色标识。
 * @param deleteSessions 是否同时删除该角色名下的全部会话。
 * @returns 删除后的角色注册表 Promise。
 */
export function deleteCharacter(
  characterId: string,
  deleteSessions: boolean
): ReturnType<typeof window.characters.deleteCharacter> {
  return window.characters.deleteCharacter(characterId, deleteSessions)
}
/**
 * @description 订阅角色注册表变更。
 * @param listener 接收最新角色注册表的回调。
 * @returns 用于取消订阅的清理函数。
 * @remarks 调用方应在不再需要同步时执行返回的清理函数。
 */
export function onRegistryChanged(
  listener: (registry: CharacterRegistry) => void
): ReturnType<typeof window.characters.onRegistryChanged> {
  return window.characters.onRegistryChanged(listener)
}

/**
 * @description 订阅角色下载字节进度。
 * @param listener 接收进度快照的回调。
 * @returns 用于取消订阅的清理函数。
 * @remarks 调用方应在不再需要同步时执行返回的清理函数。
 */
export function onCharacterDownloadProgress(
  listener: (progress: CharacterDownloadProgress) => void
): ReturnType<typeof window.characters.onDownloadProgress> {
  return window.characters.onDownloadProgress(listener)
}
/**
 * @description 触发一次远端角色同步并返回最新注册表。
 * @returns 同步完成后的角色注册表 Promise。
 */
export function syncNowCharacters(): Promise<CharacterRegistry> {
  return window.characters.syncNow()
}
