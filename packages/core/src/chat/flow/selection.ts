/**
 * @description 群聊选人：按点名、意愿评分或参与者顺序选出下一位发言者。
 * @remarks 选人发生在回合之外，只读会话快照与参与者清单，不写会话状态；
 *   意愿评分沿用统一历史 builder 与预算截断口径，评分失败按 0 分处理并记录日志。
 */
import type {
  ConversationSession,
  FlowNodeRawExchange,
  FlowSelectionSource,
  FlowSelectionTieBreak
} from '@gamechat/type'
import type { ResolvedModelConfig } from '@gamechat/type'
import { AIMessage, SystemMessage, type AIMessageChunk } from '@langchain/core/messages'
import { FLOW_INTENT_TEMPLATE_VARIABLES, interpolateTemplate } from '@gamechat/schema'
import { logger } from '../../infra/log'
import { getTraceCallbacks, recordTraceEvent, withTrace } from '../../infra/trace'
import {
  buildSessionHistoryView,
  buildSummarySectionText,
  contentToText,
  createChatModel,
  estimateTextTokens,
  getTokenCalibration,
  joinPromptSections,
  parseIntentScore,
  renderHistoryMessages,
  truncateRenderedMessages,
  type ContextBudget
} from '../model'
import type { ScheduledParticipant } from '../types'
import type { TurnStreamEvent } from '../engine/turn-state'
import { serializeExchange } from '../engine/agent-loop'
import { readCurrentUserText } from './scope'

/** 默认意愿阈值：与历史调度口径一致。 */
const DEFAULT_INTENT_THRESHOLD = 60

/** 选人步骤输入。 */
export type SelectionInput = {
  /** 选人来源。 */
  source: FlowSelectionSource
  /** 意愿阈值（0~100）；缺省 60。 */
  threshold?: number
  /** 最高分并列时的取舍方式；缺省随机。 */
  tieBreak?: FlowSelectionTieBreak
  /** 意愿评分提示词模板，{{name}} 与 {{character_prompt}} 指被评估角色；由流程引擎保证非空。 */
  intentPromptText: string
  participants: ScheduledParticipant[]
  /** 本轮已经发言过的参与者 ID；仅 mentioned/first/random 用于排除，意愿评分不排除。 */
  spoken: ReadonlySet<string>
  session: ConversationSession
  currentMessageIds: string[]
  requestId: string
  modelConfig: ResolvedModelConfig
  /**
   * @description 解析意愿评分使用的上下文预算。
   * @param contextWindow 生效模型条目配置的窗口容量。
   * @returns 生效的上下文预算。
   */
  resolveContextBudget: (contextWindow: number | undefined) => Promise<ContextBudget>
  /** @description 返回当前运行的取消信号。 */
  getAbortSignal: () => AbortSignal
  /** 引擎事件出口：评分状态变化经此发出。 */
  emit: (event: TurnStreamEvent) => void
}

/** 选人结果：未命中时为 null。 */
export type SelectionResult = {
  participant: ScheduledParticipant | null
  source: FlowSelectionSource
  /** intent 来源的评分明细（按角色名，附各候选的原始模型交换）；其余来源缺省。 */
  scores?: Array<{ name: string; score: number; exchange?: FlowNodeRawExchange }>
}

/**
 * @description 选出下一位发言者。
 * @param input 选人输入。
 * @returns 选人结果；没有符合条件的参与者时 participant 为 null。
 * @remarks mentioned/first/random 排除已发言者（一轮收尾）；intent 不排除——
 *   停机由阈值驱动，全员低于阈值即冷场结束，对话得以持续多轮。
 */
export async function selectSpeaker(input: SelectionInput): Promise<SelectionResult> {
  // 其余来源没有独立停机条件（点名文本与顺序逐回合相同），排除已发言者保证一轮收尾。
  const candidates =
    input.source === 'intent'
      ? input.participants
      : input.participants.filter((participant) => !input.spoken.has(participant.character.id))
  switch (input.source) {
    case 'mentioned': {
      const mentioned = findMentionedParticipants(input, candidates)
      return { participant: mentioned[0] ?? null, source: 'mentioned' }
    }
    case 'intent': {
      const intent = await selectByIntent(input, candidates)
      return {
        participant: intent.participant,
        source: 'intent',
        ...(intent.scores ? { scores: intent.scores } : {})
      }
    }
    case 'first':
      return { participant: candidates[0] ?? null, source: 'first' }
    case 'random': {
      if (candidates.length === 0) {
        return { participant: null, source: 'random' }
      }
      const index = Math.floor(Math.random() * candidates.length)
      return { participant: candidates[index] ?? null, source: 'random' }
    }
  }
}

/**
 * @description 从最新一批用户消息提取依书写顺序出现的参与者点名。
 * @param input 选人输入。
 * @param candidates 尚未发言的参与者。
 * @returns 去重后的点名参与者，保留首次出现顺序。
 * @remarks 点名格式固定为 `@角色名`：在用户消息中搜索该文本，搜到即视为点名。
 */
function findMentionedParticipants(
  input: SelectionInput,
  candidates: ScheduledParticipant[]
): ScheduledParticipant[] {
  const text = readCurrentUserText(input.session, input.currentMessageIds)
  return candidates
    .map((participant) => ({
      participant,
      index: text.indexOf(`@${participant.character.name}`)
    }))
    .filter((match) => match.index >= 0)
    .sort((left, right) => left.index - right.index)
    .map((match) => match.participant)
}

/**
 * @description 并行评估候选成员的发言意愿，并按阈值与并列规则选出下一位。
 * @param input 选人输入。
 * @param candidates 参与评分的候选（含已发言者，评分每回合对全员重新进行）。
 * @returns 选中的参与者；无人达标时返回 null。
 */
async function selectByIntent(
  input: SelectionInput,
  candidates: ScheduledParticipant[]
): Promise<{ participant: ScheduledParticipant | null; scores: Array<{ name: string; score: number }> }> {
  if (candidates.length === 0) {
    return { participant: null, scores: [] }
  }
  const threshold = input.threshold ?? DEFAULT_INTENT_THRESHOLD
  const scores = await Promise.all(
    candidates.map(async (participant) => {
      const assessment = await assessIntent(input, participant)
      return {
        participant,
        score: assessment.score,
        exchange: assessment.exchange
      }
    })
  )
  const highest = Math.max(...scores.map((item) => item.score))
  const detail = scores.map(({ participant, score, exchange }) => ({
    name: participant.character.name,
    score,
    exchange
  }))
  if (highest < threshold) {
    recordTraceEvent('group-schedule-stopped', {
      reason: 'intent-below-threshold',
      threshold,
      scores: scores.map(({ participant, score }) => ({
        characterId: participant.character.id,
        score
      }))
    })
    return { participant: null, scores: detail }
  }
  const tied = scores.filter((item) => item.score === highest)
  const selected =
    input.tieBreak === 'first'
      ? tied[0].participant
      : tied[Math.floor(Math.random() * tied.length)].participant
  recordTraceEvent('group-participant-selected', {
    characterId: selected.character.id,
    highest,
    tieBreak: input.tieBreak ?? 'random',
    tiedCharacterIds: tied.map((item) => item.participant.character.id),
    scores: scores.map(({ participant, score }) => ({
      characterId: participant.character.id,
      score
    }))
  })
  return { participant: selected, scores: detail }
}

/**
 * @description 让单个角色评估其此刻是否需要主动插话。
 * @param input 选人输入。
 * @param participant 正在评估的角色。
 * @returns 规范化后的 0-100 发言意愿与本次评分的原始模型交换；请求失败时只返回 0 分、无交换。
 * @remarks 评分使用会话主模型、无工具直调并复用统一历史 builder；评分 system 由提示词模板
 *   经 {{变量}} 插值组装（被评估角色的名字与人格由引擎注入），历史按窗口墙与终答
 *   同一口径截断，意愿评分 system 段与滚动摘要一并作为扣除项。
 */
async function assessIntent(
  input: SelectionInput,
  participant: ScheduledParticipant
): Promise<{ score: number; exchange?: FlowNodeRawExchange }> {
  const signal = input.getAbortSignal()
  const characterNames = new Map(
    input.participants.map((item) => [item.character.id, item.character.name])
  )
  input.emit({ type: 'character-state', characterId: participant.character.id, state: 'evaluating' })
  try {
    const budget = await input.resolveContextBudget(input.modelConfig.contextWindow)
    const result = await withTrace(
      'group-intent',
      {
        sessionId: input.session.id,
        metadata: {
          requestId: input.requestId,
          characterId: participant.character.id
        }
      },
      async () => {
        const history = buildSessionHistoryView(input.session)
        const calibration = getTokenCalibration().getCoefficient(input.modelConfig.modelId)
        const summarySection = buildSummarySectionText(input.session)
        const systemText = interpolateTemplate(input.intentPromptText, {
          variables: {
            [FLOW_INTENT_TEMPLATE_VARIABLES.name]: participant.character.name,
            [FLOW_INTENT_TEMPLATE_VARIABLES.characterPrompt]: participant.prompt
          },
          lastUser: readCurrentUserText(input.session, input.currentMessageIds)
        })
        const intentPromptText = joinPromptSections([
          { text: systemText },
          ...(summarySection ? [{ text: summarySection }] : [])
        ])
        const systemReserveTokens = Math.ceil(estimateTextTokens(intentPromptText) * calibration)
        const truncated = truncateRenderedMessages(
          renderHistoryMessages(history, { isGroup: true, characterNames }),
          {
            maxTokens: Math.max(0, budget.wallTokens - systemReserveTokens),
            imageTokenEstimate: budget.imageTokenEstimate,
            calibration
          }
        )
        const messages = [new SystemMessage(intentPromptText), ...truncated.messages]
        const model = createChatModel(input.modelConfig, { callbacks: getTraceCallbacks() })
        const stream = await model.stream(messages, { signal })
        let text = ''
        for await (const chunk of stream as AsyncIterable<AIMessageChunk>) {
          text += contentToText(chunk.content)
        }
        return serializeExchange(messages, new AIMessage(text))
      }
    )
    const score = parseIntentScore(result.content)
    if (score === null) {
      throw new Error('Intent response did not contain a valid <intent> score.')
    }
    recordTraceEvent('group-intent-assessed', {
      characterId: participant.character.id,
      score,
      rawResponse: result.content
    })
    return { score, exchange: result }
  } catch (error) {
    if (signal.aborted) throw error
    void logger.warn('ai', 'group-intent-failed', 'Group chat intent assessment failed', {
      requestId: input.requestId,
      sessionId: input.session.id,
      characterId: participant.character.id,
      error: error instanceof Error ? error.message : String(error)
    })
    input.emit({ type: 'character-state', characterId: participant.character.id, state: 'failed' })
    return { score: 0 }
  } finally {
    if (!signal.aborted) {
      input.emit({ type: 'character-state', characterId: participant.character.id, state: 'idle' })
    }
  }
}
