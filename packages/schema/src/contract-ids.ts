import type { AgentPolicyToolPackageId, AgentToolPackageId } from '@gamechat/type'

/**
 * @description 策略可开关工具包的完整清单，供设置归一与调试界面共用。
 */
export const AGENT_POLICY_TOOL_PACKAGE_IDS: readonly AgentPolicyToolPackageId[] = [
  'world',
  'datetime',
  'moegirlpedia'
]

/**
 * @description 全部工具包的完整清单，供流程导入校验与编排界面选项共用。
 * @remarks 常驻包始终可用，不参与全局启用集合；策略包为可开关子集。
 */
export const AGENT_TOOL_PACKAGE_IDS: readonly AgentToolPackageId[] = [
  'world',
  'datetime',
  'moegirlpedia',
  'chat-history',
  'chat-images',
  'chat-emoticons',
  'chat-memory-tools',
  'state-card'
]
