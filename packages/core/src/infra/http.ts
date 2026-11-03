/**
 * @description core 出站 HTTP 原语：内置超时与响应大小上限。
 * @remarks 传输层经 {@link setHttpAdapter} 由宿主注入（如 Electron net.fetch 的系统代理语义），
 *   未注入时使用 Node 全局 fetch 直连；{@link appFetch} 是模型客户端等外部 SDK 接入同一
 *   传输决策的统一入口。超时与大小限制包在传输外层，对底层栈无假设。
 */
import { Buffer } from 'buffer'
import type { HttpAdapter } from '../adapters'

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_RESPONSE_BYTES = 20 * 1024 * 1024

/** 模块级传输适配：宿主启动时注入，未注入时全部请求直连。 */
let httpAdapter: HttpAdapter | null = null

/**
 * @description 注入出站传输适配，宿主网络栈自此承接 core 全部出站请求。
 * @param next 宿主传输适配实现。
 */
export function setHttpAdapter(next: HttpAdapter): void {
  httpAdapter = next
}

/**
 * @description 按当前注入的传输适配发起一次请求。
 * @param url 请求地址。
 * @param init fetch 标准初始化。
 * @returns 远端响应对象。
 * @remarks 供 core 内请求原语与模型客户端共享同一传输决策；未注入适配时直连。
 */
export async function appFetch(url: string, init?: RequestInit): Promise<Response> {
  return httpAdapter ? httpAdapter.request(url, init) : fetch(url, init)
}

/** 出站请求选项。 */
export type HttpRequestOptions = {
  /** HTTP 方法，默认 GET。 */
  method?: string
  headers?: Record<string, string>
  /** 请求体，支持字符串、URLSearchParams、FormData 等 fetch 标准 BodyInit；取当前编译环境的全局 RequestInit 定义，DOM 与 Node lib 均自适配。 */
  body?: RequestInit['body']
  /** 超时毫秒数；传 null 表示不设超时，默认 30 秒。 */
  timeoutMs?: number | null
  /** 响应体大小上限（按 content-length 头判断），默认 20 MB。 */
  maxResponseBytes?: number
  /** 外部取消信号；与超时信号组合，超时不会置位该信号。 */
  signal?: AbortSignal
  /** 非 2xx 状态是否改为正常返回响应而不抛错（如调用方需要读取状态码或 304）。 */
  allowErrorStatus?: boolean
  /** 304 Not Modified 是否视为成功响应。 */
  allowNotModified?: boolean
  /** 正文流式读取进度回调；仅由读取正文的 requestBuffer 消费，每累计一个数据块通知一次。 */
  onProgress?: (receivedBytes: number, totalBytes: number | null) => void
}

/**
 * @description 请求远端响应，内置超时与响应大小限制。
 * @param url 请求地址。
 * @param options 请求选项。
 * @returns 远端响应对象。
 * @remarks 超时或大小超限会抛错，外部 signal 取消时以 AbortError 抛出。
 */
export async function request(url: string, options: HttpRequestOptions = {}): Promise<Response> {
  const timeoutMs = options.timeoutMs === null ? null : (options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const timeoutController = timeoutMs === null ? null : new AbortController()
  const timeout = timeoutMs === null ? null : setTimeout(() => timeoutController?.abort(), timeoutMs)
  const signal = timeoutController
    ? AbortSignal.any([options.signal, timeoutController.signal].filter(Boolean) as AbortSignal[])
    : options.signal

  try {
    const response = await appFetch(url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal
    })
    if (
      !response.ok &&
      !options.allowErrorStatus &&
      !(options.allowNotModified && response.status === 304)
    ) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }

    const contentLength = response.headers.get('content-length')
    const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES
    if (contentLength && Number(contentLength) > maxResponseBytes) {
      throw new Error(`Response from ${url} exceeds the ${maxResponseBytes} byte limit.`)
    }

    return response
  } finally {
    if (timeout !== null) clearTimeout(timeout)
  }
}

/**
 * @description 请求并解析 JSON 响应。
 * @param url 请求地址。
 * @param options 请求选项。
 * @returns 解析后的 JSON 数据。
 */
export async function requestJson<T>(url: string, options?: HttpRequestOptions): Promise<T> {
  const response = await request(url, options)
  const text = new TextDecoder().decode(
    await readResponseCapped(response, {
      url,
      maxResponseBytes: options?.maxResponseBytes
    })
  )
  return JSON.parse(text) as T
}

/**
 * @description 请求远端二进制正文：超时覆盖 header 与正文全程，正文受字节上限约束。
 * @param url 请求地址。
 * @param options 请求选项。
 * @returns 完整正文字节。
 * @remarks 与 request()+调用方自行读正文不同，本函数的超时计时器在正文读取完成后才解除，
 *   滞留正文不会挂死调用方；正文经 {@link readResponseCapped} 流式累计，缺失 content-length
 *   的分块响应同样受限。大文件调用方可放宽 timeoutMs 覆盖慢速链路。
 */
export async function requestBuffer(
  url: string,
  options: HttpRequestOptions = {}
): Promise<Buffer> {
  const timeoutMs = options.timeoutMs === null ? null : (options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const timeoutController = timeoutMs === null ? null : new AbortController()
  const timeout = timeoutMs === null ? null : setTimeout(() => timeoutController?.abort(), timeoutMs)
  const signal = timeoutController
    ? AbortSignal.any([options.signal, timeoutController.signal].filter(Boolean) as AbortSignal[])
    : options.signal
  try {
    const response = await appFetch(url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal
    })
    if (
      !response.ok &&
      !options.allowErrorStatus &&
      !(options.allowNotModified && response.status === 304)
    ) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return await readResponseCapped(response, {
      url,
      maxResponseBytes: options.maxResponseBytes,
      onProgress: options.onProgress
    })
  } finally {
    if (timeout !== null) clearTimeout(timeout)
  }
}

/**
 * @description 在字节上限约束下读取响应正文。
 * @param response 已成功的远端响应。
 * @param options 请求地址、正文大小上限与可选进度回调；省略上限时使用默认 20 MB。
 * @returns 完整正文字节。
 * @remarks 以流式 reader 累计字节数，缺失 content-length 头的分块响应同样受限；超限即中断读取并抛错。
 *   传入 onProgress 时每累计一个数据块通知一次已接收字节数，总字节数取自 content-length 头，缺失为 null。
 */
export async function readResponseCapped(
  response: Response,
  options: { url: string; maxResponseBytes?: number; onProgress?: (receivedBytes: number, totalBytes: number | null) => void }
): Promise<Buffer> {
  const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES
  const contentLength = response.headers.get('content-length')
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new Error(`Response from ${options.url} exceeds the ${maxBytes} byte limit.`)
  }
  const totalBytes = contentLength ? Number(contentLength) : null
  const body = response.body
  if (!body) {
    return Buffer.alloc(0)
  }
  const reader = body.getReader()
  const chunks: Buffer[] = []
  let receivedBytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    receivedBytes += value.byteLength
    if (receivedBytes > maxBytes) {
      await reader.cancel()
      throw new Error(`Response from ${options.url} exceeds the ${maxBytes} byte limit.`)
    }
    options.onProgress?.(receivedBytes, totalBytes)
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}
