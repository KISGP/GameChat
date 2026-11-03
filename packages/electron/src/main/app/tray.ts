import { Menu, Tray, app } from 'electron'
import { showMainWindow, toggleMainWindow } from './window'
import { logger } from '../logging/index'
import { getBundledResourcePath } from '../utils/path'

/** 托盘呈现配置：每个 chat 应用必然不同，由应用入口声明。 */
export type ChatAppTrayOptions = {
  /** 托盘图标，相对内置 resources 根的资源路径。 */
  iconPath: string
  /** 托盘悬停提示。 */
  tooltip: string
  /** 托盘菜单文案。 */
  labels: {
    /** 打开主窗口。 */
    show: string
    /** 退出应用。 */
    quit: string
  }
}

/** 进程内唯一的托盘图标实例；应用退出时随进程销毁。 */
let tray: Tray | null = null

/**
 * @description 创建系统托盘图标：左键单击切换主窗口可见性，右键菜单提供打开主窗口与退出。
 * @param options 应用声明的托盘配置（图标、提示与菜单文案）。
 * @returns 无返回值。
 * @remarks 重复调用复用既有实例；托盘驻留语义（关闭按钮隐藏窗口）由应用设置 closeToTray 控制，
 *   退出菜单走 app.quit()，经 before-quit 进入统一关停链。
 */
export function createAppTray(options: ChatAppTrayOptions): void {
  if (tray) {
    return
  }
  tray = new Tray(getBundledResourcePath(options.iconPath))
  tray.setToolTip(options.tooltip)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: options.labels.show, click: () => showMainWindow() },
      { type: 'separator' },
      { label: options.labels.quit, click: () => app.quit() }
    ])
  )
  tray.on('click', () => toggleMainWindow())
  void logger.info('window', 'tray-created', 'System tray icon created')
}
