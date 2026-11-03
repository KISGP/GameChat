import { app, dialog, net, protocol } from 'electron'
import { electronApp } from '@electron-toolkit/utils'
import { acquireSingleInstanceLock, registerAppEvents } from './app/events'
import { bootstrapAppData } from './app/bootstrap-data'
import { createAppTray, type ChatAppTrayOptions } from './app/tray'
import { configureMainWindow, createMainWindow, type ChatAppWindowOptions } from './app/window'
import { configureAgentLabWindow, type ChatAppAgentLabOptions } from './agent-lab/window'
export type { ChatAppAgentLabOptions } from './agent-lab/window'
import { configureCharacterDomain, synchronizeCharacters } from './characters/index'
export type { ChatAppTrayOptions } from './app/tray'
export type { ChatAppWindowOptions } from './app/window'
import {
  privilegedCharacterMediaScheme,
  registerCharacterMediaProtocol
} from './characters/media-protocol'
import { initializeChat } from './chat/index'
import { getMemoryService } from './memory/index'
import { registerIpc } from './ipc/index'
import { broadcastToAllWindows } from '../broadcast'
import { captureError, logger } from './logging/index'
import { getAppSettings } from './settings/app-settings'
import { getProviders } from './settings/index'
import { initTrace } from './trace/index'
import { privilegedTtsAudioScheme, registerTtsAudioProtocol } from './tts/protocol'
import { initializeUpdater } from './updater/index'
import { getBundledEmoticonsRoot, getAppDataRoot } from './utils/path'
import { configureWorldDomain, getWorldSearch, getWorldService } from './world/index'
import {
  configureChatHost,
  getUserAgent,
  setHttpAdapter,
  setLogSink,
  setUserAgent,
  type ChatHostBindings,
  type GithubRepository
} from '@gamechat/core'
import { CHAT_RUN_EVENT_CHANNEL } from '@gamechat/schema'

/** 标准聊天应用主进程的启动参数：应用身份与呈现差异全部由宿主应用声明，包内不设品牌默认。 */
export type ChatAppMainOptions = {
  /** 应用身份标识，须与 electron-builder 的 appId 一致，系统通知按 AUMI 归属。 */
  appId: string
  /** 应用产品名，用作缺省 User-Agent 前缀。 */
  productName: string
  /** 出站请求的 User-Agent；缺省为 `productName/版本`。 */
  userAgent?: string
  /** 主窗口呈现配置（尺寸、边框、材质、图标与标题）。 */
  window: ChatAppWindowOptions
  /** 托盘呈现配置（图标、悬停提示与菜单文案）。 */
  tray: ChatAppTrayOptions
  /** 编排窗口呈现配置（尺寸与标题）。 */
  agentLab: ChatAppAgentLabOptions
  /** 内容数据源：角色仓库与 World 资料仓库。 */
  repositories: {
    characters: GithubRepository
    world: GithubRepository
  }
  /** 更新发布页地址（GitHub releases）。 */
  releasesUrl: string
}

/**
 * @description 注册主进程未捕获异常与未处理 Promise 拒绝的兜底处理，统一交给错误监控记录。
 * @returns 无返回值。
 * @remarks 在启动链最前端调用，使启动期异常也能进入结构化日志。
 */
function registerProcessErrorHandlers(): void {
  process.on('uncaughtException', (error) => {
    void captureError({
      scope: 'main',
      action: 'uncaught-exception',
      message: 'Unhandled exception in main process',
      code: 'PROCESS_ERROR',
      error
    })
  })

  process.on('unhandledRejection', (reason) => {
    void captureError({
      scope: 'main',
      action: 'unhandled-rejection',
      message: 'Unhandled promise rejection in main process',
      code: 'PROCESS_ERROR',
      error: reason
    })
  })
}

/**
 * @description 装配聊天域宿主绑定：把应用壳能力注入 core 聊天引擎。
 * @returns 无返回值。
 * @remarks 必须在创建聊天运行时之前完成；事件推送走统一广播原语，
 *   应用数据根目录与内置表情目录按运行形态解析，world 检索与长期记忆适配由各域单例提供；
 *   模型请求的 User-Agent 直接取 core 的 User-Agent 槽（启动时已按应用配置注入）。
 */
function configureChatHostBindings(): void {
  const bindings: ChatHostBindings = {
    emitChatEvent: (event) => broadcastToAllWindows(CHAT_RUN_EVENT_CHANNEL, event),
    appDataRoot: () => getAppDataRoot(),
    bundledEmoticonsRoot: () => getBundledEmoticonsRoot(),
    getAppSettings: () => getAppSettings(),
    getProviders: () => getProviders(),
    modelUserAgent: () => getUserAgent(),
    getWorldSearch: () => getWorldSearch(),
    getMemory: () => getMemoryService(),
    showSaveDialog: async (options) => {
      const result = await dialog.showSaveDialog({
        title: options.title,
        defaultPath: options.defaultPath,
        filters: options.filters
      })
      return { canceled: result.canceled, filePath: result.filePath }
    }
  }
  configureChatHost(bindings)
}

/**
 * @description 启动标准聊天应用主进程：特权协议注册、单实例锁、宿主绑定、域服务与 IPC 全链装配。
 * @param options 应用身份参数（appId 与 productName）。
 * @returns 无返回值。
 * @remarks 本函数是包的主进程公共门面：应用入口只需调用它并传入身份，实现细节不对外承诺。
 *   特权注册在进程内只允许执行一次，且各域声明必须合并为单次调用，否则同名启动开关后写覆盖前写，
 *   渲染进程只会登记最后一个协议的特权。
 */
export function startChatAppMain(options: ChatAppMainOptions): void {
  registerProcessErrorHandlers()
  // core 域日志出口在此接入主进程日志基建：注入早于一切域装配，启动期告警即可落盘。
  setLogSink(logger)
  // 出站请求的品牌标识在此解析一次（缺省 `产品名/版本`），core 内所有出站请求共用同一值。
  setUserAgent(options.userAgent ?? `${options.productName}/${app.getVersion()}`)
  // 全应用统一出站传输：按应用设置实时分流——开启时走 Chromium 网络栈（跟随系统代理），
  // 关闭时直连；每请求读取内存缓存设置（异步 get），变更即时生效，无需重载钩子。
  setHttpAdapter({
    request: async (url, init) =>
      (await getAppSettings()).useSystemProxy ? net.fetch(url, init) : fetch(url, init)
  })
  protocol.registerSchemesAsPrivileged([privilegedTtsAudioScheme, privilegedCharacterMediaScheme])

  // 未获得单实例锁的后续实例直接退出，由已驻留实例唤起主窗口，避免双进程并发写同一份用户数据。
  if (!acquireSingleInstanceLock()) {
    app.quit()
  } else {
    app.whenReady().then(() => {
      // 必须与 electron-builder.yml 的 appId 一致：安装器快捷方式与卸载注销都按 appId 登记 AUMI，
      // 两侧不一致会导致系统通知无法归属到应用身份。
      electronApp.setAppUserModelId(options.appId)
      registerTtsAudioProtocol()
      registerCharacterMediaProtocol()
      // 应用专属呈现与数据源配置必须在对应域首次使用前完成；全部来自应用入口的声明。
      configureCharacterDomain({ repository: options.repositories.characters })
      configureWorldDomain({ repository: options.repositories.world })
      configureMainWindow(options.window)
      configureAgentLabWindow(options.agentLab)
      // 宿主绑定必须先于聊天运行时构造完成，协议与 IPC 调用都依赖其就绪。
      configureChatHostBindings()
      return bootstrapAppData()
        .then(() => {
          void logger.info('main', 'app-ready', 'Electron app is ready')
          registerAppEvents()
          createAppTray(options.tray)
          registerIpc()
          void logger.info('main', 'ipc-registered', 'IPC handlers registered')
          // 主窗口与聊天引导、trace 初始化并行：渲染进程加载期间界面显示自带加载态，
          // 聊天域 IPC handler 经初始化门等待会话文档加载完成。
          createMainWindow()
          void synchronizeCharacters()
          initializeUpdater(options.releasesUrl)
          // world 资料安装状态只读本地清单、不触网：进启动日志便于定位检索不可用问题，
          // 资料下载由使用方在设置页显式触发。
          void getWorldService()
            .getSyncStatus()
            .then((status) => {
              void logger.info('main', 'world-status', 'World data status resolved', {
                installed: status.installed,
                version: status.localManifest?.version ?? null
              })
            })
            .catch((error) => {
              void logger.warn('main', 'world-status-failed', 'Failed to resolve world data status', {
                error: error instanceof Error ? error.message : String(error)
              })
            })
          // 聊天域与追踪初始化失败只记录并降级：窗口与其余域已就绪，
          // 失败域在用户重试或重启后自然恢复，不阻塞应用启动。
          void initializeChat()
            .then(() => {
              void logger.info('main', 'chat-bootstrap-success', 'Lightweight chat bootstrap completed')
            })
            .catch((error) => {
              void captureError({
                scope: 'main',
                action: 'chat-bootstrap-failed',
                message: 'Lightweight chat bootstrap failed',
                code: 'PROCESS_ERROR',
                error
              })
            })
          void initTrace().then(() => {
            void logger.info('main', 'trace-init-success', 'Langfuse tracing initialized')
          })
        })
        .catch((error) => {
          void captureError({
            scope: 'main',
            action: 'app-bootstrap-failed',
            message: 'Application bootstrap failed',
            code: 'PROCESS_ERROR',
            error
          })
        })
    })
  }
}
