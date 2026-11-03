import { join } from 'path'
import { BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import type { FlowEditorOpenRequest } from '@gamechat/type'
import { sendToWebContents } from '../../broadcast'
import { logger } from '../logging/index'
import { cancelAllDebugRuns } from './debug'

/** Agent 调度台页面的打包态入口：与主窗口同目录的多页应用规则。 */
const AGENT_LAB_HTML = join(__dirname, '../renderer/agent-lab/index.html')

/** 编排窗口呈现配置：由应用在启动参数中声明。 */
export type ChatAppAgentLabOptions = {
  /** 窗口宽度。 */
  width: number
  /** 窗口高度。 */
  height: number
  /** 窗口标题。 */
  title: string
}

/** 编排窗口配置；启动链注入前为 null。 */
let agentLabOptions: ChatAppAgentLabOptions | null = null

/** Agent 调度台独立窗口的单例引用；关闭后置 null。 */
let agentLabWindow: BrowserWindow | null = null

/**
 * @description 注入编排窗口呈现配置。
 * @param options 窗口尺寸与标题。
 * @returns 无返回值。
 * @remarks 必须在打开编排窗口之前调用；未配置时打开操作抛错。
 */
export function configureAgentLabWindow(options: ChatAppAgentLabOptions): void {
  agentLabOptions = options
}

/**
 * @description 读取已注入的编排窗口配置。
 * @returns 窗口呈现配置。
 * @throws 启动链未注入配置时抛出。
 */
function requireAgentLabOptions(): ChatAppAgentLabOptions {
  if (!agentLabOptions) {
    throw new Error('Agent lab window is not configured.')
  }
  return agentLabOptions
}

/**
 * @description 打开或聚焦 Agent 调度台独立窗口。
 * @param request 打开请求：可选的流程标识；省略时打开当前流程。
 * @returns 无返回值。
 * @remarks 窗口单例：已存在时聚焦并推送切换请求，而非重复创建。页面按运行模式加载：
 *   开发态加载 dev server 的 agent-lab 入口，打包态加载产物内的同名页面；首次打开经 URL hash
 *   携带流程标识，由页面自行装载。
 */
export function openAgentLabWindow(request?: FlowEditorOpenRequest): void {
  const options = requireAgentLabOptions()
  const payload: FlowEditorOpenRequest = {
    ...(request?.flowId ? { flowId: request.flowId } : {})
  }
  if (agentLabWindow && !agentLabWindow.isDestroyed()) {
    agentLabWindow.focus()
    sendToWebContents(agentLabWindow.webContents, 'agent-lab:open-flow', payload)
    return
  }
  const window = new BrowserWindow({
    width: options.width,
    height: options.height,
    title: options.title,
    autoHideMenuBar: true,
    // 编排窗口固定无边框：最小化/最大化/关闭由页面工具栏自绘，与系统标题栏互斥。
    frame: false,
    webPreferences: {
      // 两窗口共用同一份 preload 桥：编排窗口所需的 flows/agentLab 分组与主窗口同源暴露。
      preload: join(__dirname, '../preload/index.js')
    }
  })
  agentLabWindow = window
  window.on('closed', () => {
    agentLabWindow = null
    // 编排窗口关闭即取消在途调试运行：调试消耗模型 token，窗口不在时运行无意义。
    cancelAllDebugRuns()
  })
  const hash = encodeOpenHash(payload)
  const load = is.dev && process.env['ELECTRON_RENDERER_URL']
    ? window.loadURL(
        `${process.env['ELECTRON_RENDERER_URL']}/agent-lab/index.html#${hash}`
      )
    : window.loadFile(AGENT_LAB_HTML, { hash })
  void load.catch(async (error: unknown) => {
    await logger.error('ai', 'agent-lab-window-load-failed', 'Failed to load agent lab window', {
      error: error instanceof Error ? error.message : String(error)
    })
  })
}

/**
 * @description 构造编排窗口首次加载的 hash。
 * @param request 打开请求。
 * @returns 流程标识的 URL hash 文本；缺省时为空串。
 */
function encodeOpenHash(request: FlowEditorOpenRequest): string {
  return request.flowId ? encodeURIComponent(request.flowId) : ''
}
