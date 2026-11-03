import type { GithubProxySource } from '@gamechat/type'
import { getAppSettings } from '../../settings/app-settings'

/** 一次 GitHub 操作使用的来源链上下文。 */
export type GithubRequestContext = {
  /** @description 本次操作使用的来源链，请求时依序尝试直到成功。 */
  sources: GithubProxySource[]
}

/**
 * @description 根据当前应用设置创建一次 GitHub 操作所使用的来源链上下文。
 * @returns 固定本次操作尝试顺序的上下文。
 */
export async function createGithubRequestContext(): Promise<GithubRequestContext> {
  const settings = await getAppSettings()
  return { sources: settings.githubProxy.sources }
}
