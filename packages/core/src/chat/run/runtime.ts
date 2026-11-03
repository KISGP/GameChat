import type {
  ChatAppendMessageRequest,
  ChatAppendMessageResult,
  ChatCompressSessionRequest,
  ChatCompressSessionResult,
  ChatDeleteGroupRequest,
  ChatDeleteGroupResult,
  ChatDeleteSessionRequest,
  ChatDeleteSessionResult,
  ChatExportSessionRequest,
  ChatExportSessionResult,
  ChatGroup,
  ChatImageInput,
  ChatRenameSessionRequest,
  ChatRenameSessionResult,
  ChatRemoveFailedTurnRequest,
  ChatRemoveFailedTurnResult,
  ChatRetryMessageRequest,
  ChatRunAccepted,
  ChatSetGroupPinnedRequest,
  ChatTriggerRunRequest,
  ChatUserSegment,
  ConversationMessage,
  ConversationSession,
  ConversationSessionSummary
} from '@gamechat/type'
import type { ResolvedModelConfig } from '@gamechat/type'
import { CHAT_USER_EMOTICONS } from '@gamechat/schema'
import { assertPathSegment } from '../../infra'
import { logger } from '../../infra/log'
import { getChatHost } from '../host'
import { withTrace } from '../../infra/trace'
import { SessionStore } from '../session'
import {
  findProviderModel,
  resolveContextBudget,
  resolveImageTokenEstimate,
  resolveModelConfig,
  type ContextBudget
} from '../model'
import type {
  ChatContextProvider,
  ChatRuntimeDependencies,
  ScheduledParticipant,
  TurnOutcome
} from '../types'
import type { ChatToolPackageResolver } from '../agent'
import { RunEventPublisher } from './run-event-publisher'
import { RunRegistry } from './run-registry'
import { SessionCompressor } from './compressor'
import { exportSessionMarkdown } from '../export/markdown-exporter'
import { processChatImage } from '../media'
import { finishRun, finishRunAsFailure } from './run-finisher'
import { runFlowRun, type TurnConsumerDeps } from './turn-consumer'
import { toErrorMessage } from './run-errors'
import { getChatStateCardService } from '../state-card'

/**
 * @description 校验并规范化一次用户聊天段。
 * @param segment 来自 renderer 的未受信任聊天段。
 * @returns 可进入会话存储的规范化段。
 * @remarks 文本段的 text 已去除首尾空白，调用方可直接使用返回值，无需再行修剪。
 */
function normalizeUserSegment(segment: ChatUserSegment): ChatUserSegment {
  if (!segment || typeof segment !== 'object') {
    throw new Error('Invalid chat segment.')
  }
  if (segment.type === 'emoticon') {
    const emoticonId = typeof segment.emoticonId === 'string' ? segment.emoticonId.trim() : ''
    if (!emoticonId || !CHAT_USER_EMOTICONS.some((item) => item.id === emoticonId)) {
      throw new Error(`Unknown user emoticon ID: ${emoticonId}`)
    }
    return { type: 'emoticon', emoticonId }
  }
  if (segment.type !== 'text') {
    throw new Error('Invalid chat segment type.')
  }
  if (typeof segment.text !== 'string') throw new Error('Invalid chat segment text.')
  const images = segment.images || []
  if (!Array.isArray(images)) {
    throw new Error('Invalid chat image list.')
  }
  return { type: 'text', text: segment.text.trim(), ...(images.length ? { images } : {}) }
}

export class ChatRuntime {
  private readonly sessionStore = new SessionStore()
  private readonly runRegistry = new RunRegistry()
  private readonly eventPublisher = new RunEventPublisher()
  private readonly pendingHolds = new Map<
    string,
    {
      sessionId: string
      ownerId: string
      modelId: string
      messageIds: string[]
    }
  >()
  /** 按等待窗口键控的在途追加任务集;触发前必须等待其全部完成,避免消息快照缺尾。 */
  private readonly inflightAppends = new Map<string, Set<Promise<unknown>>>()
  private readonly turnConsumerDeps: TurnConsumerDeps
  private readonly sessionCompressor: SessionCompressor

  /**
   * @description 组装聊天运行时：注入运行活性谓词并准备运行消费依赖。
   * @param dependencies 角色资料、模型配置等外部依赖。
   * @param chatContext 聊天上下文提供者，负责会话快照同步、策略与流程读取。
   * @param toolResolver 按回合解析对模型可见工具包的解析器。
   */
  constructor(
    private readonly dependencies: ChatRuntimeDependencies,
    private readonly chatContext: ChatContextProvider,
    private readonly toolResolver: ChatToolPackageResolver
  ) {
    this.sessionStore.setRunLivenessProvider((sessionId) => this.runRegistry.hasLiveRun(sessionId))
    this.sessionCompressor = new SessionCompressor({
      sessionStore: this.sessionStore,
      dependencies: this.dependencies,
      publishSession: (session) => {
        this.eventPublisher.publish({
          type: 'session-synced',
          // 空请求 ID 标记该快照不属于任何聊天运行（压缩收尾），运行匹配型监听方会自然忽略。
          requestId: '',
          session,
          summary: this.sessionStore.getRequiredSessionSummary(session.id)
        })
      }
    })
    this.turnConsumerDeps = {
      runRegistry: this.runRegistry,
      sessionStore: this.sessionStore,
      chatContext: this.chatContext,
      eventPublisher: this.eventPublisher,
      dependencies: this.dependencies,
      loadCurrentImages: (sessionId, messageIds) => this.loadCurrentImages(sessionId, messageIds),
      resolveContextBudget: (contextWindow) => this.resolveFlowBudget(contextWindow),
      loadStateCardSections: async (session, characterId) => {
        const content = await getChatStateCardService().getSessionCard(
          session.ownerId,
          session.id,
          characterId
        )
        return content ? [`【会话状态卡】\n${content}`] : []
      },
      loadMemorySections: async (_session, characterId) => {
        const memory = getChatHost().getMemory()
        if (!memory.getSettings().enabled) {
          return []
        }
        const content = await memory.getCharacterMemory(characterId).catch(() => '')
        return content ? [`【长期记忆】\n${content}`] : []
      },
      compressBeforeTurn: async (sessionId) => {
        await this.sessionCompressor.compressBeforeTurn(sessionId)
      },
      resolveToolPackages: async (state) =>
        this.toolResolver.resolveToolPackages({
          policy: state.policy,
          isGroupTurn: state.session.participants.length > 1,
          hasEmoticonCatalog: state.userEmoticons.length > 0 || state.characterEmoticons.length > 0
        })
    }
  }

  /**
   * @description 解析流程运行使用的上下文预算。
   * @param contextWindow 生效模型条目配置的窗口容量。
   * @param overrides 流程级预算覆盖。
   * @returns 生效的上下文预算。
   * @remarks 预算比例以全局设置为上限，流程只能收紧不能放宽；图片估算按流程覆盖或全局档位。
   */
  private async resolveFlowBudget(
    contextWindow: number | undefined
  ): Promise<ContextBudget> {
    const appSettings = await getChatHost().getAppSettings()
    return resolveContextBudget({
      contextWindow,
      budgetRatio: appSettings.contextBudget.budgetRatio,
      imageTokenEstimate: resolveImageTokenEstimate(appSettings.chatImageProcessing)
    })
  }

  /**
   * @description 加载磁盘上的会话与群聊数据，并把会话记忆视图同步给聊天上下文。
   * @remarks 需在处理任何聊天请求前调用一次。
   */
  async initialize(): Promise<void> {
    await this.sessionStore.initialize()
  }

  /**
   * @description 返回全部会话的列表摘要。
   * @returns 按更新时间倒序、运行态已派生的摘要列表。
   */
  getSessionSummaries(): ConversationSessionSummary[] {
    return this.sessionStore.getSessionSummaries()
  }

  /**
   * @description 换入并返回指定会话的全量快照。
   * @param sessionId 会话标识。
   * @returns 运行态已派生的会话快照；会话不存在或文档无效时返回 null。
   * @remarks 供渲染层激活会话时取全量数据；换入同时会把其余闲置全量会话换出内存。
   */
  async getSessionDetail(sessionId: string): Promise<ConversationSession | null> {
    return this.sessionStore.getSessionDetail(sessionId)
  }

  /**
   * @description 返回当前全部独立群聊对象。
   * @returns 群聊快照列表。
   */
  getGroups(): ChatGroup[] {
    return this.sessionStore.getGroups()
  }

  /**
   * @description 创建成员固定的独立群聊对象。
   * @param participantIds 群聊成员角色 ID。
   * @returns 新建群聊快照。
   */
  createGroup(participantIds: string[]): ChatGroup {
    return this.sessionStore.createGroup(participantIds)
  }

  /**
   * @description 校验并暂存一次用户聊天段，附件就绪后立即落库。
   * @param request 聊天请求，包含目标、模型、文本及可选图片。
   * @returns 已接受的请求标识与会话信息。
   * @remarks 用户消息在附件写盘完成后即持久化，等待窗口内崩溃时消息已在盘；群聊目标携带图片时
   *   直接拒绝。在途追加经 {@link appendMessageInner} 注册到
   *   inflightAppends，供触发方等待，避免触发与追加交错丢失消息。
   */
  appendMessage(request: ChatAppendMessageRequest): Promise<ChatAppendMessageResult> {
    const inflight = this.inflightAppends.get(request.holdId) ?? new Set<Promise<void>>()
    this.inflightAppends.set(request.holdId, inflight)
    const task = this.appendMessageInner(request).finally(() => {
      inflight.delete(task)
      if (inflight.size === 0 && this.inflightAppends.get(request.holdId) === inflight) {
        this.inflightAppends.delete(request.holdId)
      }
    })
    inflight.add(task)
    return task
  }

  /**
   * @description 执行一次用户聊天段的校验与暂存。
   * @param request 聊天请求，包含目标、模型、文本及可选图片。
   * @returns 已接受的请求标识与会话信息。
   */
  private async appendMessageInner(
    request: ChatAppendMessageRequest
  ): Promise<ChatAppendMessageResult> {
    const segment = normalizeUserSegment(request.segment)
    const images = segment.type === 'text' ? segment.images || [] : []
    if (segment.type === 'text' && !segment.text && images.length === 0) {
      throw new Error('Chat message requires text or at least one image.')
    }
    if (images.length > 4) {
      throw new Error('A chat message can include at most 4 images.')
    }
    const modelConfig = await this.resolveChatModelConfig(request.modelId)
    if (images.length > 0 && !modelConfig.supportsImages) {
      throw new Error(
        'The selected chat model does not support image input. Enable image support for this model in its provider settings.'
      )
    }
    assertPathSegment(request.target.ownerId, 'chat target owner id')
    const isGroupTarget = this.sessionStore.getGroup(request.target.ownerId) !== null
    if (isGroupTarget && images.length > 0) {
      throw new Error('Group chat does not support image messages yet.')
    }
    const pending = this.pendingHolds.get(request.holdId)
    if (pending && pending.ownerId !== request.target.ownerId) {
      throw new Error('Chat hold target mismatch.')
    }
    const sessionId = pending?.sessionId || request.sessionId || null
    // 指定已有会话时先换入全量再追加；换入失败（已删除或文档无效）时回退为新建会话。
    if (sessionId) {
      await this.sessionStore.ensureSessionLoaded(sessionId)
    }
    const existingSession = sessionId ? this.sessionStore.getSession(sessionId) : null
    if (
      existingSession &&
      existingSession.participants.length > 1 &&
      existingSession.status === 'running'
    ) {
      this.runRegistry.abortBySession(existingSession.id)
    }
    const appended = this.sessionStore.appendUserMessage(
      { sessionId, target: request.target, segment },
      false
    )
    const hold = pending || {
      sessionId: appended.session.id,
      ownerId: request.target.ownerId,
      modelId: request.modelId,
      messageIds: []
    }
    hold.messageIds.push(appended.userMessage.id)
    this.pendingHolds.set(request.holdId, hold)

    let syncedSession: ConversationSession
    try {
      const savedAttachments = await Promise.all(
        images.map((image) => this.sessionStore.saveAttachment(appended.session.id, image))
      )
      // 附件就绪后立即落盘，等待窗口内崩溃时消息已在盘。
      syncedSession = this.sessionStore.setMessageAttachments(
        appended.session.id,
        appended.userMessage.id,
        savedAttachments,
        true
      )
      this.eventPublisher.publish({
        type: 'session-synced',
        requestId: request.requestId,
        session: syncedSession,
        summary: this.sessionStore.getRequiredSessionSummary(appended.session.id)
      })
    } catch (error) {
      const message = toErrorMessage(error)
      void logger.error('ai', 'image-save-failed', 'Failed to save chat image attachments', {
        requestId: request.requestId,
        sessionId: appended.session.id,
        error: message
      })
      this.sessionStore.deleteMessage(appended.session.id, appended.userMessage.id, false)
      const currentHold = this.pendingHolds.get(request.holdId)
      if (currentHold) {
        currentHold.messageIds = currentHold.messageIds.filter(
          (id) => id !== appended.userMessage.id
        )
        if (currentHold.messageIds.length === 0) this.pendingHolds.delete(request.holdId)
      }
      throw error
    }
    return {
      requestId: request.requestId,
      sessionId: appended.session.id,
      messageId: appended.userMessage.id,
      session: syncedSession,
      summary: this.sessionStore.getRequiredSessionSummary(appended.session.id)
    }
  }

  /**
   * @description 将等待窗口内的多条用户消息正式触发并启动一次聊天运行。
   * @param request 触发请求，包含等待窗口和模型上下文。
   * @returns 已接受的运行标识。
   * @remarks 用户消息已在 append 阶段落库；触发先等待同窗口在途追加结算再取消息快照，
   *   避免交错丢失消息；模型以等待窗口冻结的首条消息选择为准，请求自带值仅作回退。
   *   运行失败时保留用户气泡并按回合包容策略收尾。
   */
  async triggerRun(request: ChatTriggerRunRequest): Promise<ChatRunAccepted> {
    // 先等在途追加结算(成功入库或失败清理),再做校验与快照,保证本轮模型输入包含全部消息。
    const inflight = this.inflightAppends.get(request.holdId)
    if (inflight) await Promise.allSettled([...inflight])
    const hold = this.pendingHolds.get(request.holdId)
    if (!hold || hold.sessionId !== request.sessionId || hold.ownerId !== request.target.ownerId) {
      throw new Error('Chat hold not found or does not match the session.')
    }
    this.pendingHolds.delete(request.holdId)
    return this.startRunFromTrailingUsers({
      requestId: request.requestId,
      sessionId: request.sessionId,
      modelId: hold.modelId || request.modelId
    })
  }

  /**
   * @description 删除指定会话末尾的失败或中断回复气泡并以其用户消息重新启动一次聊天运行。
   * @param request 重试请求，包含会话 ID、失败或中断 assistant 消息 ID 与模型上下文。
   * @returns 已接受的运行标识。
   * @remarks 仅当会话无活跃运行且最后一条消息为失败（error）或中断（aborted）assistant 时受理；
   *   用户消息与附件原样保留，不经过追加流程，因此不会产生重复用户气泡。
   */
  async retryMessage(request: ChatRetryMessageRequest): Promise<ChatRunAccepted> {
    if (!(await this.sessionStore.ensureSessionLoaded(request.sessionId))) {
      throw new Error(`Session not found: ${request.sessionId}`)
    }
    const session = this.sessionStore.getSession(request.sessionId)
    if (!session) {
      throw new Error(`Session not found: ${request.sessionId}`)
    }
    if (this.runRegistry.hasLiveRun(request.sessionId)) {
      throw new Error('Session has an active chat run and cannot be retried.')
    }
    const lastMessage = session.messages[session.messages.length - 1]
    if (
      !lastMessage ||
      lastMessage.id !== request.messageId ||
      lastMessage.role !== 'assistant' ||
      (lastMessage.status !== 'error' && lastMessage.status !== 'aborted')
    ) {
      throw new Error('Retry target must be the latest failed or interrupted assistant message.')
    }
    this.sessionStore.deleteMessage(request.sessionId, request.messageId, true)
    const synced = this.sessionStore.getSession(request.sessionId)
    if (!synced) throw new Error(`Session not found: ${request.sessionId}`)
    this.eventPublisher.publish({
      type: 'session-synced',
      requestId: request.requestId,
      session: synced,
      summary: this.sessionStore.getRequiredSessionSummary(request.sessionId)
    })
    return this.startRunFromTrailingUsers({
      requestId: request.requestId,
      sessionId: request.sessionId,
      modelId: request.modelId
    })
  }

  /**
   * @description 移除一轮失败的对话消息，供渲染层「重新编辑」在重新发送前清场。
   * @param request 清理请求：会话 ID 与失败的 assistant 消息 ID。
   * @returns 清理后的会话快照与摘要。
   * @remarks 目标必须是 error 或 aborted 状态的 assistant 消息，其前连续的用户消息视为本轮输入
   *   一并删除；会话存在活跃运行时拒绝清理。
   */
  async removeFailedTurn(
    request: ChatRemoveFailedTurnRequest
  ): Promise<ChatRemoveFailedTurnResult> {
    if (!(await this.sessionStore.ensureSessionLoaded(request.sessionId))) {
      throw new Error(`Session not found: ${request.sessionId}`)
    }
    const session = this.sessionStore.getSession(request.sessionId)
    if (!session) throw new Error(`Session not found: ${request.sessionId}`)
    if (this.runRegistry.hasLiveRun(request.sessionId)) {
      throw new Error('Session has an active chat run and cannot be edited.')
    }
    const failedIndex = session.messages.findIndex(
      (message) => message.id === request.assistantMessageId
    )
    if (failedIndex === -1) {
      throw new Error(`Message not found: ${request.assistantMessageId}`)
    }
    const failedMessage = session.messages[failedIndex]
    if (
      failedMessage.role !== 'assistant' ||
      (failedMessage.status !== 'error' && failedMessage.status !== 'aborted')
    ) {
      throw new Error('Edit target must be a failed or interrupted assistant message.')
    }
    const removedMessageIds: string[] = []
    for (let index = failedIndex - 1; index >= 0; index -= 1) {
      const message = session.messages[index]
      if (message.role !== 'user') break
      removedMessageIds.unshift(message.id)
    }
    removedMessageIds.push(failedMessage.id)
    for (const messageId of removedMessageIds) {
      this.sessionStore.deleteMessage(request.sessionId, messageId, true)
    }
    const synced = this.sessionStore.getSession(request.sessionId)
    if (!synced) throw new Error(`Session not found: ${request.sessionId}`)
    this.eventPublisher.publish({
      type: 'session-synced',
      requestId: request.requestId,
      session: synced,
      summary: this.sessionStore.getRequiredSessionSummary(request.sessionId)
    })
    return {
      requestId: request.requestId,
      sessionId: request.sessionId,
      session: synced,
      summary: this.sessionStore.getRequiredSessionSummary(request.sessionId)
    }
  }

  /**
   * @description 解析聊天模型配置并校验无需联网即可判定的发送前提。
   * @param modelId 模型条目标识。
   * @returns 生效模型配置。
   * @remarks 覆盖模型存在性、上下文窗口与 API Key 三类本地可判定项，未满足即抛出带修复指引的错误；
   *   消息追加前调用用于拦截发送；重试入口不经过追加流程，运行触发前需再次校验。
   */
  private async resolveChatModelConfig(modelId: string): Promise<ResolvedModelConfig> {
    const providersStore = await getChatHost().getProviders()
    const resolution = findProviderModel(providersStore, modelId)
    if (!resolution) {
      throw new Error(`模型「${modelId}」不存在或已被删除，请重新选择模型。`)
    }
    const modelConfig = resolveModelConfig(resolution.provider, resolution.model)
    if (
      typeof modelConfig.contextWindow !== 'number' ||
      !Number.isFinite(modelConfig.contextWindow) ||
      modelConfig.contextWindow <= 0
    ) {
      throw new Error(
        `模型「${resolution.model.model || modelConfig.modelId}」未配置上下文窗口，请先在模型设置中填写。`
      )
    }
    if (!modelConfig.apiKey.trim()) {
      throw new Error(`供应商「${resolution.provider.name}」未配置 API Key，请先在模型设置中填写。`)
    }
    return modelConfig
  }

  /**
   * @description 以会话末尾的连续用户消息为当前轮输入启动一次聊天运行。
   * @param input 运行上下文：请求 ID、会话 ID 与模型条目标识。
   * @returns 已接受的运行标识。
   * @remarks triggerRun 与 retryMessage 的共用启动路径：解析模型、注册运行、发布 run-started 后
   *   浮动执行调度循环；会话末尾没有用户消息或模型不存在时抛错。
   */
  private async startRunFromTrailingUsers(input: {
    requestId: string
    sessionId: string
    modelId: string
  }): Promise<ChatRunAccepted> {
    if (!(await this.sessionStore.ensureSessionLoaded(input.sessionId))) {
      throw new Error(`Session not found: ${input.sessionId}`)
    }
    const session = this.sessionStore.getSession(input.sessionId)
    if (!session) throw new Error(`Session not found: ${input.sessionId}`)
    const trailingUsers: ConversationMessage[] = []
    for (let index = session.messages.length - 1; index >= 0; index -= 1) {
      const message = session.messages[index]
      if (message.role !== 'user') break
      trailingUsers.unshift(message)
    }
    if (trailingUsers.length === 0) {
      throw new Error('No pending user messages to trigger.')
    }
    const modelConfig = await this.resolveChatModelConfig(input.modelId)
    const markerMessageId = trailingUsers[trailingUsers.length - 1].id
    this.sessionStore.markTurnModel(
      input.sessionId,
      trailingUsers.map((message) => message.id),
      modelConfig.modelId
    )
    this.runRegistry.register(input.requestId, input.sessionId, markerMessageId)
    // 运行态由活跃 run 派生：注册之后读取即为 running。
    const runningSession = this.sessionStore.getSession(input.sessionId)
    if (!runningSession) throw new Error(`Session not found: ${input.sessionId}`)
    this.eventPublisher.publish({
      type: 'run-started',
      requestId: input.requestId,
      session: runningSession,
      summary: this.sessionStore.getRequiredSessionSummary(input.sessionId),
      messageId: markerMessageId
    })
    void this.executeRun({
      requestId: input.requestId,
      sessionId: input.sessionId,
      modelConfig,
      currentMessageIds: trailingUsers.map((message) => message.id)
    })
    return { requestId: input.requestId, sessionId: input.sessionId, messageId: markerMessageId }
  }

  /**
   * @description 删除指定会话的磁盘数据与内存快照，并同步 memory 视图所依赖的会话列表。
   * @param request 删除请求，包含会话 ID。
   * @returns 被删除的会话 ID。
   * @remarks 会话存在活跃运行时拒绝删除；等待窗口内指向该会话的未触发消息一并清理，
   *   后续触发会因找不到 hold 被拒绝而不会写回已删除的会话。
   *   删除成功后向全部渲染窗口广播 session-removed 事件，渲染层据此移除本地会话列表项。
   */
  async deleteSession(request: ChatDeleteSessionRequest): Promise<ChatDeleteSessionResult> {
    const summary = this.sessionStore.getSessionSummary(request.sessionId)
    if (!summary) {
      throw new Error(`Session not found: ${request.sessionId}`)
    }
    if (this.runRegistry.hasLiveRun(request.sessionId)) {
      throw new Error('Session has an active chat run and cannot be deleted.')
    }
    for (const [holdId, hold] of this.pendingHolds) {
      if (hold.sessionId === request.sessionId) {
        this.pendingHolds.delete(holdId)
      }
    }
    await this.sessionStore.deleteSession(request.sessionId)
    this.eventPublisher.publish({ type: 'session-removed', sessionId: request.sessionId })
    return { sessionId: request.sessionId }
  }

  /**
   * @description 删除指定群聊及其全部会话，并同步 memory 视图所依赖的会话列表。
   * @param request 删除请求，包含群聊 ID。
   * @returns 被删除的群聊 ID。
   * @remarks 群下任一会话存在活跃运行时拒绝删除；等待窗口内指向该群的未触发消息一并清理。
   *   每个被级联删除的会话广播一次 session-removed 事件，渲染层据此逐项移除会话列表项，
   *   群定义本身由调用方在删除成功后从本地注册表移除。
   */
  async deleteGroup(request: ChatDeleteGroupRequest): Promise<ChatDeleteGroupResult> {
    const group = this.sessionStore.getGroup(request.groupId)
    if (!group) {
      throw new Error(`Group not found: ${request.groupId}`)
    }
    const groupSummaries = this.sessionStore
      .getSessionSummaries()
      .filter((summary) => summary.ownerId === request.groupId)
    const liveSession = groupSummaries.find((summary) => this.runRegistry.hasLiveRun(summary.id))
    if (liveSession) {
      throw new Error('Group has an active chat run and cannot be deleted.')
    }
    for (const [holdId, hold] of this.pendingHolds) {
      if (hold.ownerId === request.groupId) {
        this.pendingHolds.delete(holdId)
      }
    }
    const removedSummaries = await this.sessionStore.deleteGroup(request.groupId)
    for (const summary of removedSummaries) {
      this.eventPublisher.publish({ type: 'session-removed', sessionId: summary.id })
    }
    return { groupId: request.groupId }
  }

  /**
   * @description 校验角色的聊天数据处于可删除状态：不属于任何群聊，且名下没有活跃运行。
   * @param ownerId 角色标识（会话归属者）。
   * @returns 无返回值。
   * @remarks 违反任一条件时抛出携带原因的错误；群成员在创建时固定不可变，因此不允许带群删除角色。
   */
  assertCharacterChatDeletable(ownerId: string): void {
    const inGroup = this.sessionStore
      .getGroups()
      .some((group) => group.participantIds.includes(ownerId))
    if (inGroup) {
      throw new Error('Character is a member of a chat group and cannot be deleted.')
    }
    const liveSession = this.sessionStore
      .getSessionSummaries()
      .find((summary) => summary.ownerId === ownerId && this.runRegistry.hasLiveRun(summary.id))
    if (liveSession) {
      throw new Error('Character has an active chat run and cannot be deleted.')
    }
  }

  /**
   * @description 删除角色名下的全部会话，并同步 memory 视图所依赖的会话列表。
   * @param ownerId 角色标识（会话归属者）。
   * @returns 全部会话删除完成后的 Promise。
   * @remarks 逐会话复用 deleteSession 链路（拒绝活跃运行、清理等待窗口、广播 session-removed）；
   *   仅清理会话数据，不触碰角色文件本身。
   */
  async deleteCharacterChatData(ownerId: string): Promise<void> {
    const ownerSessionIds = this.sessionStore
      .getSessionSummaries()
      .filter((summary) => summary.ownerId === ownerId)
      .map((summary) => summary.id)
    for (const sessionId of ownerSessionIds) {
      await this.deleteSession({ sessionId })
    }
  }

  /**
   * @description 设置群聊的侧栏置顶标记。
   * @param request 置顶请求，包含群聊 ID 与目标标记。
   * @returns 更新后的群聊快照。
   */
  setGroupPinned(request: ChatSetGroupPinnedRequest): ChatGroup {
    return this.sessionStore.setGroupPinned(request.groupId, request.pinned)
  }

  /**
   * @description 设置会话的自定义标题，并同步 memory 视图所依赖的会话列表。
   * @param request 改名请求，包含会话 ID 与新标题。
   * @returns 改名后的会话快照与摘要。
   * @remarks 标题是纯元数据：运行中的会话允许改名，且不更新会话活跃时间；
   *   改名前先换入全量，保证标题随完整会话落盘。
   */
  async renameSession(request: ChatRenameSessionRequest): Promise<ChatRenameSessionResult> {
    if (!(await this.sessionStore.ensureSessionLoaded(request.sessionId))) {
      throw new Error(`Session not found: ${request.sessionId}`)
    }
    const session = this.sessionStore.renameSession(request.sessionId, request.title)
    return {
      session,
      summary: this.sessionStore.getRequiredSessionSummary(request.sessionId)
    }
  }

  /**
   * @description 手动触发一次会话历史压缩（会话命令）。
   * @param request 压缩请求，包含会话 ID。
   * @returns 压缩结果。
   * @remarks 会话存在活跃运行时拒绝；任务进入会话串行队列，无视自动开关、水位与熔断器。
   */
  async compressSession(request: ChatCompressSessionRequest): Promise<ChatCompressSessionResult> {
    if (this.runRegistry.hasLiveRun(request.sessionId)) {
      throw new Error('Session has an active chat run and cannot be compressed.')
    }
    const outcome = await this.sessionCompressor.compressManually(request.sessionId)
    return { sessionId: request.sessionId, outcome }
  }

  /**
   * @description 将整个会话导出为 Markdown 文件并落盘。
   * @param request 导出请求，包含会话 ID。
   * @returns 导出结果；用户在保存对话框取消时返回 canceled。
   * @remarks 成员展示名加载失败时回退为角色 ID；图片附件复制到导出文件同名 .assets 目录。
   */
  async exportSession(request: ChatExportSessionRequest): Promise<ChatExportSessionResult> {
    if (!(await this.sessionStore.ensureSessionLoaded(request.sessionId))) {
      throw new Error(`Session not found: ${request.sessionId}`)
    }
    const session = this.sessionStore.getSession(request.sessionId)
    if (!session) {
      throw new Error(`Session not found: ${request.sessionId}`)
    }
    const characterNames = new Map<string, string>()
    await Promise.all(
      session.participants.map(async (characterId) => {
        try {
          const character = await this.dependencies.getCharacter(characterId)
          characterNames.set(characterId, character.name)
        } catch {
          characterNames.set(characterId, characterId)
        }
      })
    )
    return exportSessionMarkdown({
      session,
      characterNames
    })
  }

  /**
   * @description 中断正在执行的真实聊天运行。
   * @param requestId 要中断的聊天运行标识。
   * @returns 找到并发出中断信号时返回 `true`。
   */
  abortRun(requestId: string): boolean {
    return this.runRegistry.abort(requestId) !== undefined
  }

  /**
   * @description 在应用退出前中止全部仍在执行的聊天运行。
   */
  abortAllRuns(): void {
    this.runRegistry.abortAll()
  }

  /**
   * @description 关闭聊天运行时中止全部活跃运行。
   * @remarks Langfuse 数据冲刷由应用退出链统一负责，不在聊天域内部触发。
   */
  shutdown(): void {
    this.abortAllRuns()
  }

  /**
   * @description 读取当前轮次用户消息携带的实时图片，并按应用设置完成压缩处理。
   * @param sessionId 会话 ID。
   * @param messageIds 本轮用户消息 ID。
   * @returns 处理后的实时图片输入。
   */
  private async loadCurrentImages(
    sessionId: string,
    messageIds: string[]
  ): Promise<ChatImageInput[]> {
    const session = this.sessionStore.getSession(sessionId)
    if (!session) return []
    const ids = new Set(messageIds)
    const attachments = session.messages
      .filter((message) => ids.has(message.id) && message.role === 'user')
      .flatMap((message) => message.attachments || [])
    if (attachments.length === 0) return []
    const appSettings = await getChatHost().getAppSettings()
    const originals = (
      await Promise.all(
        attachments.map((attachment) =>
          this.sessionStore.readAttachment(sessionId, attachment.resourceId)
        )
      )
    )
      .filter((image): image is NonNullable<typeof image> => Boolean(image))
      .map(({ attachment, dataUrl }) => ({ ...attachment, dataUrl }))
    return Promise.all(
      originals.map(async (image) => ({
        ...image,
        dataUrl: await processChatImage(image.dataUrl, appSettings.chatImageProcessing)
      }))
    )
  }

  /**
   * @description 执行一次完整聊天运行的调度循环，并统一翻译终态事件。
   * @param input 已校验的运行上下文。
   * @remarks 本方法作为浮动调用运行：所有失败都在内部翻译成事件与日志，不向调用方传播。
   */
  private async executeRun(input: {
    requestId: string
    sessionId: string
    modelConfig: ResolvedModelConfig
    currentMessageIds: string[]
  }): Promise<void> {
    const activeRun = this.runRegistry.get(input.requestId)
    if (!activeRun) {
      return
    }
    try {
      const outcome = await withTrace(
        'chat-run',
        {
          sessionId: input.sessionId,
          metadata: {
            requestId: input.requestId,
            providerId: input.modelConfig.providerId,
            modelId: input.modelConfig.modelId
          }
        },
        async (observation) => {
          const scheduled = await this.runScheduledTurns(input)
          observation?.update({ output: { outcome: scheduled.status } })
          return scheduled
        }
      )
      // 先注销再收尾：终态快照经派生规则自然回落为落定状态。
      this.runRegistry.delete(input.requestId)
      finishRun(this.turnConsumerDeps, input, outcome, activeRun)
      if (outcome.status === 'completed') {
        // 回合收尾统一检查压缩水位；压缩为后台飞行，不阻塞运行收尾。
        this.sessionCompressor.maybeAutoCompress(input.sessionId)
      }
    } catch (error) {
      this.runRegistry.delete(input.requestId)
      finishRunAsFailure(this.turnConsumerDeps, input, error, activeRun)
    }
  }

  /**
   * @description 装配参与者并按会话人数选择流程包执行一次运行。
   * @param input 已校验的运行上下文。
   * @returns 运行最终状态。
   * @remarks 单聊加载单聊流程、群聊加载群聊流程；流程缺失或损坏由 chatContext 抛出，运行直接失败。
   */
  private async runScheduledTurns(input: {
    requestId: string
    sessionId: string
    modelConfig: ResolvedModelConfig
    currentMessageIds: string[]
  }): Promise<TurnOutcome> {
    const session = this.sessionStore.getSession(input.sessionId)
    if (!session) throw new Error(`Session not found: ${input.sessionId}`)
    const participants = await this.loadRunParticipants(session.participants)
    const participantNames = Object.fromEntries(
      participants.map((participant) => [participant.character.id, participant.character.name])
    )
    const flow = await this.chatContext.getFlow()
    return runFlowRun(this.turnConsumerDeps, {
      flow,
      requestId: input.requestId,
      sessionId: input.sessionId,
      modelConfig: input.modelConfig,
      currentMessageIds: input.currentMessageIds,
      participantNames,
      participants
    })
  }

  /**
   * @description 加载全部参与者的摘要与 prompt。
   * @param participantIds 会话固定成员角色 ID。
   * @returns 可供调度使用的成员资料。
   */
  private async loadRunParticipants(participantIds: string[]): Promise<ScheduledParticipant[]> {
    return Promise.all(
      participantIds.map(async (characterId) => {
        const [character, prompt] = await Promise.all([
          this.dependencies.getCharacter(characterId),
          this.dependencies.getCharacterPrompt(characterId)
        ])
        return { character, prompt: prompt.prompt }
      })
    )
  }
}
