import { BrowserWindow, shell, type BrowserWindowConstructorOptions } from 'electron'
import { is } from '@electron-toolkit/utils'
import { PRELOAD_PATH, RENDERER_HTML } from './constants'
import { getAppSettings } from '../settings/app-settings'
import { logger } from '../logging/index'
import { getBundledResourcePath } from '../utils/path'

/** 主窗口呈现配置：每个 chat 应用必然不同，由应用入口声明。 */
export type ChatAppWindowOptions = {
  width: number
  height: number
  /** 是否显示系统边框。 */
  frame: boolean
  resizable: boolean
  maximizable: boolean
  fullscreenable: boolean
  /** 窗口材质；缺省时不设置（平台默认），Electron 仅在 Windows 上应用。 */
  backgroundMaterial?: BrowserWindowConstructorOptions['backgroundMaterial']
  /** 窗口图标，相对内置 resources 根的资源路径。 */
  iconPath: string
  /** 窗口标题。 */
  title: string
}

/** 应用声明的主窗口配置；在窗口首次创建前由启动链设置。 */
let windowOptions: ChatAppWindowOptions | null = null

/** 应用是否正处于退出流程；退出流程中的窗口关闭不再劫持为隐藏到托盘。 */
let appQuitting = false
/** 关闭按钮语义回退为真实关闭时的一次性放行标记。 */
let forceClose = false

/**
 * @description 设置主窗口呈现配置。
 * @param options 应用声明的主窗口配置。
 * @returns 无返回值。
 * @remarks 必须在首次创建窗口前调用；窗口被销毁后经 showMainWindow 重建时沿用本配置。
 */
export function configureMainWindow(options: ChatAppWindowOptions): void {
  windowOptions = options
}

/**
 * @description 读取已设置的主窗口呈现配置。
 * @returns 应用声明的主窗口配置。
 * @throws 启动链未设置配置时抛出。
 */
function requireWindowOptions(): ChatAppWindowOptions {
  if (!windowOptions) {
    throw new Error('Main window options are not configured; call configureMainWindow first.')
  }
  return windowOptions
}

/**
 * @description 标记应用进入退出流程。
 * @returns 无返回值。
 * @remarks 由 before-quit 调用；此后窗口的 close 事件不再被「最小化到托盘」拦截。
 */
export function markAppQuitting(): void {
  appQuitting = true
}

/**
 * @description 显示并聚焦主窗口；窗口不存在（已被销毁）时重新创建。
 * @returns 无返回值。
 */
export function showMainWindow(): void {
  const mainWindow = BrowserWindow.getAllWindows()[0]
  if (!mainWindow) {
    createMainWindow()
    return
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.show()
  mainWindow.focus()
}

/**
 * @description 切换主窗口的可见性：窗口可见时隐藏，否则显示并聚焦。
 * @returns 无返回值。
 * @remarks 供托盘图标左键单击使用；窗口不存在时直接重建。
 */
export function toggleMainWindow(): void {
  const mainWindow = BrowserWindow.getAllWindows()[0]
  if (mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized()) {
    mainWindow.hide()
    return
  }
  showMainWindow()
}

/**
 * @description 按运行模式加载渲染进程页面：开发模式加载 dev server 的主窗口入口，否则加载打包后的 HTML 文件。
 * @param window 目标主窗口。
 * @remarks dev server 根为应用 src（renderer/ 与 agent-lab/ 同根），主窗口入口路径为 /renderer/index.html。
 */
function loadRenderer(window: BrowserWindow): void {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/renderer/index.html`)
  } else {
    window.loadFile(RENDERER_HTML)
  }
}

/**
 * @description 注册主窗口生命周期处理：就绪后显示窗口，并把渲染进程发起的新窗口请求改为在系统浏览器打开。
 * @param window 目标主窗口。
 */
function registerWindowHandlers(window: BrowserWindow): void {
  window.on('ready-to-show', () => {
    void logger.info('window', 'ready-to-show', 'Main window is ready to show', {
      windowId: window.id
    })
    window.show()
  })

  window.on('close', (event) => {
    if (appQuitting || forceClose) return
    // 设置读取为异步，而 preventDefault 必须同步调用，因此先拦截关闭再按设置决定隐藏或放行。
    event.preventDefault()
    void getAppSettings()
      .then((settings) => {
        if (settings.closeToTray) {
          window.hide()
          void logger.info('window', 'window-hidden-to-tray', 'Window close was redirected to tray', {
            windowId: window.id
          })
          return
        }
        forceClose = true
        window.close()
      })
      .catch((error) => {
        void logger.error('window', 'window-close-decide-failed', 'Failed to read close-to-tray setting', {
          error: error instanceof Error ? error.message : String(error)
        })
        forceClose = true
        window.close()
      })
  })

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
}

/**
 * @description 创建主窗口：呈现参数（尺寸/边框/材质/图标/标题）全部来自应用声明，并完成事件注册与页面加载。
 * @returns 已开始加载渲染进程页面的主窗口。
 * @throws 启动链未设置窗口配置时抛出。
 */
export function createMainWindow(): BrowserWindow {
  const options = requireWindowOptions()
  const mainWindow = new BrowserWindow({
    width: options.width,
    height: options.height,
    // 窗口后台创建，就绪后由 ready-to-show 显示；渲染进程加载期间展示自带加载态。
    show: false,
    autoHideMenuBar: true,
    frame: options.frame,
    resizable: options.resizable,
    maximizable: options.maximizable,
    fullscreenable: options.fullscreenable,
    ...(options.backgroundMaterial ? { backgroundMaterial: options.backgroundMaterial } : {}),
    icon: getBundledResourcePath(options.iconPath),
    title: options.title,
    webPreferences: {
      preload: PRELOAD_PATH,
      sandbox: false,
      spellcheck: false
    }
  })

  registerWindowHandlers(mainWindow)
  loadRenderer(mainWindow)

  return mainWindow
}
