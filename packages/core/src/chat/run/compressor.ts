import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { ConversationMessage, ConversationSession } from '@gamechat/type'
import type { ResolvedModelConfig } from '@gamechat/type'
import { getChatHost } from '../host'
import { logger } from '../../infra/log'
import { createSerialQueue, type SerialQueue } from '../../infra'
import { now, type SessionStore } from '../session'
import type { ChatRuntimeDependencies } from '../types'
import { buildMemoryRewriteMessages } from './memory-rewrite'
import {
  buildSessionHistoryView,
  contentToText,
  createChatModel,
  findProviderModel,
  formatChatEmoticonMarker,
  resolveKeepCount,
  resolveModelConfig,
  selectCompressionRegion
} from '../model'

/** 压缩后原文保留窗口的固定条数（内部常量，非用户设置）。 */
const HISTORY_KEEP_WINDOW = 20
/** 压缩后原文保留窗口的 token 上限占生效上下文预算的比例（内部常量，非用户设置）。 */
const HISTORY_KEEP_WINDOW_TOKEN_RATIO = 0.25
/** 连续失败达到该次数后停止自动压缩（熔断），手动命令不受影响。 */
const AUTO_COMPACT_FAILURE_BREAKER = 3

/** 压缩一次的结果：已生成新摘要，或没有可整理的历史区间。 */
export type CompressionOutcome = 'compressed' | 'nothing-to-compress'

/**
 * @description 会话滚动摘要压缩器：回合收尾或手动命令触发，把保留窗口外的历史区间交给整理模型压缩，
 *   并随压缩顺带执行记忆抽取。
 * @remarks 每个会话一条串行队列，压缩任务不与用户操作并发写同一会话；自动触发受开关、水位与
 *   熔断器约束，手动命令无视三者。压缩只写摘要字段，不改动消息数组；记忆抽取失败只记日志，不影响压缩结果。
 */
export class SessionCompressor {
  private readonly sessionStore: SessionStore
  private readonly dependencies: ChatRuntimeDependencies
  private readonly queues = new Map<string, SerialQueue>()
  /** 按会话计数的连续失败次数；成功后清零，达到熔断阈值后跳过自动触发。 */
  private readonly failureCounts = new Map<string, number>()
  private publishSession: (session: ConversationSession) => void = () => undefined

  /**
   * @description 组装会话压缩器。
   * @param options 会话存储、角色依赖与会话同步事件发布回调。
   */
  constructor(options: {
    sessionStore: SessionStore
    dependencies: ChatRuntimeDependencies
    /** 压缩写入成功后发布 session-synced 快照的回调；requestId 使用空串标记非运行事件。 */
    publishSession: (session: ConversationSession) => void
  }) {
    this.sessionStore = options.sessionStore
    this.dependencies = options.dependencies
    this.publishSession = options.publishSession
  }

  /**
   * @description 回合收尾的自动压缩检查：开关、熔断与水位全部满足时入队一次压缩。
   * @param sessionId 刚结束运行的会话 ID。
   * @returns 无返回值；检查不通过时静默跳过。
   * @remarks 水位以最近一次终答实测 inputTokens 与其记录的预算之比为准；实测或预算缺失时不触发。
   */
  maybeAutoCompress(sessionId: string): void {
    void this.enqueueAuto(sessionId)
  }

  /**
   * @description 手动触发一次全量压缩（会话命令）；无视自动开关、水位与熔断器。
   * @param sessionId 目标会话 ID。
   * @returns 压缩结果。
   * @remarks 会话存在活跃运行时由调用方拒绝；任务进入会话串行队列，与在途压缩顺序执行。
   *   保留窗口归零：全部有效历史（含最新一条）都压入摘要，锚点落在最后一条消息上，
   *   用户优先级高于保留近期原文的自动策略。
   */
  async compressManually(sessionId: string): Promise<CompressionOutcome> {
    return this.getQueue(sessionId).enqueue(async () => {
      const outcome = await this.runCompressionFlight(sessionId, { keepWindow: 0 })
      this.failureCounts.set(sessionId, 0)
      return outcome
    }).promise
  }

  /**
   * @description 回合前预算护栏压缩：会话串行队列内执行一次默认保留窗口的压缩飞行。
   * @param sessionId 目标会话 ID。
   * @returns 压缩结果。
   * @remarks 由回合引擎在装配后发现输入触及预算时调用；无视自动开关与水位（输入已触及预算，
   *   压缩是发送前的正确性护栏而非优化），尊重熔断器——熔断打开时跳过，由回合引擎按截断兜底放行。
   */
  async compressBeforeTurn(sessionId: string): Promise<CompressionOutcome> {
    if ((this.failureCounts.get(sessionId) ?? 0) >= AUTO_COMPACT_FAILURE_BREAKER) {
      void logger.warn(
        'ai',
        'turn-preflight-compress-breaker-open',
        'Pre-turn compression skipped: consecutive failure breaker is open',
        { sessionId }
      )
      return 'nothing-to-compress'
    }
    return this.getQueue(sessionId).enqueue(async () => {
      const outcome = await this.runCompressionFlight(sessionId)
      this.failureCounts.set(sessionId, 0)
      return outcome
    }).promise
  }

  /**
   * @description 入队一次自动压缩飞行。
   * @param sessionId 目标会话 ID。
   */
  private async enqueueAuto(sessionId: string): Promise<void> {
    try {
      const settings = await getChatHost().getAppSettings()
      if (!settings.contextCompression.enabled) {
        return
      }
      if ((this.failureCounts.get(sessionId) ?? 0) >= AUTO_COMPACT_FAILURE_BREAKER) {
        void logger.warn(
          'ai',
          'session-compress-breaker-open',
          'Auto compression skipped: consecutive failure breaker is open',
          { sessionId }
        )
        return
      }
      const session = this.sessionStore.getSession(sessionId)
      if (!session || !this.isWaterLevelReached(session)) {
        return
      }
      await this.getQueue(sessionId).enqueue(() => this.runCompressionFlight(sessionId)).promise
      this.failureCounts.set(sessionId, 0)
    } catch (error) {
      this.failureCounts.set(sessionId, (this.failureCounts.get(sessionId) ?? 0) + 1)
      void logger.warn('ai', 'session-compress-auto-failed', 'Auto compression flight failed', {
        sessionId,
        consecutiveFailures: this.failureCounts.get(sessionId) ?? 0,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  /**
   * @description 返回会话专属的串行队列，懒创建。
   * @param sessionId 会话 ID。
   * @returns 该会话的串行队列。
   */
  private getQueue(sessionId: string): SerialQueue {
    let queue = this.queues.get(sessionId)
    if (!queue) {
      queue = createSerialQueue()
      this.queues.set(sessionId, queue)
    }
    return queue
  }

  /**
   * @description 判断会话占用是否达到压缩水位。
   * @param session 会话快照。
   * @returns 占用达到水位时返回 true；缺少用量（或估算兜底值）与预算时一律返回 false。
   * @remarks 水位即生效预算本身（设置页「压缩水位」比例乘以窗口）；供应商返回实测用量时按
   *   实测判断，未返回时按终答输入的本地估算值兜底判断，保证不报用量的模型上自动压缩仍可触发。
   */
  private isWaterLevelReached(session: ConversationSession): boolean {
    const usage = session.contextUsage
    if (!usage) {
      return false
    }
    if (usage.status === 'available') {
      if (!usage.budgetTokens || usage.budgetTokens <= 0) {
        return false
      }
      return usage.inputTokens >= usage.budgetTokens
    }
    if (
      typeof usage.estimatedTokens !== 'number' ||
      !(usage.estimatedTokens > 0) ||
      typeof usage.budgetTokens !== 'number' ||
      !(usage.budgetTokens > 0)
    ) {
      return false
    }
    return usage.estimatedTokens >= usage.budgetTokens
  }

  /**
   * @description 推导自动压缩的原文保留窗口条数：条数上限与 token 上限取小。
   * @param session 会话快照，用于读取最近一次生效的输入上下文预算。
   * @param validMessages 已过滤的有效历史。
   * @returns 保留窗口条数；会话缺少预算记录时退回固定条数。
   * @remarks 多图或长文场景下按固定条数保留可能仍超预算，token 上限保证压缩后剩余原文
   *   能装进预算的一定比例，避免压缩白做。
   */
  private resolveAutoKeepWindow(
    session: ConversationSession,
    validMessages: readonly ConversationMessage[]
  ): number {
    const budgetTokens = session.contextUsage?.budgetTokens
    if (typeof budgetTokens !== 'number' || budgetTokens <= 0) {
      return HISTORY_KEEP_WINDOW
    }
    return resolveKeepCount(
      validMessages,
      HISTORY_KEEP_WINDOW,
      Math.floor(budgetTokens * HISTORY_KEEP_WINDOW_TOKEN_RATIO)
    )
  }

  /**
   * @description 执行一次压缩飞行：选区间、调整理模型、写回摘要并广播。
   * @param sessionId 目标会话 ID。
   * @param options 可选覆盖：keepWindow 为本次原文保留窗口条数，缺省用自动压缩窗口。
   * @returns 压缩结果。
   * @throws 整理模型不可用、调用失败或写入失败时抛错，由入队方计入熔断计数或向上传播。
   */
  private async runCompressionFlight(
    sessionId: string,
    options: { keepWindow?: number } = {}
  ): Promise<CompressionOutcome> {
    if (!(await this.sessionStore.ensureSessionLoaded(sessionId))) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    const session = this.sessionStore.getSession(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    const validMessages = buildSessionHistoryView(session)
    const keepWindow = options.keepWindow ?? this.resolveAutoKeepWindow(session, validMessages)
    const selection = selectCompressionRegion(validMessages, keepWindow)
    if (!selection) {
      return 'nothing-to-compress'
    }

    const characterNames = await this.loadCharacterNames(session.participants)
    const modelConfig = await this.resolveSummarizerModel(session)
    const transcript = selection.region
      .map((message) => formatRegionMessageLine(message, characterNames))
      .join('\n\n')
    const summaryText = (
      await this.invokeSummarizer({
        modelConfig,
        oldSummaryText: session.summary?.text ?? '',
        transcript
      })
    ).trim()
    if (!summaryText) {
      throw new Error('Summarizer returned an empty summary.')
    }

    const updated = this.sessionStore.updateSessionSummary(sessionId, {
      text: summaryText,
      anchorMessageId: selection.newAnchor.id,
      recordedAt: now()
    })
    this.publishSession(updated)
    // 记忆整文改写随压缩顺带执行：失败只记日志，不回滚摘要、不影响压缩结果。
    try {
      await this.rewriteMemoryFromRegion(session, characterNames, selection.region)
    } catch (error) {
      void logger.warn('ai', 'memory-rewrite-failed', 'Memory rewrite flight failed', {
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
    return 'compressed'
  }

  /**
   * @description 压缩后按角色整文改写长期记忆。
   * @param session 会话快照（取 ID 与固定成员）。
   * @param characterNames 成员 ID 到展示名的映射。
   * @param region 本次压缩的区间消息。
   * @returns 无返回值。
   * @remarks 每个参与者独立改写自己的记忆 MD（单聊即一次调用）；输入为该角色当前记忆全文与
   *   带消息编号的区间转录，输出为改写后的完整记忆。模型输出为空时保留旧记忆并记日志；
   *   单个角色失败只记日志，不影响其他参与者。
   */
  private async rewriteMemoryFromRegion(
    session: ConversationSession,
    characterNames: ReadonlyMap<string, string>,
    region: readonly ConversationMessage[]
  ): Promise<void> {
    const memory = getChatHost().getMemory()
    if (!memory.getSettings().enabled) {
      return
    }
    const transcript = region
      .map((message, index) => `[${index + 1}] ${formatRegionMessageLine(message, characterNames)}`)
      .join('\n\n')
    const modelConfig = await this.resolveSummarizerModel(session)
    const model = createChatModel(modelConfig)
    for (const characterId of session.participants) {
      try {
        const currentMemory = await memory.getCharacterMemory(characterId)
        const messages = buildMemoryRewriteMessages({ currentMemory, transcript })
        const response = await model.invoke([
          new SystemMessage(messages.system),
          new HumanMessage(messages.user)
        ])
        const nextMemory = contentToText(response.content).trim()
        if (!nextMemory) {
          void logger.warn(
            'ai',
            'memory-rewrite-empty',
            'Memory rewrite returned empty output; kept previous memory',
            { sessionId: session.id, characterId }
          )
          continue
        }
        await memory.saveCharacterMemory(characterId, nextMemory)
      } catch (error) {
        void logger.warn(
          'ai',
          'memory-rewrite-character-failed',
          'Memory rewrite failed for character',
          {
            sessionId: session.id,
            characterId,
            error: error instanceof Error ? error.message : String(error)
          }
        )
      }
    }
  }

  /**
   * @description 加载会话成员的展示名映射。
   * @param participantIds 会话固定成员角色 ID。
   * @returns 成员 ID 到展示名的映射；加载失败的角色回退为其 ID。
   */
  private async loadCharacterNames(
    participantIds: readonly string[]
  ): Promise<Map<string, string>> {
    const names = new Map<string, string>()
    await Promise.all(
      participantIds.map(async (characterId) => {
        try {
          const character = await this.dependencies.getCharacter(characterId)
          names.set(characterId, character.name)
        } catch {
          names.set(characterId, characterId)
        }
      })
    )
    return names
  }

  /**
   * @description 解析后台整理模型的生效配置。
   * @param session 会话快照，用于空设置时回退会话最近一次使用的模型。
   * @returns 整理模型的生效配置。
   * @throws 设置的整理模型与会话模型均不可解析时抛错。
   */
  private async resolveSummarizerModel(session: ConversationSession): Promise<ResolvedModelConfig> {
    const settings = await getChatHost().getAppSettings()
    const preferredModelId =
      settings.contextCompression.modelId || session.contextUsage?.modelId || ''
    if (!preferredModelId) {
      throw new Error(
        'No summarizer model available: configure one in settings or chat once with a model first.'
      )
    }
    const providersStore = await getChatHost().getProviders()
    const resolution = findProviderModel(providersStore, preferredModelId)
    if (!resolution) {
      throw new Error(`Summarizer model not found: ${preferredModelId}`)
    }
    return resolveModelConfig(resolution.provider, resolution.model)
  }

  /**
   * @description 调用整理模型生成新摘要。
   * @param input 模型配置、旧摘要文本与待整理区间转录。
   * @returns 模型输出的摘要正文。
   * @throws 模型调用失败时向上抛出。
   */
  private async invokeSummarizer(input: {
    modelConfig: Parameters<typeof createChatModel>[0]
    oldSummaryText: string
    transcript: string
  }): Promise<string> {
    const systemText = `你是会话历史整理器。把提供的对话区间压缩为一份摘要，供角色在后续对话中回忆此前剧情。
要求：
- 保留关键事件经过、人物关系变化、重要承诺与决定。
- 精确状态（好感度、位置、旗标、开放线索等当前值）由状态卡单独维护；摘要只叙述已发生的关键事件经过，不要重复当前数值或罗列状态清单。
- 不评论、不续写、不输出对话原文，只输出摘要正文。
- 若提供了既有摘要，把新区间融入其中，保持连贯，总长度不超过 800 字。`
    const userText = `[既有摘要]
${input.oldSummaryText || '（无）'}

[待整理区间]
${input.transcript}`
    const model = createChatModel(input.modelConfig)
    const response = await model.invoke([new SystemMessage(systemText), new HumanMessage(userText)])
    return contentToText(response.content)
  }
}

/**
 * @description 把单条消息格式化为摘要输入的文本行。
 * @param message 待格式化的消息。
 * @param characterNames 成员 ID 到展示名的映射。
 * @returns `发言者：内容` 形态的一行文本，含表情标记与历史图片摘要说明。
 */
function formatRegionMessageLine(
  message: ConversationMessage,
  characterNames: ReadonlyMap<string, string>
): string {
  const speaker =
    message.role === 'user' ? '用户' : characterNames.get(message.senderId) || message.senderId
  const emoticon = message.emoticonId
    ? ` ${formatChatEmoticonMarker(message.emoticonId)}${
        message.emoticonDescription ? `（${message.emoticonDescription}）` : ''
      }`
    : ''
  const imageNotes = (message.attachments || [])
    .map(
      (attachment) => `\n[图片 ${attachment.resourceId}] 摘要：${attachment.analysis || '（无）'}`
    )
    .join('')
  return `${speaker}：${message.content.trim()}${emoticon}${imageNotes}`
}
