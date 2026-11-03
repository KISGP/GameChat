/**
 * @description 聊天域宿主绑定：core 内模块级函数对壳环境能力的唯一读取面。
 * @remarks 宿主在构造运行时之前调用 configureChatHost 完成注入；未配置时任何读取抛错。
 *   日志与追踪走 infra/log、infra/trace 的独立 sink，不经本模块。
 */
import type { AppSettings } from '@gamechat/type'
import type { ProviderStore } from '@gamechat/type'
import type { ChatRunEvent } from '@gamechat/type'
import type { ChatWorldSearch, MemoryAdapter } from './types'

/** 保存对话框的结果。 */
export type SaveDialogResult = {
  /** 用户是否取消保存。 */
  canceled: boolean
  /** 用户选择的目标文件路径；取消时为 null。 */
  filePath: string | null
}

/** 保存对话框选项。 */
export type SaveDialogOptions = {
  /** 对话框标题。 */
  title?: string
  /** 默认保存路径（含文件名）。 */
  defaultPath?: string
  /** 文件类型过滤器。 */
  filters?: { name: string; extensions: string[] }[]
}

/** 聊天域宿主绑定集合。 */
export type ChatHostBindings = {
  /** @description 推送一条聊天运行事件到宿主的呈现层。 */
  emitChatEvent: (event: ChatRunEvent) => void
  /** @description 返回应用数据根目录（聊天记录、工具缓存等落盘的基准路径）。 */
  appDataRoot: () => string
  /** @description 返回宿主内置用户表情资源根目录。 */
  bundledEmoticonsRoot: () => string
  /** @description 读取应用级设置（图片处理、消息折叠等聊天行为配置）。 */
  getAppSettings: () => Promise<AppSettings>
  /** @description 读取模型供应商集合（凭据与连接信息）。 */
  getProviders: () => Promise<ProviderStore>
  /** @description 返回模型出站请求的 User-Agent 标识（如 `应用名/<版本>`）。 */
  modelUserAgent: () => string
  /** @description 返回背景资料检索适配实现。 */
  getWorldSearch: () => ChatWorldSearch
  /** @description 返回长期记忆适配实现。 */
  getMemory: () => MemoryAdapter
  /** @description 打开保存文件对话框；宿主无原生对话框时可自行实现替代交互。 */
  showSaveDialog: (options: SaveDialogOptions) => Promise<SaveDialogResult>
}

let bindings: ChatHostBindings | null = null

/**
 * @description 注入聊天域宿主绑定。
 * @param next 宿主绑定集合。
 * @remarks 重复调用以最后一次为准；须在创建 ChatRuntime 之前完成。
 */
export function configureChatHost(next: ChatHostBindings): void {
  bindings = next
}

/**
 * @description 读取当前宿主绑定。
 * @returns 已注入的绑定集合。
 * @throws 未调用 configureChatHost 时抛错。
 */
export function getChatHost(): ChatHostBindings {
  if (!bindings) {
    throw new Error('Chat host bindings are not configured; call configureChatHost first')
  }
  return bindings
}
