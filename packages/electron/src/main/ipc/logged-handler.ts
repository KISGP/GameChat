import { ipcMain } from 'electron'
import { AppError } from '../errors/AppError'
import { captureError } from '../logging/index'

/**
 * @description 提取 IPC 事件发送方的上下文，供日志关联到具体窗口。
 * @param event ipcMain 的 invoke 或 on 事件。
 * @returns 含发送方 webContents ID 的对象。
 */
export function getSenderContext(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): {
  webContentsId: number
} {
  return {
    webContentsId: event.sender.id
  }
}

/**
 * @description 注册带统一错误监控的 IPC handler。
 * @param channel IPC channel 名称。
 * @param handler 实际处理函数。
 * @param describe 可选的参数摘要函数，供错误日志携带触发上下文，避免记录完整大对象或敏感数据。
 * @remarks AppError 向渲染层传播时以 safeMessage 作为错误消息——Electron invoke 只序列化
 *   error.message，不转换会使主进程构造的中文安全文案全部失效；完整原始错误已经由
 *   captureError 记入日志，非 AppError 异常原样传播。
 */
export function handleLogged<Args extends unknown[], Result>(
  channel: string,
  handler: (event: Electron.IpcMainInvokeEvent, ...args: Args) => Promise<Result> | Result,
  describe?: (...args: Args) => Record<string, unknown>
): void {
  ipcMain.handle(channel, async (event, ...args: Args) => {
    const context = {
      channel,
      ...getSenderContext(event),
      ...(describe ? describe(...args) : {})
    }

    try {
      return await handler(event, ...args)
    } catch (error) {
      void captureError({
        scope: 'ipc',
        action: 'invoke-error',
        message: `IPC ${channel} failed`,
        code: 'IPC_HANDLER_ERROR',
        context,
        error
      })
      throw error instanceof AppError ? new Error(error.safeMessage) : error
    }
  })
}
