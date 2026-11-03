import {
  cancelCharacterDownload,
  deleteCharacter,
  downloadCharacter,
  getCharacterRegistry,
  setCharacterVisibility,
  setCharacterPinned,
  getCharacterSettings,
  setCharacterFishVoice,
  synchronizeCharacters
} from '../characters'
import { assertCharacterChatDeletable, deleteCharacterChatData, whenChatReady } from '../chat'
import type { CharacterRegistry } from '@gamechat/type'
import { handleLogged } from './logged-handler'

/**
 * @description 执行删除角色流程：聊天域校验通过后可选清理会话，再将角色文件移入系统回收站。
 * @param characterId 待删除的本地角色标识。
 * @param deleteSessions 是否同时删除该角色名下的全部会话。
 * @returns 删除后的角色注册表。
 * @remarks 聊天域初始化未完成时在本流程入口等待；任一前置校验失败即整体失败，不产生部分删除。
 */
async function deleteCharacterEntry(
  characterId: string,
  deleteSessions: boolean
): Promise<CharacterRegistry> {
  await whenChatReady()
  assertCharacterChatDeletable(characterId)
  if (deleteSessions) {
    await deleteCharacterChatData(characterId)
  }
  return deleteCharacter(characterId)
}

/**
 * @description 注册角色相关 IPC：注册表查询与同步、下载/取消、删除、可见性、置顶以及角色声音设置。
 */
export function registerCharacterIpc(): void {
  handleLogged('character:getRegistry', () => getCharacterRegistry())
  handleLogged('character:syncNow', () => synchronizeCharacters())
  handleLogged(
    'character:setVisibility',
    (_event, characterId: string, visible: boolean) => setCharacterVisibility(characterId, visible),
    (characterId, visible) => ({ characterId, visible })
  )
  handleLogged(
    'character:setPinned',
    (_event, characterId: string, pinned: boolean) => setCharacterPinned(characterId, pinned),
    (characterId, pinned) => ({ characterId, pinned })
  )
  handleLogged(
    'character:getSettings',
    (_event, characterId: string) => getCharacterSettings(characterId),
    (characterId) => ({ characterId })
  )
  handleLogged(
    'character:setFishVoice',
    (_event, characterId: string, referenceId: string) =>
      setCharacterFishVoice(characterId, referenceId),
    (characterId) => ({ characterId })
  )
  handleLogged(
    'character:download',
    (_event, characterId: string) => downloadCharacter(characterId),
    (characterId) => ({ characterId })
  )
  handleLogged(
    'character:cancelDownload',
    (_event, characterId: string) => cancelCharacterDownload(characterId),
    (characterId) => ({ characterId })
  )
  handleLogged(
    'character:delete',
    (_event, characterId: string, deleteSessions: boolean) =>
      deleteCharacterEntry(characterId, deleteSessions),
    (characterId, deleteSessions) => ({ characterId, deleteSessions })
  )
}
