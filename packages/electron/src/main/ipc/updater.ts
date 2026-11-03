import {
  cancelDownload,
  checkForUpdates,
  downloadUpdate,
  getState,
  installUpdate
} from '../updater/index'
import { handleLogged } from './logged-handler'

/**
 * @description 注册应用更新相关 IPC：状态查询、检查更新、下载更新、取消下载与立即安装。
 */
export function registerUpdateIpc(): void {
  handleLogged('update:getState', () => getState())
  handleLogged('update:check', () => checkForUpdates())
  handleLogged('update:download', () => downloadUpdate())
  handleLogged('update:cancel', () => cancelDownload())
  handleLogged('update:install', () => installUpdate())
}
