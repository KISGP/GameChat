import type { LogSource } from '@gamechat/type'

/** 出站 HTTP 适配：封装壳的网络栈（Electron 为 net.fetch，Tauri 为 plugin-http）。 */
export type HttpAdapter = {
  /** 发起一次出站请求，返回标准 Response。 */
  request: (url: string, init?: RequestInit) => Promise<Response>
}

/** 存储路径适配：壳提供的用户数据目录。 */
export type StorageAdapter = {
  /** 用户数据根目录（设置、会话、缓存等落盘的基准路径）。 */
  userDataDir: () => string
}

/** 进程通信适配：壳提供的双向消息通道。 */
export type IpcAdapter = {
  /** 注册一个请求-响应通道。 */
  handle: (channel: string, handler: (payload: unknown) => Promise<unknown> | unknown) => void
  /** 调用一个请求-响应通道。 */
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
  /** 订阅一个主→渲染推送事件，返回取消订阅函数。 */
  on: (channel: string, listener: (payload: unknown) => void) => () => void
}

/** 日志适配：核心域的日志出口，由宿主映射到各自的日志基建。 */
export type LogAdapter = {
  info: (scope: LogSource, event: string, message: string, detail?: Record<string, unknown>) => void
  warn: (scope: LogSource, event: string, message: string, detail?: Record<string, unknown>) => void
  error: (scope: LogSource, event: string, message: string, detail?: Record<string, unknown>) => void
}
