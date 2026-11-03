import type { AIMessageChunk, BaseMessage } from '@langchain/core/messages'
import type {
  CharacterSummary,
  ChatImageInput,
  ContextUsage,
  ConversationMessage,
  ConversationSession,
  FlowNodeRawExchange,
  FlowStepType
} from '@gamechat/type'
import type { ResolvedModelConfig } from '@gamechat/type'
import type { AgentPolicy, AgentToolTrace } from '../../tools'
import type { ContextBudget } from '../model'
import type { AgentTool, AgentToolCall, AgentToolPackage } from '../../tools'
import type { AgentToolExecutor } from '../../tools'
import type { ChatEmoticonImage } from '@gamechat/schema'

/**
 * @description 回合作用域的 Agent 循环运行时：回合内不变的工具包、执行器、模型绑定与路由提示词。
 * @remarks 由 route 步骤首次进入时构建并写入回合状态，循环内各步直接复用；回合结束随状态丢弃。
 *   签名相同才复用，流程中多个 route 步骤配置不同时各自构建。
 */
export type AgentLoopRuntime = {
  /** 构建时的配置签名：签名变化时重建运行时。 */
  signature: string
  /** 本回合对模型可见的工具包。 */
  packages: AgentToolPackage[]
  /** 基于工具包构建的执行器。 */
  executor: AgentToolExecutor
  /** 工具定义列表，与 executor 注册内容一致。 */
  definitions: AgentTool['definition'][]
  /** 已绑定工具定义的路由阶段模型；本回合未启用任何工具时为 null。 */
  boundModel: {
    invoke: (messages: BaseMessage[], options?: { signal?: AbortSignal }) => Promise<AIMessageChunk>
  } | null
  /** 路由阶段 system 提示词全文。 */
  routingSystemPrompt: string
  /** 生效的工具策略。 */
  policy: AgentPolicy
  /** 生效的工具轮次上限（由应用侧策略决定）。 */
  maxToolRounds: number
}

/**
 * @description 一次角色发言回合在生命周期内的全部数据。
 * @remarks 回合状态是纯数据对象，由 turn-lifecycle 装配、由流程步骤增量覆盖；
 *   不再绑定 LangGraph 注解，流程引擎直接推进普通对象。
 */
export type TurnStateValue = {
  requestId: string
  sessionId: string
  modelId: string
  characterId: string
  currentMessageIds: string[]
  currentImages: ChatImageInput[]
  modelConfig: ResolvedModelConfig
  /** 本回合生效的上下文预算，由回合装配解析一次后在装配与各轮截断间复用。 */
  budget: ContextBudget
  /** 终答 system 提示词的校准后估算预留，装配与工具轨迹截断共用同一扣除口径。 */
  systemReserveTokens: number
  /** 截断后历史消息的校准后估算 token 数，作为工具轨迹的可用量扣除基线。 */
  historyEstimateTokens: number
  policy: AgentPolicy
  /** senderId 到角色展示名的映射，由运行开始时装配。 */
  participantNames: Record<string, string>
  session: ConversationSession
  character: CharacterSummary
  characterEmoticons: ChatEmoticonImage[]
  userEmoticons: ChatEmoticonImage[]
  prompt: string
  history: ConversationMessage[]
  llmMessages: BaseMessage[]
  /** 本回合注入的状态卡段文本，由回合装配装载、终答并入开头 system。 */
  stateCardSections: string[]
  /** 本回合注入的角色记忆段文本，终答并入开头 system。 */
  memorySections: string[]
  /** 装配截断丢弃的最早历史条数；大于零时终答 system 追加历史省略说明段。 */
  historyOmittedCount: number
  assistantMessageId: string
  assistantDraft: string
  /** 终答流采集到的上下文统计；由 finalAnswer 写入、回合提交落库。 */
  contextUsage?: ContextUsage
  routingMessages: BaseMessage[]
  pendingToolCalls: AgentToolCall[]
  toolRounds: number
  loopRuntime?: AgentLoopRuntime
  incomplete: boolean
  abortSignal: AbortSignal
  /** 引擎事件出口：步骤经它发流式增量、工具轨迹与节点信息。 */
  emit: TurnEventSink
}

/**
 * @description 判断回合是否存在可用的工具入口（策略包、实时图片或表情清单）。
 * @param state 当前回合状态。
 * @returns 存在任一工具入口时返回 true。
 * @remarks 流程的 has_tools 内置变量与路由入口判定共用本实现，口径必须一致。
 */
export function hasUsableTools(state: TurnStateValue): boolean {
  const hasPackages = state.policy.enabledToolPackageIds.length > 0
  const hasImages = state.currentImages.length > 0
  const hasEmoticons = state.userEmoticons.length > 0 || state.characterEmoticons.length > 0
  return hasPackages || hasImages || hasEmoticons
}

/**
 * @description 流程引擎事件：由步骤经事件出口发出，runtime 与调试器各自翻译。
 * @remarks token/tool-trace/image-analysis 是流式产物；turn-started/turn-committed 是回合边界；
 *   node-enter/node-exit/node-output/variables/context-usage 供编排调试界面展示执行路径与步骤产出。
 */
export type TurnStreamEvent =
  | {
      type: 'turn-started'
      characterId: string
      assistantMessageId: string
      session: ConversationSession
    }
  | {
      type: 'turn-committed'
      characterId: string
      assistantMessageId: string
      session: ConversationSession
    }
  | { type: 'token'; characterId: string; text: string }
  | { type: 'tool-trace'; characterId: string; trace: AgentToolTrace }
  | { type: 'image-analysis'; characterId: string; resourceId: string; analysis: string }
  | {
      type: 'character-state'
      characterId: string
      state: 'evaluating' | 'replying' | 'failed' | 'idle'
    }
  | { type: 'node-enter'; nodeId: string; nodeType: FlowStepType }
  | { type: 'node-exit'; nodeId: string }
  | {
      type: 'node-output'
      nodeId: string
      text: string
      /** 原始模型交换；非模型步骤或不产出时缺省。 */
      raw?: FlowNodeRawExchange
    }
  | { type: 'variables'; variables: Record<string, string> }
  | { type: 'context-usage'; characterId: string; usage: ContextUsage }

/** 事件出口函数。 */
export type TurnEventSink = (event: TurnStreamEvent) => void
