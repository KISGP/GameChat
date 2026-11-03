/**
 * @description 生成段步骤的共享实现：终答步骤与终答 system 拼装。
 * @remarks 流程引擎直接调用本模块的步骤工厂，禁止分叉实现；步骤经回合状态的 emit 出口
 *   发送流式增量与图片分析事件，不再依赖 LangGraph 运行时。
 */
import {
  SystemMessage,
  AIMessage,
  type AIMessageChunk,
  type BaseMessage
} from '@langchain/core/messages'
import type { ContextUsage, FlowNodeRawExchange } from '@gamechat/type'
import type { ResolvedModelConfig } from '@gamechat/type'
import { logger } from '../../infra/log'
import { now } from '../session'
import {
  buildFinalSystemPrompt,
  buildSummarySectionText,
  contentToText,
  createChatModel,
  estimateMessagesTokens,
  estimateTextTokens,
  getTokenCalibration,
  joinPromptSections,
  parseStructuredAssistantResponse
} from '../model'
import { getTraceCallbacks } from '../../infra/trace'
import { serializeExchange } from './agent-loop'
import type { TurnStateValue } from './turn-state'

/** 终答步骤配置：模板渲染由流程解释器注入，步骤本身不感知流程变量。 */
export type FinalAnswerStepOptions = {
  /** 流程节点提供的终答提示词渲染器；缺省使用内置终答提示词。 */
  renderSystemPrompt?: (state: TurnStateValue) => string
}


/**
 * @description 创建终答步骤：以未绑定工具、带角色人格的模型流式生成最终回复。
 * @param options 步骤配置：自定义 system 渲染。
 * @returns finalAnswer 步骤函数。
 * @remarks 始终流式输出文本增量；图片输入轮次固定下发并嗅探 JSON 结构化回复协议，嗅探条件必须与
 *   协议下发条件一致。请求装配完全由流程掌控：消息只含开头 system 与回合装配的历史，
 *   工具证据由流程模板显式引用（{{tool_trace}} 或整理节点产出变量），引擎不追加任何轨迹。
 */
export function createFinalAnswerNode(options: FinalAnswerStepOptions = {}) {
  return async (
    state: TurnStateValue
  ): Promise<Partial<TurnStateValue> & { replyExchange?: FlowNodeRawExchange }> => {
    const isGroupTurn = state.session.participants.length > 1
    const expectsStructuredReply = state.currentImages.length > 0
    const promptText = options.renderSystemPrompt
      ? options.renderSystemPrompt(state)
      : buildFinalSystemText(state, isGroupTurn, {
          hasToolEvidence: state.routingMessages.some((message) => message.getType() === 'tool'),
          incomplete: state.incomplete,
          hasRealtimeImages: expectsStructuredReply,
          historyOmitted: state.historyOmittedCount > 0
        })
    const calibration = getTokenCalibration().getCoefficient(state.modelConfig.modelId)
    const messages: BaseMessage[] = [
      new SystemMessage(promptText),
      ...state.llmMessages
    ]
    const finalCallRawEstimate =
      estimateTextTokens(promptText) +
      estimateMessagesTokens(messages.slice(1), state.budget.imageTokenEstimate)
    const model = createChatModel(state.modelConfig, { callbacks: getTraceCallbacks() })
    const stream = await model.stream(messages, { signal: state.abortSignal })

    let assistantDraft = ''
    let streamedStructured = false
    let streamBuffer = ''
    let aggregatedChunk: AIMessageChunk | null = null
    for await (const chunk of stream as AsyncIterable<AIMessageChunk>) {
      // 各供应商的用量可能拆在多个 chunk 上（收尾块的输入量可为 0），必须经 concat 按求和语义
      // 聚合后才得到完整 usage_metadata；聚合先于文本判空，避免漏收没有文本的用量块。
      aggregatedChunk = aggregatedChunk ? aggregatedChunk.concat(chunk) : chunk
      const text = contentToText(chunk.content)
      if (!text) continue
      if (!streamedStructured) {
        streamBuffer += text
        if (expectsStructuredReply && streamBuffer.trimStart().startsWith('{')) {
          streamedStructured = true
          continue
        }
        assistantDraft += text
        state.emit({ type: 'token', characterId: state.characterId, text })
        continue
      }
      streamBuffer += text
    }

    const fullText = streamedStructured ? streamBuffer : assistantDraft
    const structured = expectsStructuredReply ? parseStructuredAssistantResponse(fullText) : null
    if (structured) {
      assistantDraft = ''
      for (const item of structured.imageAnalyses) {
        state.emit({
          type: 'image-analysis',
          characterId: state.characterId,
          resourceId: item.resourceId,
          analysis: item.analysis
        })
      }
      if (structured.answer) {
        assistantDraft = structured.answer
        state.emit({ type: 'token', characterId: state.characterId, text: structured.answer })
      }
    } else if (streamedStructured && fullText) {
      assistantDraft = fullText
      state.emit({ type: 'token', characterId: state.characterId, text: fullText })
    }

    if (!assistantDraft.trim()) {
      throw new Error('Model returned no displayable text output.')
    }
    const usage = aggregatedChunk?.usage_metadata
    if (
      usage &&
      typeof usage.input_tokens === 'number' &&
      Number.isFinite(usage.input_tokens) &&
      usage.input_tokens >= 0
    ) {
      getTokenCalibration().record(
        state.modelConfig.modelId,
        finalCallRawEstimate,
        usage.input_tokens
      )
    }
    return {
      assistantDraft,
      replyExchange: serializeExchange(messages, new AIMessage(assistantDraft)),
      contextUsage: collectContextUsage(
        usage,
        state.modelConfig,
        state.budget.budgetTokens,
        Math.ceil(finalCallRawEstimate * calibration)
      )
    }
  }
}

/** 终答 system 拼装所需的最小回合视图：完整回合状态与装配阶段的部分状态都满足。 */
export type FinalSystemState = Pick<
  TurnStateValue,
  | 'session'
  | 'stateCardSections'
  | 'memorySections'
  | 'prompt'
  | 'characterEmoticons'
  | 'character'
  | 'historyOmittedCount'
>

/**
 * @description 拼装终答阶段完整的开头 system 文本：身份规则段与全部上下文注入段。
 * @param state 回合视图，session 与两类注入段须已装载。
 * @param isGroupTurn 是否群聊回合。
 * @param conditional 条件段开关；估算最坏预留时全开，终答拼装时按实际状态取值。
 * @returns 拼接后的 system 纯文本。
 * @remarks 工具证据由流程模板显式引用，本函数不再追加证据数据段；装配阶段的最坏 system
 *   预留估算同样经本函数取最坏条件值，扣除口径因此恒一致。
 */
export function buildFinalSystemText(
  state: FinalSystemState,
  isGroupTurn: boolean,
  conditional: {
    hasToolEvidence: boolean
    incomplete: boolean
    hasRealtimeImages: boolean
    historyOmitted: boolean
  }
): string {
  const summarySection = buildSummarySectionText(state.session)
  const markerSection = conditional.historyOmitted
    ? buildHistoryOmittedSectionText(Math.max(1, state.historyOmittedCount))
    : null
  const contextSections = [...state.stateCardSections, ...state.memorySections]
  return joinPromptSections([
    ...buildFinalSystemPrompt({
      persona: state.prompt,
      characterEmoticons: state.characterEmoticons,
      isGroup: isGroupTurn,
      characterName: state.character.name,
      hasToolEvidence: conditional.hasToolEvidence,
      incomplete: conditional.incomplete,
      hasRealtimeImages: conditional.hasRealtimeImages
    }),
    ...(summarySection ? [{ text: summarySection }] : []),
    ...(markerSection ? [{ text: markerSection }] : []),
    ...contextSections.map((text) => ({ text }))
  ])
}

/**
 * @description 构造历史省略说明的提示词段文本。
 * @param droppedCount 装配截断丢弃的最早历史条数。
 * @returns 并入开头 system 的省略说明段；未发生截断时返回 null。
 */
export function buildHistoryOmittedSectionText(droppedCount: number): string | null {
  if (droppedCount <= 0) {
    return null
  }
  return `【历史省略说明】因上下文窗口限制，最早 ${droppedCount} 条内容未包含在本次上下文中；更早的信息只能依据摘要与历史检索工具的结果回忆，不要臆测被省略的内容。`
}

/**
 * @description 将终答流采集到的 usage 元数据转换为会话上下文统计。
 * @param usage 流式调用返回的 usage 元数据；供应商未返回时为 undefined。
 * @param config 本回合的生效模型配置。
 * @param budgetTokens 本回合生效的输入上下文预算。
 * @param estimatedTokens 终答输入的本地估算 token 数（校准后），供用量缺失时的水位兜底。
 * @returns 本回合最终回复调用的上下文统计。
 * @remarks usage 元数据存在但 input_tokens 不可读时记录日志并按未返回用量处理，不阻断回合提交；
 *   usage 整体缺失时同样记录日志，unavailable 分支携带预算与估算值供自动压缩做水位兜底判断。
 *   供应商上报缓存细分时一并记录命中 token 数，用于界面展示缓存命中率。
 */
function collectContextUsage(
  usage: AIMessageChunk['usage_metadata'] | undefined,
  config: ResolvedModelConfig,
  budgetTokens: number,
  estimatedTokens: number
): ContextUsage {
  const recordedAt = now()
  const inputTokens = usage?.input_tokens
  if (typeof inputTokens === 'number' && Number.isFinite(inputTokens) && inputTokens >= 0) {
    const cacheReadTokens = usage?.input_token_details?.cache_read
    return {
      status: 'available',
      modelId: config.modelId,
      recordedAt,
      inputTokens,
      budgetTokens,
      ...(typeof cacheReadTokens === 'number' &&
      Number.isFinite(cacheReadTokens) &&
      cacheReadTokens >= 0
        ? { cacheReadTokens }
        : {}),
      ...(typeof config.contextWindow === 'number' ? { contextWindow: config.contextWindow } : {})
    }
  }
  if (usage) {
    void logger.warn('ai', 'model-usage-invalid', 'Model usage metadata is not readable', {
      inputTokens: String(inputTokens)
    })
  } else {
    void logger.warn(
      'ai',
      'model-usage-missing',
      'Model returned no usage metadata; context usage falls back to the local estimate',
      { modelId: config.modelId }
    )
  }
  return {
    status: 'unavailable',
    modelId: config.modelId,
    recordedAt,
    budgetTokens,
    estimatedTokens
  }
}
