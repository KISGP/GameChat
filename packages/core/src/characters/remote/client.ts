/**
 * @description 远端角色客户端：索引拉取与仓库文件获取。
 * @remarks 请求经 core GitHub 来源链基建完成故障转移；仓库定位由宿主注入，
 *   请求头 User-Agent 统一取宿主注入的品牌标识。
 */
import type { Buffer } from 'node:buffer'
import {
  getGithubRawFileUrl,
  requestGithubBuffer,
  requestGithubJson,
  type GithubRepository,
  type GithubRequestContext
} from '../../infra/github'
import { getUserAgent } from '../../infra/user-agent'
import type { RemoteCharacterRecord } from '../types'
import { parseCharacterIndex, type RemoteParserDeps } from './parser'

/** 远端客户端的宿主依赖。 */
export type RemoteClientDeps = RemoteParserDeps & {
  /** 角色仓库定位。 */
  repository: GithubRepository
}

/** 远端索引拉取结果。 */
export type RemoteIndexDocument = {
  characters: RemoteCharacterRecord[]
  refreshedAt: string
}

/**
 * @description 返回索引提供的仓库相对路径对应的 raw 地址。
 * @param deps 宿主依赖。
 * @param repositoryPath 仓库相对路径。
 * @returns 未代理的远端文件地址，由请求层按来源链解析。
 */
export function getRemoteCharacterResourceUrl(
  deps: RemoteClientDeps,
  repositoryPath: string
): string {
  return getGithubRawFileUrl(deps.repository, repositoryPath)
}

/**
 * @description 拉取远端索引文件并解析为规范化角色记录。
 * @param deps 宿主依赖。
 * @param context 本次操作使用的来源链上下文。
 * @returns 角色记录列表与本次刷新时间。
 * @throws 索引整体结构非法时抛出。
 */
export async function fetchRemoteIndex(
  deps: RemoteClientDeps,
  context?: GithubRequestContext
): Promise<RemoteIndexDocument> {
  const payload = await requestGithubJson<unknown>(
    getGithubRawFileUrl(deps.repository, 'index.json'),
    context,
    { headers: { 'User-Agent': getUserAgent() } }
  )
  return { characters: parseCharacterIndex(payload, deps), refreshedAt: new Date().toISOString() }
}

/**
 * @description 拉取仓库相对路径对应的远端二进制文件，失败时沿来源链切换重试。
 * @param deps 宿主依赖。
 * @param repositoryPath 仓库相对路径。
 * @param context 本次操作使用的来源链上下文。
 * @param signal 取消信号，供下载队列中止在飞请求。
 * @param onProgress 可选的字节进度回调；每累计一个数据块通知一次，总字节数取自 content-length。
 * @returns 文件二进制内容。
 */
export async function fetchRemoteBuffer(
  deps: RemoteClientDeps,
  repositoryPath: string,
  context?: GithubRequestContext,
  signal?: AbortSignal,
  onProgress?: (receivedBytes: number, totalBytes: number | null) => void
): Promise<Buffer> {
  return requestGithubBuffer(getRemoteCharacterResourceUrl(deps, repositoryPath), context, {
    headers: { 'User-Agent': getUserAgent() },
    signal,
    onProgress
  })
}
