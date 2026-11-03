import { getWorldService } from '../world/index'
import { WORLD_SYNC_PROGRESS_CHANNEL } from '@gamechat/schema'
import { sendToWebContents } from '../../broadcast'
import { handleLogged } from './logged-handler'

/**
 * @description 注册 world 资料状态查询、更新检查和下载 IPC。
 */
export function registerWorldIpc(): void {
  handleLogged('world:getStatus', () => getWorldService().getSyncStatus())
  handleLogged('world:checkForUpdates', () => getWorldService().checkSync())
  handleLogged('world:download', (event) =>
    getWorldService().sync((progress) => {
      sendToWebContents(event.sender, WORLD_SYNC_PROGRESS_CHANNEL, progress)
    })
  )
}
