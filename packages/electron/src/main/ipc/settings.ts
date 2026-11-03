import { AppSettings } from '@gamechat/type'
import { ProviderConnectionTestRequest, ProviderStore } from '@gamechat/type'
import { AppearanceSettings } from '@gamechat/type'
import { AgentSettingsStore } from '@gamechat/type'
import { FlowSettingsStore } from '@gamechat/type'
import {
  getProviders,
  getUnifiedSettings,
  saveAppearanceSettings,
  saveAgentSettings,
  saveFlowSettings,
  saveProviders
} from '../settings/index'
import { getAppSettings, saveAppSettings } from '../settings/app-settings'
import { cancelProviderTest, testProvider } from '../connectivity/index'
import { reloadTrace } from '../trace/index'
import { handleLogged } from './logged-handler'

/**
 * @description 注册设置 IPC：统一设置、应用设置、供应商配置、外观与 Agent 设置的读写，
 *   以及供应商连通性测试；应用设置保存后重载追踪配置。
 */
export function registerSettingsIpc(): void {
  handleLogged('settings:getUnifiedSettings', () => getUnifiedSettings())
  handleLogged('settings:getAppSettings', () => getAppSettings())
  handleLogged('settings:saveAppSettings', async (_event, settings: AppSettings) => {
    const saved = await saveAppSettings(settings)
    await reloadTrace()
    return saved
  })
  handleLogged('settings:getProviders', () => getProviders())
  handleLogged('settings:saveAppearance', (_event, appearance: AppearanceSettings) =>
    saveAppearanceSettings(appearance)
  )
  handleLogged('settings:saveAgent', (_event, settings: AgentSettingsStore) =>
    saveAgentSettings(settings)
  )
  handleLogged('settings:saveFlows', (_event, settings: FlowSettingsStore) =>
    saveFlowSettings(settings)
  )
  handleLogged(
    'settings:saveProviders',
    (_event, store: ProviderStore) => saveProviders(store),
    (store) => ({
      providerCount: store.providers.length
    })
  )
  handleLogged(
    'settings:testProvider',
    (_event, request: ProviderConnectionTestRequest) => testProvider(request),
    (request) => ({
      requestId: request.requestId,
      providerId: request.provider.id,
      apiFormat: request.provider.apiFormat,
      baseUrl: request.provider.baseUrl
    })
  )
  handleLogged('settings:cancelProviderTest', (_event, requestId: string) =>
    cancelProviderTest(requestId)
  )
}
