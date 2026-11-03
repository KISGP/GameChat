import { BrowserWindow, ipcMain } from 'electron'

/**
 * @description 注册窗口控制 IPC：处理渲染进程的最小化与最大化/还原切换请求。
 */
export function registerWindowIpc(): void {
  ipcMain.on('window:minimize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
    window?.minimize()
  })
  ipcMain.on('window:maximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
    if (!window) {
      return
    }
    if (window.isMaximized()) {
      window.unmaximize()
    } else {
      window.maximize()
    }
  })
}
