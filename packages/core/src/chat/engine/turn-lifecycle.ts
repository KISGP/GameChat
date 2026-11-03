/**
 * @description 回合生命周期：装配（角色资料/历史/预算/注入段/占位）与提交（表情分段/落库）。
 * @remarks 引擎在第一个需要回合的步骤前调用装配、终答完成后调用提交；装配顺序（加载 → 装配 → 压缩预检）
 *   与落库账务收敛在本模块，主进程运行时与编排调试共用同一份实现。
 */
import type { ChatImageInput, ConversationSession } from '@gamechat/type'
import type { ResolvedModelConfig } from '@gamechat/type'
import type { ChatEmoticonImage } from '@gamechat/schema'
import { logger } from '../../infra/log'
import { getUserEmoticons } from '../media'
import {
  buildSessionHistoryView,
  estimateTextTokens,
  getTokenCalibration,
  renderHistoryMessages,
  splitAssistantMessageSegments,
  truncateRenderedMessages,
  type ContextBudget
} from '../model'
import { now, type SessionStore } from '../session'
import type { ChatContextProvider, ChatRuntimeDependencies, ScheduledParticipant } from '../types'
import { buildFinalSystemText, buildHistoryOmittedSectionText } from './steps'
import type { TurnStateValue, TurnStreamEvent } from './turn-state'

/** 回合生命周期依赖：一次运行内不变的宿主回调与运行上下文。 */
export type TurnLifecycleDeps = {
  requestId: string
  sessionId: string
  modelConfig: ResolvedModelConfig
  currentMessageIds: string[]
  participantNames: Record<string, string>
  sessionStore: SessionStore
  chatContext: ChatContextProvider
  dependencies: ChatRuntimeDependencies
  /**
   * @description 读取当前轮次用户消息携带的实时图片，并按应用设置完成压缩处理。
   * @param sessionId 会话 ID。
   * @param messageIds 本轮用户消息 ID。
   * @returns 处理后的实时图片输入；群聊回合返回空数组。
   */
  loadCurrentImages: (sessionId: string, messageIds: string[]) => Promise<ChatImageInput[]>
  /**
   * @description 解析当前回合生效的上下文预算。
   * @param contextWindow 生效模型条目配置的窗口容量；未配置时为 undefined。
   * @returns 生效的上下文预算。
   */
  resolveContextBudget: (contextWindow: number | undefined) => Promise<ContextBudget>
  /**
   * @description 加载当前发言角色在会话中的状态卡提示词段。
   * @param session 当前会话快照。
   * @param characterId 当前发言角色 ID。
   * @returns 状态卡段文本数组；该角色尚无状态卡时为空数组。
   */
  loadStateCardSections: (
    session: ConversationSession,
    characterId: string
  ) => Promise<string[]>
  /**
   * @description 加载当前发言角色的记忆段（整份常驻注入）。
   * @param session 当前会话快照。
   * @param characterId 当前发言角色 ID。
   * @returns 记忆段文本数组；记忆关闭、无内容或读取失败时为空数组。
   */
  loadMemorySections: (session: ConversationSession, characterId: string) => Promise<string[]>
  /**
   * @description 在会话串行队列内执行一次回合前压缩（默认保留窗口）。
   * @param sessionId 目标会话 ID。
   * @returns 无返回值；压无可压时静默返回，调用失败时向上抛出。
   */
  compressBeforeTurn: (sessionId: string) => Promise<void>
  /** 引擎事件出口。 */
  emit: (event: TurnStreamEvent) => void
  /** 当前运行的取消信号。 */
  abortSignal: AbortSignal
}

/** 回合生命周期：一次角色发言的开始与提交。 */
export type TurnLifecycle = {
  /**
   * @description 开始一个角色回合：装配角色资料、历史、预算与注入段，创建 assistant 占位。
   * @param participant 本次发言的成员。
   * @returns 已装配的回合状态。
   */
  begin: (participant: ScheduledParticipant) => Promise<TurnStateValue>
  /**
   * @description 提交一个角色回合：按表情标记分段并落库，返回提交后的会话快照。
   * @param state 当前回合状态。
   * @returns 提交后的会话快照。
   */
  commit: (state: TurnStateValue) => ConversationSession
}

/** 装配输入：回合状态中尚未产出的部分。 */
type AssembleInput = {
  session: ConversationSession
  participantNames: Record<string, string>
  assistantMessageId: string
  currentMessageIds: string[]
  currentImages: ChatImageInput[]
  modelConfig: ResolvedModelConfig
  budget: ContextBudget
  prompt: string
  character: ScheduledParticipant['character']
  characterEmoticons: ChatEmoticonImage[]
  stateCardSections: string[]
  memorySections: string[]
}

/** 装配产物：写入回合状态的模型输入与预算基线。 */
type AssembleOutput = Pick<
  TurnStateValue,
  | 'history'
  | 'llmMessages'
  | 'systemReserveTokens'
  | 'historyEstimateTokens'
  | 'historyOmittedCount'
>

/**
 * @description 创建回合生命周期。
 * @param deps 运行上下文与宿主回调。
 * @returns 回合生命周期实例。
 */
export function createTurnLifecycle(deps: TurnLifecycleDeps): TurnLifecycle {
  return {
    begin: async (participant) => {
      const currentSession = deps.sessionStore.getSession(deps.sessionId)
      if (!currentSession) {
        throw new Error(`Session not found: ${deps.sessionId}`)
      }
      const isGroupTurn = currentSession.participants.length > 1
      const [policy, characterEmoticons, userEmoticons] = await Promise.all([
        deps.chatContext.getAgentPolicy(),
        deps.dependencies.getCharacterEmoticons(participant.character.id),
        getUserEmoticons()
      ])
      const begun = deps.sessionStore.beginRun(
        deps.sessionId,
        participant.character.id,
        deps.modelConfig.modelId,
        false
      )
      deps.emit({
        type: 'turn-started',
        characterId: participant.character.id,
        assistantMessageId: begun.assistantMessage.id,
        session: begun.session
      })
      const currentImages = isGroupTurn
        ? []
        : await deps.loadCurrentImages(deps.sessionId, deps.currentMessageIds)
      const budget = await deps.resolveContextBudget(deps.modelConfig.contextWindow)
      // session 是装载器的当前快照：占位已创建，装配以 begun.session 为准。
      let session = begun.session
      let stateCardSections = await deps.loadStateCardSections(
        begun.session,
        participant.character.id
      )
      let memorySections = await deps.loadMemorySections(
        begun.session,
        participant.character.id
      )
      let assembled = assembleTurnInputs({
        session,
        participantNames: deps.participantNames,
        assistantMessageId: begun.assistantMessage.id,
        currentMessageIds: deps.currentMessageIds,
        currentImages,
        modelConfig: deps.modelConfig,
        budget,
        prompt: participant.prompt,
        character: participant.character,
        characterEmoticons,
        stateCardSections,
        memorySections
      })

      const shouldCompress =
        assembled.systemReserveTokens + assembled.historyEstimateTokens >= budget.budgetTokens
      if (shouldCompress) {
        void logger.info(
          'ai',
          'turn-preflight-compress-start',
          'Turn input reached the context budget; compressing before the turn',
          { requestId: deps.requestId, sessionId: deps.sessionId }
        )
        try {
          await deps.compressBeforeTurn(deps.sessionId)
        } catch (error) {
          void logger.warn(
            'ai',
            'turn-preflight-compress-failed',
            'Pre-turn compression failed; continuing with truncation backstop',
            {
              requestId: deps.requestId,
              sessionId: deps.sessionId,
              error: error instanceof Error ? error.message : String(error)
            }
          )
        }
        session = deps.sessionStore.getSession(deps.sessionId) ?? session
        stateCardSections = await deps.loadStateCardSections(
          session,
          participant.character.id
        )
        memorySections = await deps.loadMemorySections(session, participant.character.id)
        assembled = assembleTurnInputs({
          session,
          participantNames: deps.participantNames,
          assistantMessageId: begun.assistantMessage.id,
          currentMessageIds: deps.currentMessageIds,
          currentImages,
          modelConfig: deps.modelConfig,
          budget,
          prompt: participant.prompt,
          character: participant.character,
          characterEmoticons,
          stateCardSections,
          memorySections
        })
      }

      return {
        requestId: deps.requestId,
        sessionId: deps.sessionId,
        modelId: deps.modelConfig.modelId,
        characterId: participant.character.id,
        currentMessageIds: deps.currentMessageIds,
        currentImages,
        modelConfig: deps.modelConfig,
        budget,
        systemReserveTokens: assembled.systemReserveTokens,
        historyEstimateTokens: assembled.historyEstimateTokens,
        policy,
        participantNames: deps.participantNames,
        session,
        character: participant.character,
        characterEmoticons,
        userEmoticons,
        prompt: participant.prompt,
        history: assembled.history,
        llmMessages: assembled.llmMessages,
        stateCardSections,
        memorySections,
        historyOmittedCount: assembled.historyOmittedCount,
        assistantMessageId: begun.assistantMessage.id,
        assistantDraft: '',
        routingMessages: [],
        pendingToolCalls: [],
        toolRounds: 0,
        incomplete: false,
        abortSignal: deps.abortSignal,
        emit: deps.emit
      }
    },

    commit: (state) => {
      const segments = splitAssistantMessageSegments(
        state.assistantDraft,
        new Set(state.characterEmoticons.map((item) => item.id))
      )
      const isGroupTurn = state.session.participants.length > 1
      const contextUsage =
        state.contextUsage ?? {
          status: 'unavailable' as const,
          modelId: state.modelConfig.modelId,
          recordedAt: now(),
          budgetTokens: state.budget.budgetTokens,
          estimatedTokens: state.systemReserveTokens + state.historyEstimateTokens
        }
      const session = deps.sessionStore.syncAssistantRunMessages(
        deps.sessionId,
        state.assistantMessageId,
        state.characterId,
        segments.length > 0 ? segments : [{ type: 'text', text: state.assistantDraft.trim() }],
        new Map(state.characterEmoticons.map((item) => [item.id, item.description] as const)),
        'complete',
        contextUsage,
        isGroupTurn ? undefined : 'idle'
      )
      deps.emit({
        type: 'turn-committed',
        characterId: state.characterId,
        assistantMessageId: state.assistantMessageId,
        session
      })
      deps.emit({ type: 'context-usage', characterId: state.characterId, usage: contextUsage })
      return session
    }
  }
}

/**
 * @description 装配回合输入：筛选有效历史、渲染为模型消息并按窗口墙从最旧端截断。
 * @param input 装配输入，两类注入段须已装载。
 * @returns 装配产物：历史视图、llmMessages、system 预留与历史估算 token。
 * @remarks 每个请求体只保留一条开头的 system：滚动摘要、历史省略说明、状态卡
 *   与角色记忆全部作为提示词段并入开头 system（由终答步骤拼装），装配只输出历史消息。
 *   system 预留按终答提示词的最坏条件连同全部注入段一并估算，装配截断、工具轨迹截断与终答
 *   共用同一扣除口径。
 */
function assembleTurnInputs(input: AssembleInput): AssembleOutput {
  const isGroupTurn = input.session.participants.length > 1
  const characterNames = new Map(Object.entries(input.participantNames))
  const history = buildSessionHistoryView(input.session, {
    excludeMessageId: input.assistantMessageId
  })
  const rendered = renderHistoryMessages(history, {
    isGroup: isGroupTurn,
    characterNames,
    currentTurn: {
      messageIds: new Set(input.currentMessageIds),
      images: input.currentImages
    }
  })
  const calibration = getTokenCalibration().getCoefficient(input.modelConfig.modelId)
  const worstCaseSystemText = buildFinalSystemText(
    {
      session: input.session,
      stateCardSections: input.stateCardSections,
      memorySections: input.memorySections,
      prompt: input.prompt,
      characterEmoticons: input.characterEmoticons,
      character: input.character,
      historyOmittedCount: 0
    },
    isGroupTurn,
    {
      hasToolEvidence: true,
      incomplete: true,
      hasRealtimeImages: input.currentImages.length > 0,
      historyOmitted: true
    }
  )
  const systemReserveTokens = Math.ceil(estimateTextTokens(worstCaseSystemText) * calibration)
  const truncated = truncateRenderedMessages(rendered, {
    maxTokens: Math.max(0, input.budget.wallTokens - systemReserveTokens),
    imageTokenEstimate: input.budget.imageTokenEstimate,
    calibration
  })
  const markerSection = buildHistoryOmittedSectionText(truncated.droppedCount)
  const markerEstimateTokens = markerSection
    ? Math.ceil(estimateTextTokens(markerSection) * calibration)
    : 0
  return {
    history,
    llmMessages: [...truncated.messages],
    systemReserveTokens: systemReserveTokens + markerEstimateTokens,
    historyEstimateTokens: truncated.estimateTokens,
    historyOmittedCount: truncated.droppedCount
  }
}
