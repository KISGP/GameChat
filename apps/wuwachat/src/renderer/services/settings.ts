import { AgentSettingsStore } from '@gamechat/type'
import { ModelProvider } from '@gamechat/type'
import { AppSettings } from '@gamechat/type'
import { AppearanceSettings } from '@gamechat/type'
import { FlowSettingsStore } from '@gamechat/type'
import { ProviderStore } from '@gamechat/type'

/**
 * @description 读取统一应用设置快照。
 * @returns 主进程返回的统一设置。
 */
export function getUnifiedSettings(): ReturnType<typeof window.settings.getUnifiedSettings> {
  return window.settings.getUnifiedSettings()
}

/**
 * @description 保存应用通用设置。
 * @param settings 要持久化的完整应用设置。
 * @returns 主进程保存后的规范化设置 Promise。
 */
export function saveAppSettings(
  settings: AppSettings
): ReturnType<typeof window.settings.saveAppSettings> {
  return window.settings.saveAppSettings(settings)
}

/**
 * @description 保存聊天外观设置。
 * @param settings 要持久化的外观设置。
 * @returns 主进程确认保存后的 Promise。
 */
export function saveAppearance(
  settings: AppearanceSettings
): ReturnType<typeof window.settings.saveAppearance> {
  return window.settings.saveAppearance(settings)
}

/**
 * @description 保存供应商配置集合。
 * @param store 要持久化的供应商配置集合。
 * @returns 主进程确认保存后的 Promise。
 */
export function saveProviders(
  store: ProviderStore
): ReturnType<typeof window.settings.saveProviders> {
  return window.settings.saveProviders(store)
}

/**
 * @description 保存 Agent 设置快照。
 * @param settings 待保存的 Agent 设置。
 * @returns 规范化后的 Agent 设置。
 */
export function saveAgentSettings(
  settings: AgentSettingsStore
): ReturnType<typeof window.settings.saveAgent> {
  return window.settings.saveAgent(settings)
}

/**
 * @description 保存流程设置快照（当前流程标识）。
 * @param settings 待保存的流程设置。
 * @returns 规范化后的流程设置。
 */
export function saveFlowsSettings(
  settings: FlowSettingsStore
): ReturnType<typeof window.settings.saveFlows> {
  return window.settings.saveFlows(settings)
}

/**
 * @description 测试供应商的端点连接。
 * @param requestId 当前测试请求标识。
 * @param provider 待测试的供应商配置。
 * @returns 供应商连接测试结果。
 */
export function testProviderConnection(
  requestId: string,
  provider: ModelProvider
): ReturnType<typeof window.settings.testProvider> {
  return window.settings.testProvider({ requestId, provider })
}

/**
 * @description 取消指定供应商的连接测试。
 * @param requestId 需要取消的测试请求标识。
 * @returns 取消操作完成信号。
 */
export function cancelProviderTest(
  requestId: string
): ReturnType<typeof window.settings.cancelProviderTest> {
  return window.settings.cancelProviderTest(requestId)
}
