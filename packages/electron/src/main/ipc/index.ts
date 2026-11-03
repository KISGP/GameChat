import { registerAgentLabIpc } from '../agent-lab/index'
import { registerChatIpc } from './chat'
import { registerCharacterIpc } from './characters'
import { registerFlowsIpc } from './flows'
import { registerLogIpc } from './logs'
import { registerMemoryIpc } from './memory'
import { registerSettingsIpc } from './settings'
import { registerStorageIpc } from './storage'
import { registerToolsIpc } from './tools'
import { registerTtsIpc } from './tts'
import { registerUpdateIpc } from './updater'
import { registerWindowIpc } from './window'
import { registerWorldIpc } from './world'

/**
 * @description 按域依次注册全部 IPC handler，是主进程 IPC 的唯一注册入口。
 */
export function registerIpc(): void {
  registerWindowIpc()
  registerAgentLabIpc()
  registerChatIpc()
  registerCharacterIpc()
  registerFlowsIpc()
  registerSettingsIpc()
  registerMemoryIpc()
  registerLogIpc()
  registerStorageIpc()
  registerToolsIpc()
  registerTtsIpc()
  registerWorldIpc()
  registerUpdateIpc()
}
