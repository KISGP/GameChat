/**
 * @description GitHub 来源链基础设施：来源链请求上下文的构造、代理地址映射与逐来源故障转移。
 * @remarks 各域（角色远端、应用更新）共用的单一实现；默认来源链取自应用设置的
 *   GitHub 代理分区，调用方可显式传入固定链。
 */
import { requestBuffer, requestJson, type HttpRequestOptions } from './http'
import { type GithubProxySource } from '@gamechat/type'
import { BUILTIN_GITHUB_PROXY_SOURCES } from '@gamechat/schema'

/** GitHub 仓库定位。 */
export type GithubRepository = {
  owner: string
  name: string
  branch: string
}

/** 一次 GitHub 操作所使用的来源链上下文。 */
export type GithubRequestContext = {
  /** 本次操作使用的来源链，请求时依序尝试直到成功。 */
  sources: GithubProxySource[]
}

/** 单个来源的一次失败记录。 */
export type GithubSourceAttempt = {
  sourceLabel: string
  reason: string
}

/**
 * @description GitHub 全部来源均失败时抛出的聚合错误。
 * @remarks message 为英文全量明细（供日志），attempts 保留逐来源短因（供界面归因）。
 */
export class GithubSourceChainError extends Error {
  readonly attempts: GithubSourceAttempt[]

  /**
   * @description 创建来源链聚合错误。
   * @param attempts 按尝试顺序排列的逐来源失败记录。
   */
  constructor(attempts: GithubSourceAttempt[]) {
    super(
      `All GitHub sources failed: ${attempts
        .map((attempt) => `${attempt.sourceLabel} (${attempt.reason})`)
        .join('; ')}`
    )
    this.name = 'GithubSourceChainError'
    this.attempts = attempts
  }
}

/**
 * @description 将单次请求异常归类为可展示的短因文本。
 * @param error 请求过程中抛出的异常。
 * @returns 归类后的短因；HTTP 状态形如 `HTTP 404`，超时或中止、其余异常截断原文。
 */
export function describeGithubAttemptFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const statusMatch = /^Request failed: (\d{3})/.exec(message)
  if (statusMatch) {
    return `HTTP ${statusMatch[1]}`
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return '请求超时或中止'
  }
  return message.length > 120 ? `${message.slice(0, 117)}...` : message
}

/**
 * @description 把逐来源失败记录格式化为中文汇总句。
 * @param attempts 按尝试顺序排列的失败记录。
 * @returns 形如「已尝试全部来源（gh-proxy.org HTTP 404、GitHub 直连 请求超时）」的文本。
 */
export function formatGithubSourceAttempts(attempts: GithubSourceAttempt[]): string {
  return `已尝试来源（${attempts
    .map((attempt) => `${attempt.sourceLabel} ${attempt.reason}`)
    .join('、')}）`
}

/**
 * @description 返回来源链聚合错误对应的中文汇总；非链聚合错误返回 null。
 * @param error 待识别的异常。
 * @returns 中文来源尝试汇总；错误不是 GithubSourceChainError 时返回 null。
 */
export function formatGithubChainError(error: unknown): string | null {
  return error instanceof GithubSourceChainError ? formatGithubSourceAttempts(error.attempts) : null
}

/**
 * @description 将 GitHub API 或 raw 地址映射到指定来源。
 * @param url 原始 GitHub 地址。
 * @param source 目标来源；直连来源原样返回地址。
 * @returns 代理地址或原始地址。
 * @remarks 仅 api.github.com 与 raw.githubusercontent.com 会被代理，其余主机保持直连。
 */
export function resolveGithubUrl(url: string, source: GithubProxySource): string {
  if (source.baseUrl === null) {
    return url
  }
  const parsed = new URL(url)
  if (parsed.hostname !== 'api.github.com' && parsed.hostname !== 'raw.githubusercontent.com') {
    return url
  }
  return `${source.baseUrl}/${url}`
}

/**
 * @description 构造仓库文件的 raw 地址。
 * @param repository 仓库定位。
 * @param filePath 仓库相对路径。
 * @returns raw.githubusercontent.com 地址。
 */
export function getGithubRawFileUrl(repository: GithubRepository, filePath: string): string {
  const path = filePath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  const owner = encodeURIComponent(repository.owner)
  const name = encodeURIComponent(repository.name)
  const branch = encodeURIComponent(repository.branch)
  return `https://raw.githubusercontent.com/${owner}/${name}/${branch}/${path}`
}

/**
 * @description 沿来源链逐个尝试一次 GitHub 请求，直到某个来源成功或全部失败。
 * @param url 原始 GitHub 地址。
 * @param context 来源链上下文；缺省时使用内置默认链。
 * @param options 请求选项；取消信号经此透传。
 * @param consume 对已解析候选地址执行的单次请求动作。
 * @returns 第一个成功来源的动作结果。
 * @remarks 任一来源失败即尝试下一个；外部取消信号已触发时立即抛出取消错误，不再切换来源；
 *   全部失败时抛出携带逐来源短因的 GithubSourceChainError。
 */
async function requestGithubWithFailover<T>(
  url: string,
  context: GithubRequestContext | undefined,
  options: HttpRequestOptions | undefined,
  consume: (resolvedUrl: string) => Promise<T>
): Promise<T> {
  const sources = context?.sources.length ? context.sources : [...BUILTIN_GITHUB_PROXY_SOURCES]
  const attempts: GithubSourceAttempt[] = []
  for (const source of sources) {
    try {
      return await consume(resolveGithubUrl(url, source))
    } catch (error) {
      attempts.push({ sourceLabel: source.label, reason: describeGithubAttemptFailure(error) })
      if (options?.signal?.aborted) {
        throw error
      }
    }
  }
  throw new GithubSourceChainError(attempts)
}

/**
 * @description 请求 GitHub 地址并解析 JSON 响应，失败时沿来源链切换重试。
 * @param url 原始 GitHub 地址。
 * @param context 来源链上下文；缺省时使用内置默认链。
 * @param options 请求选项；取消信号经此透传。
 * @returns 解析后的 JSON 数据。
 */
export async function requestGithubJson<T>(
  url: string,
  context?: GithubRequestContext,
  options?: HttpRequestOptions
): Promise<T> {
  return requestGithubWithFailover(url, context, options, (resolvedUrl) =>
    requestJson<T>(resolvedUrl, options)
  )
}

/**
 * @description 请求 GitHub 地址并读取二进制响应，失败时沿来源链切换重试。
 * @param url 原始 GitHub 地址。
 * @param context 来源链上下文；缺省时使用内置默认链。
 * @param options 请求选项；取消信号经此透传。
 * @returns 响应字节。
 */
export async function requestGithubBuffer(
  url: string,
  context?: GithubRequestContext,
  options?: HttpRequestOptions
): Promise<Buffer> {
  return requestGithubWithFailover(url, context, options, (resolvedUrl) =>
    requestBuffer(resolvedUrl, options)
  )
}
