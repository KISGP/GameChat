import type { RendererLogEventPayload } from '@gamechat/type'
import { logger } from '../logging/index'
import { handleLogged } from './logged-handler'

/**
 * @description 注册日志 IPC：接收渲染进程埋点事件，并提供日志查看器状态、读取、打开日志文件与清空能力。
 */
export function registerLogIpc(): void {
  handleLogged(
    'log:track',
    (_event, payload: RendererLogEventPayload) => logger.trackRendererEvent(payload),
    (payload) => ({ event: payload.event })
  )
  handleLogged('log:getViewerState', () => logger.getViewerState())
  handleLogged('log:readLogs', () => logger.readLogs())
  handleLogged('log:openFile', () => logger.openFile())
  handleLogged('log:clearLogs', () => logger.clearLogs())
}
