import type { AgentPolicyToolPackageId } from '@gamechat/type'

/** 工具包标识词汇：全量联合与策略子集的单一事实源在 @gamechat/type，可开关清单在 @gamechat/schema。 */
export type { AgentToolPackageId, AgentPolicyToolPackageId } from '@gamechat/type'
export { AGENT_POLICY_TOOL_PACKAGE_IDS } from '@gamechat/schema'

export type AgentToolTrace = {
  round: number
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
  outputSummary: string
  output?: unknown
  status: 'completed' | 'failed' | 'rejected'
  sourceIds?: string[]
}

export type AgentPolicy = {
  maxToolRounds: number
  enabledToolPackageIds: AgentPolicyToolPackageId[]
}
