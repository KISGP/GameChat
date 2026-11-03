import { app } from 'electron'
import { ProviderStore } from '@gamechat/type'
import { AppearanceSettings, UnifiedSettings } from '@gamechat/type'
import { AgentSettingsStore } from '@gamechat/type'
import { FlowSettingsStore } from '@gamechat/type'
import { normalizeProviderStore, normalizeFlowSettingsStore } from '@gamechat/schema'
import {
  normalizeAgentSettingsStore,
  UnifiedSettingsStore
} from '@gamechat/core'
import { logger } from '../logging/index'

/** 进程内共享的统一设置存储引擎；首次获取时构造。 */
let unifiedSettingsStore: UnifiedSettingsStore | null = null

/**
 * @description 获取统一设置存储引擎实例（聊天域初始化、记忆分区与 trace 等长生命周期消费方使用）。
 * @returns 主进程注入 Electron 路径与日志后的存储引擎单例。
 * @remarks import 本模块零副作用；存储引擎在首次获取时才构造。
 */
export function getUnifiedSettingsStore(): UnifiedSettingsStore {
  if (!unifiedSettingsStore) {
    unifiedSettingsStore = new UnifiedSettingsStore({
      storage: { userDataDir: () => app.getPath('userData') },
      log: logger
    })
  }
  return unifiedSettingsStore
}

/**
 * @description 读取统一设置中的供应商配置集合。
 * @returns 含全部供应商及其模型条目的集合；未配置时为空集合。
 */
export async function getProviders(): Promise<ProviderStore> {
  return (await getUnifiedSettingsStore().get()).providers
}

/**
 * @description 规范化并保存供应商配置到统一设置文件。
 * @param store 待持久化的供应商配置。
 * @returns 保存后的供应商配置。
 */
export async function saveProviders(store: ProviderStore): Promise<ProviderStore> {
  const runtimeStore = normalizeProviderStore(store)
  return getUnifiedSettingsStore().update('providers', runtimeStore)
}

/**
 * @description 获取完整统一设置快照，供渲染进程启动时一次性恢复所有设置分区。
 * @returns 已规范化的完整设置。
 */
export async function getUnifiedSettings(): Promise<UnifiedSettings> {
  return getUnifiedSettingsStore().get()
}

/**
 * @description 规范化并保存界面外观设置到统一设置文件。
 * @param appearance 待持久化的界面外观设置。
 * @returns 保存后的外观设置。
 * @remarks 各标识去空白后为空时回落默认值，避免空标识进入媒体协议地址。
 */
export async function saveAppearanceSettings(
  appearance: AppearanceSettings
): Promise<AppearanceSettings> {
  const backgroundId = appearance.backgroundId.trim() || 'default'
  const skinId = appearance.skinId.trim() || 'skin000'
  const ornamentId = appearance.ornamentId.trim()
  const bubbleId = appearance.bubbleId.trim() || 'default'
  return getUnifiedSettingsStore().update('appearance', {
    backgroundId,
    skinId,
    ornamentId,
    bubbleId
  })
}

/**
 * @description 规范化并保存聊天 Agent 的只读工具策略。
 * @param settings 待保存的 Agent 策略设置。
 * @returns 已保存的规范化策略设置。
 */
export async function saveAgentSettings(settings: AgentSettingsStore): Promise<AgentSettingsStore> {
  return getUnifiedSettingsStore().update('agent', normalizeAgentSettingsStore(settings))
}

/**
 * @description 规范化并保存流程设置分区（当前流程标识）。
 * @param settings 待保存的流程设置。
 * @returns 已保存的规范化流程设置。
 */
export async function saveFlowSettings(settings: FlowSettingsStore): Promise<FlowSettingsStore> {
  return getUnifiedSettingsStore().update('flows', normalizeFlowSettingsStore(settings))
}
