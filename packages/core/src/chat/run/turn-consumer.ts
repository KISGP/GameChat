/**
 * @description 运行消费器：把流程引擎事件翻译为对外聊天事件，并包容运行失败。
 * @remarks 引擎直接推进流程图，事件经同步 emit 出口到达；一条流可以包含多个回合，
 *   turn-started 切换当前 assistant 消息，turn-committed 刷新会话快照。
 */
import type { FlowPackage, ResolvedModelConfig } from '@gamechat/type'
import type { ContextBudget } from '../model'
import type { AgentToolPackage } from '../../tools'
import type { ChatImageInput, ConversationSession } from '@gamechat/type'
import { recordTraceEvent } from '../../infra/trace'
import type { ChatContextProvider, ChatRuntimeDependencies, ScheduledParticipant, TurnOutcome } from '../types'
import type { SessionStore } from '../session'
import type { TurnStateValue } from '../engine/turn-state'
import { runFlow } from '../flow/engine'
import type { RunRegistry } from './run-registry'
import type { RunEventPublisher } from './run-event-publisher'
import { isAbortError, toErrorMessage } from './run-errors'

/** @description 运行消费依赖：事件发布、会话存储与流程引擎所需的宿主回调。 */
export type TurnConsumerDeps = {
  runRegistry: RunRegistry
  sessionStore: SessionStore
  chatContext: ChatContextProvider
  eventPublisher: RunEventPublisher
  dependencies: ChatRuntimeDependencies
  /**
   * @description 读取当前轮次的实时图片。
   * @param sessionId 会话 ID。
   * @param messageIds 本轮用户消息 ID。
   * @returns 处理后的实时图片输入。
   */
  loadCurrentImages: (sessionId: string, messageIds: string[]) => Promise<ChatImageInput[]>
  /**
   * @description 解析当前回合生效的上下文预算。
   * @param contextWindow 生效模型条目配置的窗口容量。
   * @returns 生效的上下文预算。
   */
  resolveContextBudget: (contextWindow: number | undefined) => Promise<ContextBudget>
  /** @description 加载当前发言角色的状态卡段。 */
  loadStateCardSections: (
    session: ConversationSession,
    characterId: string
  ) => Promise<string[]>
  /** @description 加载当前发言角色的记忆段。 */
  loadMemorySections: (session: ConversationSession, characterId: string) => Promise<string[]>
  /** @description 回合前压缩。 */
  compressBeforeTurn: (sessionId: string) => Promise<void>
  /** @description 按生效策略解析对模型可见的工具包。 */
  resolveToolPackages: (state: TurnStateValue) => Promise<AgentToolPackage[]>
}

/** 一次运行执行的输入。 */
export type TurnExecutionInput = {
  flow: FlowPackage
  requestId: string
  sessionId: string
  modelConfig: ResolvedModelConfig
  currentMessageIds: string[]
  participantNames: Record<string, string>
  participants: ScheduledParticipant[]
}

/**
 * @description 执行一次完整聊天运行并翻译流程事件。
 * @param deps 运行消费依赖。
 * @param input 运行上下文。
 * @returns 运行结果。
 * @remarks 流式 token 以 character-stream 增量事件直发渲染层；会话状态只在占位创建、
 *   回合提交与图片分析等结构性时点变化。失败与中断按当前回合就地包容。
 */
export async function runFlowRun(
  deps: TurnConsumerDeps,
  input: TurnExecutionInput
): Promise<TurnOutcome> {
  const activeRun = deps.runRegistry.get(input.requestId)
  if (!activeRun) return { status: 'aborted' }

  let currentMessageId = ''
  let currentCharacterId = ''

  try {
    await runFlow({
      flow: input.flow,
      requestId: input.requestId,
      sessionId: input.sessionId,
      modelConfig: input.modelConfig,
      currentMessageIds: input.currentMessageIds,
      participantNames: input.participantNames,
      participants: input.participants,
      sessionStore: deps.sessionStore,
      chatContext: deps.chatContext,
      dependencies: deps.dependencies,
      resolveContextBudget: deps.resolveContextBudget,
      loadCurrentImages: deps.loadCurrentImages,
      loadStateCardSections: deps.loadStateCardSections,
      loadMemorySections: deps.loadMemorySections,
      compressBeforeTurn: deps.compressBeforeTurn,
      resolveToolPackages: deps.resolveToolPackages,
      abortSignal: activeRun.controller.signal,
      emit: (event) => {
        switch (event.type) {
          case 'turn-started': {
            currentMessageId = event.assistantMessageId
            currentCharacterId = event.characterId
            deps.eventPublisher.publish({
              type: 'session-synced',
              requestId: input.requestId,
              session: event.session,
              summary: deps.sessionStore.getRequiredSessionSummary(input.sessionId)
            })
            return
          }
          case 'turn-committed': {
            deps.eventPublisher.publish({
              type: 'session-synced',
              requestId: input.requestId,
              session: event.session,
              summary: deps.sessionStore.getRequiredSessionSummary(input.sessionId)
            })
            // 提交后清空当前消息指针：后续选人/开始回合失败不能再落到已提交的气泡上。
            currentMessageId = ''
            currentCharacterId = ''
            return
          }
          case 'token': {
            deps.runRegistry.trackChunk(input.requestId, event.text)
            if (currentMessageId) {
              deps.eventPublisher.publish({
                type: 'character-stream',
                requestId: input.requestId,
                sessionId: input.sessionId,
                messageId: currentMessageId,
                text: event.text
              })
            }
            return
          }
          case 'tool-trace': {
            recordTraceEvent('tool-trace', { ...event.trace })
            return
          }
          case 'image-analysis': {
            const synced = deps.sessionStore.updateImageAnalysis(
              input.sessionId,
              event.resourceId,
              event.analysis
            )
            deps.eventPublisher.publish({
              type: 'session-synced',
              requestId: input.requestId,
              session: synced,
              summary: deps.sessionStore.getRequiredSessionSummary(input.sessionId)
            })
            return
          }
          case 'character-state': {
            deps.eventPublisher.publish({
              type: 'character-state',
              requestId: input.requestId,
              sessionId: input.sessionId,
              characterId: event.characterId,
              state: event.state
            })
            return
          }
          default:
            return
        }
      }
    })
    return { status: 'completed' }
  } catch (error) {
    return containTurnError(
      deps,
      {
        requestId: input.requestId,
        sessionId: input.sessionId,
        characterId: currentCharacterId
      },
      currentMessageId,
      error
    )
  }
}

/**
 * @description 运行失败的就地包容：中断或错误都保证会话与事件契约完整。
 * @param deps 运行消费依赖。
 * @param input 运行与当前回合标识。
 * @param assistantMessageId 当前回合占位消息 ID；尚未创建时为空字符串。
 * @param error 运行异常。
 * @returns 运行结果。
 * @remarks 中断：群聊回合删除半截消息，单角色回合保留 aborted 气泡；失败：错误信息写入消息的
 *   errorMessage 字段供失败徽章展示，气泡正文只保留已生成的半截内容。已提交的回合不受影响。
 */
export function containTurnError(
  deps: TurnConsumerDeps,
  input: {
    requestId: string
    sessionId: string
    characterId: string
  },
  assistantMessageId: string,
  error: unknown
): TurnOutcome {
  const activeRun = deps.runRegistry.get(input.requestId)
  const aborted = (activeRun?.controller.signal.aborted ?? true) || isAbortError(error)
  const session = deps.sessionStore.getSession(input.sessionId)
  const isGroupTurn = (session?.participants.length ?? 1) > 1

  if (!assistantMessageId) {
    if (aborted) return { status: 'aborted' }
    throw error
  }

  if (aborted) {
    const synced = isGroupTurn
      ? deps.sessionStore.deleteMessage(input.sessionId, assistantMessageId, true)
      : deps.sessionStore.updateAssistantRunStatus(input.sessionId, assistantMessageId, 'aborted')
    deps.eventPublisher.publish({
      type: 'session-synced',
      requestId: input.requestId,
      session: synced,
      summary: deps.sessionStore.getRequiredSessionSummary(input.sessionId)
    })
    return { status: 'aborted', characterId: input.characterId }
  }

  const message = toErrorMessage(error)
  // 会话落定状态由 run 收尾统一写入；这里只落消息级失败状态与错误信息。
  const synced = deps.sessionStore.updateAssistantRunStatus(
    input.sessionId,
    assistantMessageId,
    'error',
    message
  )
  deps.eventPublisher.publish({
    type: 'session-synced',
    requestId: input.requestId,
    session: synced,
    summary: deps.sessionStore.getRequiredSessionSummary(input.sessionId)
  })
  return { status: 'error', errorMessage: message, characterId: input.characterId }
}
