/**
 * @description Electron 壳适配库统一出口：广播原语、更新控制器与标准聊天应用主进程入口。
 */
export { broadcastToAllWindows, sendToWebContents } from './broadcast'
export {
  createAppUpdaterController,
  type AppUpdaterController,
  type AppUpdaterOptions,
  type UpdaterSource
} from './updater'
export { UPDATER_STATE_CHANNEL, type UpdaterPhase, type UpdaterSnapshot } from './updater/types'
export {
  startChatAppMain,
  type ChatAppMainOptions,
  type ChatAppAgentLabOptions,
  type ChatAppTrayOptions,
  type ChatAppWindowOptions
} from './main'
