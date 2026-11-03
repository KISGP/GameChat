/**
 * @description 流程作用域：把回合状态与运行级流程变量合并为插值与出边求值共用的作用域。
 * @remarks 内置变量名以 schema 的 FLOW_BUILTIN_VARIABLES 为单一事实源；回合未打开时
 *   回合级变量取缺省值，选人步骤仍可按运行级变量与 last_user 求值。
 */
import type { ConversationSession } from '@gamechat/type'
import type { InterpolateScope } from '@gamechat/schema'
import { FLOW_BUILTIN_VARIABLES } from '@gamechat/schema'
import { contentToText, findCurrentInputText } from '../model'
import { hasUsableTools, type TurnStateValue } from '../engine/turn-state'

/** 运行级流程作用域补充值：回合未打开时仍可用的群聊状态与用户输入。 */
export type FlowScopeExtras = {
  participantCount: number
  nextSpeakerId: string
  selectionSource: string
  spokenCount: number
  lastSpeakerId: string
  lastUser: string
  /** 本回合是否执行过工具调用：由流程解释器按 executeTools 节点的实际执行标记。 */
  toolsExecuted: boolean
}

/**
 * @description 构造流程插值作用域。
 * @param turn 当前打开的回合状态；选人阶段为 null。
 * @param variables 流程步骤写入的变量表。
 * @param extras 运行级补充值。
 * @returns 插值与条件求值共用的作用域。
 */
export function buildFlowScope(
  turn: TurnStateValue | null,
  variables: Record<string, string>,
  extras: FlowScopeExtras
): InterpolateScope {
  return {
    variables: {
      [FLOW_BUILTIN_VARIABLES.hasTools]: turn && hasUsableTools(turn) ? 'true' : 'false',
      [FLOW_BUILTIN_VARIABLES.pendingToolCalls]:
        turn && turn.pendingToolCalls.length > 0 ? 'true' : 'false',
      [FLOW_BUILTIN_VARIABLES.toolsExecuted]: extras.toolsExecuted ? 'true' : 'false',
      [FLOW_BUILTIN_VARIABLES.toolTrace]: variables[FLOW_BUILTIN_VARIABLES.toolTrace] ?? '',
      [FLOW_BUILTIN_VARIABLES.incomplete]: turn?.incomplete ? 'true' : 'false',
      [FLOW_BUILTIN_VARIABLES.characterName]: turn?.character.name ?? '',
      [FLOW_BUILTIN_VARIABLES.participantCount]: String(extras.participantCount),
      [FLOW_BUILTIN_VARIABLES.nextSpeaker]: extras.nextSpeakerId,
      [FLOW_BUILTIN_VARIABLES.selectionSource]: extras.selectionSource,
      [FLOW_BUILTIN_VARIABLES.spokenCount]: String(extras.spokenCount),
      [FLOW_BUILTIN_VARIABLES.lastSpeaker]: extras.lastSpeakerId,
      ...variables
    },
    lastUser: turn ? findCurrentInputText(turn.llmMessages) : extras.lastUser
  }
}

/**
 * @description 收集当前批次用户消息的可见文本。
 * @param session 当前会话快照。
 * @param currentMessageIds 本轮用户消息 ID。
 * @returns 依消息顺序拼接的用户输入文本。
 */
export function readCurrentUserText(
  session: ConversationSession,
  currentMessageIds: readonly string[]
): string {
  const ids = new Set(currentMessageIds)
  return session.messages
    .filter((message) => ids.has(message.id) && message.role === 'user')
    .map((message) => contentToText(message.content))
    .join('\n')
}
