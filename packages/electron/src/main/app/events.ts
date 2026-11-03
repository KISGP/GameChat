import { app, BrowserWindow } from 'electron'
import { optimizer } from '@electron-toolkit/utils'
import { logger } from '../logging/index'
import { createMainWindow, markAppQuitting, showMainWindow } from './window'
import { getTtsService } from '../tts/index'
import { shutdownChat } from '../chat/index'
import { getCharacterService } from '../characters/index'
import { getWorldService } from '../world/index'
import { cancelAllConnectionTests } from '../connectivity/index'
import { cancelAllDebugRuns } from '../agent-lab/debug'
import { shutdownTrace } from '../trace/index'
import { shutdownUpdater } from '../updater/index'

/**
 * @description 注册应用级生命周期事件：窗口创建时接入快捷键优化，激活时按需重建主窗口，
 *   非 macOS 平台全部窗口关闭后退出，退出前依次关停聊天运行时、各域任务、TTS 服务与追踪。
 */
export function registerAppEvents(): void {
  app.on('browser-window-created', (_, window) => {
    void logger.info('window', 'browser-window-created', 'Browser window created', {
      webContentsId: window.webContents.id
    })
    optimizer.watchWindowShortcuts(window)
  })

  app.on('activate', () => {
    void logger.info('main', 'activate', 'Application activate event received', {
      windowCount: BrowserWindow.getAllWindows().length
    })
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })

  app.on('window-all-closed', () => {
    void logger.info('main', 'window-all-closed', 'All application windows were closed', {
      platform: process.platform
    })
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('before-quit', () => {
    markAppQuitting()
    shutdownChat()
    getCharacterService().shutdown()
    getWorldService().shutdown()
    cancelAllConnectionTests()
    cancelAllDebugRuns()
    getTtsService().shutdown()
    shutdownUpdater()
    void shutdownTrace()
  })
}

/**
 * @description 请求应用单实例锁，并在已持有锁时注册第二个实例的唤起处理。
 * @returns 当前实例是否获得单实例锁；未获得时应立即退出进程。
 * @remarks 托盘驻留场景下用户可能从开始菜单重复启动应用；第二个实例不退出会与本实例
 *   并发写同一份用户数据，因此锁是托盘驻留的安全前提。
 */
export function acquireSingleInstanceLock(): boolean {
  const locked = app.requestSingleInstanceLock()
  if (locked) {
    app.on('second-instance', () => {
      void logger.info('main', 'second-instance', 'Second instance launch was redirected', {})
      showMainWindow()
    })
  }
  return locked
}
