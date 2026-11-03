import { logger } from '../../infra/log'
import type { ChatContextProvider, TurnOutcome } from '../types'
import type { SessionStore } from '../session'
import type { ActiveRun } from './run-registry'
import type { RunEventPublisher } from './run-event-publisher'
import { isAbortError, toErrorMessage } from './run-errors'

/** @description 运行收尾协作对象：终态翻译所需的共享服务依赖。 */
export type RunFinisherDeps = {
  sessionStore: SessionStore
  chatContext: ChatContextProvider
  eventPublisher: RunEventPublisher
}

/**
 * @description 翻译调度完成后的会话落定状态与终态事件。
 * @param deps 运行收尾协作对象。
 * @param input 运行上下文。
 * @param outcome 调度最终状态。
 * @param activeRun 已注销的运行快照，用于终态事件与日志统计。
 * @remarks 调用前必须先从注册表注销本运行；运行态由派生规则自动回落，中断不写任何落定状态。
 */
export function finishRun(
  deps: RunFinisherDeps,
  input: { requestId: string; sessionId: string },
  outcome: TurnOutcome,
  activeRun: ActiveRun | undefined
): void {
  if (outcome.status === 'completed') {
    const synced = deps.sessionStore.setSessionRestingStatus(input.sessionId, 'idle')
    deps.eventPublisher.publish({
      type: 'session-synced',
      requestId: input.requestId,
      session: synced,
      summary: deps.sessionStore.getRequiredSessionSummary(input.sessionId)
    })
    deps.eventPublisher.publish({
      type: 'run-finished',
      requestId: input.requestId,
      sessionId: input.sessionId,
      messageId: activeRun?.messageId || ''
    })
    return
  }
  if (outcome.status === 'aborted') {
    publishRestingSnapshot(deps, input)
    deps.eventPublisher.publish({
      type: 'run-aborted',
      requestId: input.requestId,
      sessionId: input.sessionId,
      messageId: activeRun?.messageId || ''
    })
    void logger.warn('ai', 'run-aborted', 'Chat run aborted', {
      requestId: input.requestId,
      sessionId: input.sessionId,
      messageId: activeRun?.messageId,
      characterId: outcome.characterId,
      durationMs: activeRun ? Date.now() - activeRun.startedAt : undefined,
      chunkCount: activeRun?.chunkCount ?? 0,
      charCount: activeRun?.charCount ?? 0
    })
    return
  }
  const synced = deps.sessionStore.setSessionRestingStatus(input.sessionId, 'error')
  deps.eventPublisher.publish({
    type: 'session-synced',
    requestId: input.requestId,
    session: synced,
    summary: deps.sessionStore.getRequiredSessionSummary(input.sessionId)
  })
  deps.eventPublisher.publish({
    type: 'run-error',
    requestId: input.requestId,
    sessionId: input.sessionId,
    messageId: activeRun?.messageId || '',
    error: outcome.errorMessage || 'Chat run failed'
  })
  void logger.error('ai', 'run-error', 'Chat run failed', {
    requestId: input.requestId,
    sessionId: input.sessionId,
    messageId: activeRun?.messageId,
    characterId: outcome.characterId,
    durationMs: activeRun ? Date.now() - activeRun.startedAt : undefined,
    error: outcome.errorMessage
  })
}

/**
 * @description 将调度循环中逃逸的异常翻译为失败的运行终态。
 * @param deps 运行收尾协作对象。
 * @param input 运行上下文。
 * @param error 运行异常。
 * @param activeRun 已注销的运行快照，用于终态事件与日志统计。
 * @remarks 中断不写任何落定状态；错误落定 error 并以最新派生快照广播。
 */
export function finishRunAsFailure(
  deps: RunFinisherDeps,
  input: { requestId: string; sessionId: string },
  error: unknown,
  activeRun: ActiveRun | undefined
): void {
  const aborted = (activeRun?.controller.signal.aborted ?? false) || isAbortError(error)
  if (aborted) {
    publishRestingSnapshot(deps, input)
    deps.eventPublisher.publish({
      type: 'run-aborted',
      requestId: input.requestId,
      sessionId: input.sessionId,
      messageId: activeRun?.messageId || ''
    })
    return
  }
  const message = toErrorMessage(error)
  const synced = deps.sessionStore.setSessionRestingStatus(input.sessionId, 'error')
  deps.eventPublisher.publish({
    type: 'session-synced',
    requestId: input.requestId,
    session: synced,
    summary: deps.sessionStore.getRequiredSessionSummary(input.sessionId)
  })
  void logger.error('ai', 'run-error', 'Chat run failed', {
    requestId: input.requestId,
    sessionId: input.sessionId,
    messageId: activeRun?.messageId,
    durationMs: activeRun ? Date.now() - activeRun.startedAt : undefined,
    error: message
  })
  deps.eventPublisher.publish({
    type: 'run-error',
    requestId: input.requestId,
    sessionId: input.sessionId,
    messageId: activeRun?.messageId || '',
    error: message
  })
}

/**
 * @description 以当前派生快照广播一次会话同步（快照随注册表注销自然回落为落定状态）。
 * @param deps 运行收尾协作对象。
 * @param input 运行上下文。
 */
export function publishRestingSnapshot(
  deps: RunFinisherDeps,
  input: { requestId: string; sessionId: string }
): void {
  const session = deps.sessionStore.getSession(input.sessionId)
  if (!session) return
  const summary = deps.sessionStore.getSessionSummary(input.sessionId)
  if (!summary) return
  deps.eventPublisher.publish({
    type: 'session-synced',
    requestId: input.requestId,
    session,
    summary
  })
}
