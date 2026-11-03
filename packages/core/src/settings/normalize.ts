import { createDefaultAppSettings, normalizeAppSettings } from '@gamechat/schema'
import { createDefaultAgentSettingsStore, DEFAULT_ENABLED_TOOL_PACKAGE_IDS } from '@gamechat/schema'
import type { AgentSettingsStore } from '@gamechat/type'
import { AGENT_POLICY_TOOL_PACKAGE_IDS } from '@gamechat/schema'
import type { AgentPolicyToolPackageId } from '@gamechat/type'
import { normalizeProviderStore } from '@gamechat/schema'
import { createDefaultMemorySettingsStore, normalizeMemorySettingsStore } from '@gamechat/schema'
import { createDefaultFlowSettingsStore, normalizeFlowSettingsStore } from '@gamechat/schema'
import type { UnifiedSettings } from '@gamechat/type'

/** 当前版本支持启用的工具包标识全集。 */
const SUPPORTED_TOOL_PACKAGE_IDS = AGENT_POLICY_TOOL_PACKAGE_IDS

const DEFAULT_BACKGROUND_ID = 'default'
const DEFAULT_SKIN_ID = 'skin000'
// 摆件默认不选中，空字符串表示未装备任何摆件
const DEFAULT_ORNAMENT_ID = ''
// 气泡样式默认回落 CSS 气泡
const DEFAULT_BUBBLE_ID = 'default'

/**
 * @description 创建包含所有可持久化设置分区的默认配置。
 * @returns 可安全写入统一设置文件的默认配置。
 */
export function createDefaultUnifiedSettings(): UnifiedSettings {
  return {
    app: createDefaultAppSettings(),
    providers: { providers: [] },
    memory: createDefaultMemorySettingsStore(),
    agent: createDefaultAgentSettingsStore(),
    appearance: {
      backgroundId: DEFAULT_BACKGROUND_ID,
      skinId: DEFAULT_SKIN_ID,
      ornamentId: DEFAULT_ORNAMENT_ID,
      bubbleId: DEFAULT_BUBBLE_ID
    },
    flows: createDefaultFlowSettingsStore()
  }
}

/**
 * @description 规范化统一设置文件的原始内容，并为无效分区提供默认值。
 * @param value 从持久化文件读取的原始设置。
 * @returns 可安全供主进程使用的统一设置。
 */
export function normalizeUnifiedSettings(value: unknown): UnifiedSettings {
  const defaults = createDefaultUnifiedSettings()
  if (!value || typeof value !== 'object') {
    return defaults
  }

  const raw = value as Partial<UnifiedSettings>
  const backgroundId = raw.appearance?.backgroundId
  const skinId = raw.appearance?.skinId
  const ornamentId = raw.appearance?.ornamentId
  const bubbleId = raw.appearance?.bubbleId

  return {
    app: normalizeAppSettings(raw.app),
    providers: normalizeProviderStore(raw.providers),
    memory: normalizeMemorySettingsStore(raw.memory),
    agent: normalizeAgentSettingsStore(raw.agent),
    appearance: {
      backgroundId:
        typeof backgroundId === 'string' && backgroundId.trim()
          ? backgroundId
          : DEFAULT_BACKGROUND_ID,
      skinId: typeof skinId === 'string' && skinId.trim() ? skinId : DEFAULT_SKIN_ID,
      ornamentId:
        typeof ornamentId === 'string' && ornamentId.trim()
          ? ornamentId.trim()
          : DEFAULT_ORNAMENT_ID,
      bubbleId: typeof bubbleId === 'string' && bubbleId.trim() ? bubbleId : DEFAULT_BUBBLE_ID
    },
    flows: normalizeFlowSettingsStore(raw.flows)
  }
}

/**
 * @description 规范化持久化的聊天 Agent 策略设置。
 * @param value 未受信任的持久化设置。
 * @returns 可安全使用的策略设置。
 * @remarks 历史版本持久化的 maxToolRounds 字段与萌娘百科凭据分区在此被丢弃，不做兼容迁移。
 */
export function normalizeAgentSettingsStore(value: unknown): AgentSettingsStore {
  const defaults = createDefaultAgentSettingsStore()
  if (!value || typeof value !== 'object') {
    return defaults
  }
  const raw = value as Partial<AgentSettingsStore>
  return {
    enabledToolPackageIds: normalizeEnabledToolPackageIds(raw.enabledToolPackageIds)
  }
}

/**
 * @description 从持久化设置中筛选当前版本支持的工具包标识。
 * @param value 未受信任的工具包标识数组。
 * @returns 去重后的可用工具包标识；空数组表示禁用全部工具，非数组配置回退到默认值。
 */
function normalizeEnabledToolPackageIds(value: unknown): AgentPolicyToolPackageId[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_ENABLED_TOOL_PACKAGE_IDS]
  }

  const supported = new Set<string>(SUPPORTED_TOOL_PACKAGE_IDS)
  const ids = value.filter(
    (item): item is AgentPolicyToolPackageId => typeof item === 'string' && supported.has(item)
  )
  return [...new Set(ids)]
}
