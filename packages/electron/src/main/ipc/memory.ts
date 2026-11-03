import { MemorySettingsStore } from '@gamechat/type'
import { getMemoryService } from '../memory/index'
import { handleLogged } from './logged-handler'

/**
 * @description 注册记忆设置、记忆读写与目录打开的 IPC。
 */
export function registerMemoryIpc(): void {
  handleLogged('memory:getSettings', () => getMemoryService().getSettings())
  handleLogged(
    'memory:saveSettings',
    (_event, store: MemorySettingsStore) => getMemoryService().saveSettings(store),
    (store) => ({ enabled: store.enabled })
  )
  handleLogged('memory:getMarkdown', (_event, characterId: string) =>
    getMemoryService().getCharacterMemory(characterId)
  )
  handleLogged(
    'memory:saveMarkdown',
    (_event, characterId: string, content: string) =>
      getMemoryService().saveCharacterMemory(characterId, content),
    (characterId, content) => ({ characterId, length: content.length })
  )
  handleLogged('memory:openDirectory', () => getMemoryService().openMemoryDirectory())
}
