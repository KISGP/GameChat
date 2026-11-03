import { mkdir, rm, writeFile } from 'fs/promises'
import type {
  ChatGroup,
  ChatImageAttachment,
  ChatImageInput,
  ChatTarget,
  ChatUserSegment,
  ContextUsage,
  ConversationMessage,
  ConversationSession,
  ConversationSessionSummary,
  MessageStatus,
  SessionSummary
} from '@gamechat/type'
import type { AssistantMessageSegment } from '@gamechat/schema'
import { CHAT_IMAGE_MIME_EXTENSIONS, CHAT_USER_EMOTICONS } from '@gamechat/schema'
import { logger } from '../../infra/log'
import {
  isPathSegment,
  pathExists,
  readDirectoryNames,
  readImageDataUrl,
  readJsonFile,
  writeJsonFileAtomic
} from '../../infra'
import {
  getChatAttachmentPath,
  getChatAttachmentsRoot,
  getChatCharacterRoot,
  getChatHistoryRoot,
  getChatSessionPath,
  getChatSessionRoot,
  getChatGroupsPath
} from '../paths'

import {
  buildGroupId,
  cloneMessage,
  cloneSession,
  createMessage,
  createSession,
  normalizeGroup,
  normalizeSession,
  now
} from './session-documents'
import { SessionPersistQueue } from './persist-queue'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/** 摘要索引中的单会话记录：面向列表链路的轻量摘要。 */
type SessionRecord = {
  // status 存落定值，读取时按运行活性派生
  summary: ConversationSessionSummary
}

export type SessionRestingStatus = 'idle' | 'error'

/** 会话存储选项。 */
export type SessionStoreOptions = {
  /** 是否落盘；false 用于编排调试的临时会话，全部状态只驻留内存。 */
  persist?: boolean
}

export class SessionStore {
  private records = new Map<string, SessionRecord>()
  private fullSessions = new Map<string, ConversationSession>()
  private groups = new Map<ChatGroup['id'], ChatGroup>()
  private readonly persist: boolean
  private readonly persistQueue = new SessionPersistQueue({
    persistSession: (sessionId) => this.persistSession(sessionId),
    persistGroups: () => this.persistGroups()
  })
  private runLivenessProvider: (sessionId: string) => boolean = () => false

  /**
   * @description 创建会话存储。
   * @param options 存储选项；缺省落盘。
   */
  constructor(options: SessionStoreOptions = {}) {
    this.persist = options.persist !== false
  }

  /**
   * @description 注入会话运行态活性谓词，由 ChatRuntime 装配时接到 RunRegistry。
   * @param provider 判断会话是否存在活跃运行的函数。
   * @remarks 派生运行态（running）的唯一事实来源；未注入时会话永远呈落定状态。
   */
  setRunLivenessProvider(provider: (sessionId: string) => boolean): void {
    this.runLivenessProvider = provider
  }

  /**
   * @description 克隆会话快照并把运行状态合成为派生值。
   * @param session 存储中的会话快照（落定状态）。
   * @returns 面向调用方的会话快照；有活跃运行时状态为 running。
   */
  private cloneWithDerivedStatus(session: ConversationSession): ConversationSession {
    return {
      ...cloneSession(session),
      status: this.runLivenessProvider(session.id) ? 'running' : session.status
    }
  }

  /**
   * @description 从全量会话派生列表摘要。
   * @param session 存储中的会话快照（落定状态）。
   * @returns 写入摘要索引的会话记录。
   * @remarks 摘要的 status 存落定值，读取时才派生运行态。
   */
  private buildSessionRecord(session: ConversationSession): SessionRecord {
    const lastMessage = session.messages[session.messages.length - 1]
    // 失败消息在列表内只以徽章呈现，预览同步降级为固定文案。
    const lastMessagePreview = lastMessage
      ? lastMessage.status === 'error'
        ? '回复失败'
        : lastMessage.content
      : ''
    return {
      summary: {
        id: session.id,
        ownerId: session.ownerId,
        participants: [...session.participants],
        ...(session.title ? { title: session.title } : {}),
        status: session.status,
        lastMessagePreview,
        messageCount: session.messages.length,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt
      }
    }
  }

  /**
   * @description 会话变更后按最新全量快照刷新摘要索引条目。
   * @param session 变更后的全量会话（必须已换入全量表）。
   * @returns 无返回值。
   */
  private refreshSessionRecord(session: ConversationSession): void {
    this.records.set(session.id, this.buildSessionRecord(session))
  }

  /**
   * @description 返回带派生运行态的摘要副本。
   * @param record 摘要索引中的会话记录。
   * @returns 面向调用方的摘要；有活跃运行时状态为 running。
   */
  private cloneSummaryWithDerivedStatus(record: SessionRecord): ConversationSessionSummary {
    return {
      ...record.summary,
      participants: [...record.summary.participants],
      status: this.runLivenessProvider(record.summary.id) ? 'running' : record.summary.status
    }
  }

  /**
   * @description 从磁盘加载群聊注册表与会话文档，并构建摘要索引；全量会话一律不驻留。
   * @remarks 会话文档按固定并发并行读取，加载时长不随会话数量线性串联；
   *   旧格式数据跳过并记录日志，不做格式兼容。
   */
  async initialize(): Promise<void> {
    if (!this.persist) {
      return
    }
    const root = getChatHistoryRoot()
    this.records = new Map()
    this.fullSessions = new Map()
    this.groups = new Map()
    const groups = await readJsonFile<ChatGroup[]>(getChatGroupsPath())
    if (groups !== null) {
      if (!Array.isArray(groups)) {
        void logger.warn('main', 'group-load-failed', 'Skipped invalid group chat registry', {
          reason: 'registry is not an array'
        })
      } else {
        for (const group of groups) {
          const normalized = normalizeGroup(group)
          if (!normalized) {
            void logger.warn('main', 'group-load-failed', 'Skipped invalid or legacy group entry', {
              groupId: (group as { id?: unknown }).id
            })
            continue
          }
          this.groups.set(normalized.id, normalized)
        }
      }
    }
    const sessionFiles: Array<{ ownerId: string; sessionId: string; filePath: string }> = []
    for (const ownerId of await readDirectoryNames(root)) {
      if (!isPathSegment(ownerId)) {
        continue
      }
      const ownerRoot = getChatCharacterRoot(ownerId)
      for (const sessionId of await readDirectoryNames(ownerRoot)) {
        if (!isPathSegment(sessionId)) {
          continue
        }
        sessionFiles.push({ ownerId, sessionId, filePath: getChatSessionPath(ownerId, sessionId) })
      }
    }
    await this.loadSessionDocuments(sessionFiles)
  }

  /**
   * @description 以固定并发并行加载会话文档并写入摘要索引。
   * @param sessionFiles 待加载的会话文件清单。
   * @remarks 单个文档无效只跳过并记录日志；并发数与目录清单收集先行，读取阶段不串行等待。
   */
  private async loadSessionDocuments(
    sessionFiles: Array<{
      ownerId: string
      sessionId: string
      filePath: string
    }>
  ): Promise<void> {
    const CONCURRENCY = 8
    let cursor = 0
    const workers = Array.from({ length: Math.min(CONCURRENCY, sessionFiles.length) }, async () => {
      while (cursor < sessionFiles.length) {
        const entry = sessionFiles[cursor]
        cursor += 1
        await this.loadSessionDocument(entry)
      }
    })
    await Promise.all(workers)
  }

  /**
   * @description 读取并校验单个会话文档，有效时写入摘要索引。
   * @param entry 会话文件条目，含所有者、会话 ID 与文件路径。
   * @returns 加载成功的全量会话，无效或缺失时返回 null。
   * @remarks readJsonFile 对缺失文件返回 null，由下方校验统一按无效文档跳过，无需先行探测存在性；
   *   加载只驻留摘要与近期消息缓存，不保留全量会话。
   */
  private async loadSessionDocument(entry: {
    ownerId: string
    sessionId: string
    filePath: string
  }): Promise<ConversationSession | null> {
    const raw = await readJsonFile<ConversationSession>(entry.filePath)
    if (!raw || raw.id !== entry.sessionId || !Array.isArray(raw.messages)) {
      void logger.warn('main', 'session-load-failed', 'Skipped invalid conversation session', {
        filePath: entry.filePath,
        reason: 'session document is missing or malformed'
      })
      return null
    }
    const session = normalizeSession(raw, entry.ownerId)
    if (!session) {
      void logger.warn(
        'main',
        'session-load-failed',
        'Skipped legacy or invalid conversation session',
        { filePath: entry.filePath, reason: 'unsupported or legacy session format' }
      )
      return null
    }
    if (session.participants.length > 1 && !this.groups.has(session.ownerId)) {
      void logger.warn(
        'main',
        'session-load-failed',
        'Skipped group session without a registered group',
        { filePath: entry.filePath, ownerId: session.ownerId }
      )
      return null
    }
    this.records.set(session.id, this.buildSessionRecord(session))
    return session
  }

  /**
   * @description 确保指定会话的全量快照已换入内存。
   * @param sessionId 会话标识。
   * @returns 会话存在且已换入时返回 true；会话不存在或文档无效时返回 false。
   * @remarks 换入路径以摘要索引中的所有者定位磁盘文档；重复调用对已换入会话直接命中。
   */
  async ensureSessionLoaded(sessionId: string): Promise<boolean> {
    if (this.fullSessions.has(sessionId)) {
      return true
    }
    const record = this.records.get(sessionId)
    if (!record) {
      return false
    }
    const session = await this.loadSessionDocument({
      ownerId: record.summary.ownerId,
      sessionId,
      filePath: getChatSessionPath(record.summary.ownerId, sessionId)
    })
    if (!session) {
      return false
    }
    this.fullSessions.set(sessionId, session)
    return true
  }

  /**
   * @description 换入指定会话并把其余闲置全量会话换出内存。
   * @param sessionId 要保留全量的会话标识。
   * @returns 换入后的全量会话快照（运行态已派生）；会话不存在或文档无效时返回 null。
   * @remarks 换出前先等待持久化队列冲刷，保证在途写盘以完整数据落盘；有活跃运行的会话
   *   由活性谓词保护，永不被换出。
   */
  async getSessionDetail(sessionId: string): Promise<ConversationSession | null> {
    if (!(await this.ensureSessionLoaded(sessionId))) {
      return null
    }
    await this.evictIdleFullSessions(sessionId)
    const session = this.fullSessions.get(sessionId)
    return session ? this.cloneWithDerivedStatus(session) : null
  }

  /**
   * @description 把无活跃运行且不在保留名单中的全量会话换出内存。
   * @param keepSessionId 换出时保留全量的会话标识。
   * @returns 换出完成后的 Promise。
   * @remarks 先冲刷持久化队列再移除，避免排队中的写盘任务读不到内存快照而丢失数据。
   */
  private async evictIdleFullSessions(keepSessionId: string): Promise<void> {
    await this.persistQueue.flush()
    for (const sessionId of this.fullSessions.keys()) {
      if (sessionId !== keepSessionId && !this.runLivenessProvider(sessionId)) {
        this.fullSessions.delete(sessionId)
      }
    }
  }

  /**
   * @description 返回全部会话的列表摘要。
   * @returns 按更新时间倒序排列、运行态已派生的摘要列表。
   */
  getSessionSummaries(): ConversationSessionSummary[] {
    return [...this.records.values()]
      .map((record) => this.cloneSummaryWithDerivedStatus(record))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  /**
   * @description 返回指定会话的列表摘要。
   * @param sessionId 会话标识。
   * @returns 运行态已派生的摘要，不存在时返回 null。
   */
  getSessionSummary(sessionId: string): ConversationSessionSummary | null {
    const record = this.records.get(sessionId)
    return record ? this.cloneSummaryWithDerivedStatus(record) : null
  }

  /**
   * @description 返回指定会话的列表摘要，缺失时抛错。
   * @param sessionId 会话标识。
   * @returns 运行态已派生的摘要。
   * @remarks 供运行链路发布事件时取用：这些路径刚完成会话变更，摘要必然存在，
   *   缺失即状态被并发破坏，直接抛错暴露。
   */
  getRequiredSessionSummary(sessionId: string): ConversationSessionSummary {
    const summary = this.getSessionSummary(sessionId)
    if (!summary) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    return summary
  }

  /**
   * @description 获取已换入内存的指定会话快照。
   * @param sessionId 会话标识。
   * @returns 运行态已派生的会话副本；会话不存在或尚未换入内存时返回 null。
   * @remarks 仅供回合执行与运行链路等已保证会话换入的调用方同步读取；列表链路一律走
   *   {@link getSessionSummaries}，需要全量时走 {@link getSessionDetail}。
   */
  getSession(sessionId: string): ConversationSession | null {
    const session = this.fullSessions.get(sessionId)
    return session ? this.cloneWithDerivedStatus(session) : null
  }

  /**
   * @description 返回全部独立群聊对象。
   * @returns 按更新时间倒序排列的群聊快照。
   */
  getGroups(): ChatGroup[] {
    return [...this.groups.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((group) => ({ ...group, participantIds: [...group.participantIds] }))
  }

  /**
   * @description 获取指定独立群聊。
   * @param groupId 群聊标识。
   * @returns 群聊快照，不存在时返回 null。
   */
  getGroup(groupId: string): ChatGroup | null {
    const group = this.groups.get(groupId)
    return group ? { ...group, participantIds: [...group.participantIds] } : null
  }

  /**
   * @description 创建成员固定的空群聊对象并立即持久化。
   * @param participantIds 群聊角色 ID，至少包含两名去重成员。
   * @returns 新建的群聊快照。
   * @remarks 群聊标识由固定成员集合确定性生成，同成员集合的再次创建直接命中并复用已有群聊。
   */
  createGroup(participantIds: string[]): ChatGroup {
    const uniqueParticipantIds = [...new Set(participantIds)]
    if (uniqueParticipantIds.length < 2 || uniqueParticipantIds.some((id) => !isPathSegment(id))) {
      throw new Error('Group chat requires at least two valid participant IDs.')
    }
    const groupId = buildGroupId(uniqueParticipantIds)
    const existing = this.groups.get(groupId)
    if (existing) return { ...existing, participantIds: [...existing.participantIds] }
    const timestamp = now()
    const group: ChatGroup = {
      id: groupId,
      participantIds: uniqueParticipantIds,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    this.groups.set(group.id, group)
    this.persistQueue.scheduleGroups()
    return { ...group, participantIds: [...group.participantIds] }
  }

  /**
   * @description 追加一条用户消息，可选择仅保存在 main 内存中。
   * @param input 用户消息及会话信息。
   * @param persist 是否立即持久化；等待窗口内传入 false。
   * @returns 更新后的会话与用户消息。
   * @remarks 已存在的会话成员不可变；目标所有者必须与会话的存储寻址所有者一致。
   */
  appendUserMessage(
    input: {
      sessionId?: string | null
      target: ChatTarget
      segment: ChatUserSegment
    },
    persist = true
  ): {
    session: ConversationSession
    userMessage: ConversationMessage
  } {
    const ownerId = input.target.ownerId
    const group = this.groups.get(ownerId)
    const timestamp = now()
    const session =
      (input.sessionId && this.fullSessions.get(input.sessionId)) ||
      createSession(ownerId, group ? group.participantIds : [ownerId], timestamp)

    if (session.ownerId !== ownerId) {
      throw new Error('Session does not belong to the selected chat target.')
    }

    const segment = input.segment
    const userMessage =
      segment.type === 'emoticon'
        ? createMessage(
            'user',
            'user',
            '',
            'complete',
            timestamp,
            undefined,
            segment.emoticonId,
            CHAT_USER_EMOTICONS.find((item) => item.id === segment.emoticonId)?.description
          )
        : createMessage(
            'user',
            'user',
            segment.text,
            'complete',
            timestamp,
            segment.images?.map(({ dataUrl, ...attachment }) => {
              void dataUrl
              return attachment
            })
          )
    session.messages.push(userMessage)
    session.updatedAt = timestamp
    this.fullSessions.set(session.id, session)
    this.refreshSessionRecord(session)
    if (persist) {
      this.persistQueue.scheduleSession(session.id)
    }

    return { session: this.cloneWithDerivedStatus(session), userMessage: cloneMessage(userMessage) }
  }

  /**
   * @description 为当前轮次的消息补记本次运行实际使用的模型条目标识。
   * @param sessionId 目标会话 ID。
   * @param messageIds 当前轮次的消息 ID 集合。
   * @param modelId 运行触发时解析出的模型条目标识。
   * @returns 补记后的会话快照。
   * @remarks 在运行触发时刻盖写，使合并发送窗口内的多条用户消息统一记为运行实际使用的模型；
   *   已带标识的消息保持原戳，重试换模型时首次发送的记录得以保留，「改用模型」提示落在重试回复上。
   */
  markTurnModel(
    sessionId: string,
    messageIds: readonly string[],
    modelId: string
  ): ConversationSession {
    const session = this.fullSessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    const idSet = new Set(messageIds)
    for (const message of session.messages) {
      if (idSet.has(message.id) && !message.modelId) {
        message.modelId = modelId
      }
    }
    this.refreshSessionRecord(session)
    this.persistQueue.scheduleSession(session.id)
    return this.cloneWithDerivedStatus(session)
  }

  /**
   * @description 为会话创建 assistant 占位并切换到运行状态。
   * @param sessionId 目标会话 ID。
   * @param characterId 发言角色 ID，必须是会话固定成员。
   * @param modelId 本回合运行所用模型条目标识，盖写到占位消息上。
   * @param persist 是否立即持久化。
   * @returns 更新后的会话与 assistant 占位消息。
   */
  beginRun(
    sessionId: string,
    characterId: string,
    modelId: string,
    persist = true
  ): {
    session: ConversationSession
    assistantMessage: ConversationMessage
  } {
    const session = this.fullSessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    if (!characterId || !session.participants.includes(characterId)) {
      throw new Error(`Character is not a session participant: ${characterId}`)
    }
    const timestamp = now()
    const assistantMessage = createMessage('assistant', characterId, '', 'pending', timestamp)
    assistantMessage.modelId = modelId
    session.messages.push(assistantMessage)
    session.updatedAt = timestamp
    this.fullSessions.set(session.id, session)
    this.refreshSessionRecord(session)
    if (persist) {
      this.persistQueue.scheduleSession(session.id)
    }
    return {
      session: this.cloneWithDerivedStatus(session),
      assistantMessage: cloneMessage(assistantMessage)
    }
  }

  /**
   * @description 落定会话的持久化状态；运行态（running）由活性谓词派生，不在此列。
   * @param sessionId 目标会话 ID。
   * @param status 落定状态；与当前值一致时跳过写入。
   * @returns 合成派生状态后的会话快照。
   */
  setSessionRestingStatus(sessionId: string, status: SessionRestingStatus): ConversationSession {
    const session = this.fullSessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    if (session.status !== status) {
      session.status = status
      session.updatedAt = now()
      this.refreshSessionRecord(session)
      this.persistQueue.scheduleSession(session.id)
    }
    return this.cloneWithDerivedStatus(session)
  }

  /**
   * @description 删除指定会话中的单条消息。
   * @param sessionId 会话 ID。
   * @param messageId 目标消息 ID。
   * @param persist 是否立即持久化。
   * @returns 删除后的会话快照。
   * @remarks 删除一条 error 消息且会话处于 error 状态时，会话状态回到 idle。
   */
  deleteMessage(sessionId: string, messageId: string, persist = true): ConversationSession {
    const session = this.fullSessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const index = session.messages.findIndex((message) => message.id === messageId)
    if (index === -1) {
      throw new Error(`Message not found: ${messageId}`)
    }

    const [removedMessage] = session.messages.splice(index, 1)
    if (session.summary && session.summary.anchorMessageId === messageId) {
      // 锚点消息被删后摘要指向不存在的位置：当次读取会原文回流、重启时整份摘要被丢弃，因此一并清除。
      session.summary = undefined
      void logger.warn(
        'ai',
        'session-summary-anchor-deleted',
        'Dropped rolling summary because its anchor message was deleted',
        { sessionId, messageId }
      )
    }
    if (session.status === 'error' && removedMessage.status === 'error') {
      session.status = 'idle'
    }
    session.updatedAt = now()
    this.fullSessions.set(session.id, session)
    this.refreshSessionRecord(session)
    if (persist) {
      this.persistQueue.scheduleSession(session.id)
    }

    return this.cloneWithDerivedStatus(session)
  }

  /**
   * @description 将一次运行生成的 assistant 回复段同步为连续的会话消息并立即持久化。
   * @param sessionId 会话 ID。
   * @param firstMessageId 本次运行开始时创建的第一条 assistant 消息 ID。
   * @param characterId 当前写入消息的角色标识。
   * @param contents 当前解析出的 assistant 消息段。
   * @param emoticonDescriptions 当前角色表情 ID 到描述的映射。
   * @param status 最后一条消息应使用的状态；前置消息会标记为 complete。
   * @param contextUsage 本次最终回复调用的上下文统计，覆盖会话上的旧统计。
   * @param nextSessionStatus 可选的会话落定状态更新；运行态（running）由活性谓词派生。
   * @returns 更新后的会话快照。
   */
  syncAssistantRunMessages(
    sessionId: string,
    firstMessageId: string,
    characterId: string,
    contents: AssistantMessageSegment[],
    emoticonDescriptions: ReadonlyMap<string, string>,
    status: MessageStatus,
    contextUsage: ContextUsage,
    nextSessionStatus?: SessionRestingStatus
  ): ConversationSession {
    const session = this.fullSessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const firstIndex = session.messages.findIndex((message) => message.id === firstMessageId)
    if (firstIndex === -1) {
      throw new Error(`Message not found: ${firstMessageId}`)
    }

    const nextContents = contents.length > 0 ? contents : [{ type: 'text' as const, text: '' }]
    const existingRunMessages: ConversationMessage[] = []
    let scanIndex = firstIndex
    while (
      scanIndex < session.messages.length &&
      session.messages[scanIndex].role === 'assistant'
    ) {
      existingRunMessages.push(session.messages[scanIndex])
      scanIndex += 1
    }

    const timestamp = now()
    const nextMessages = nextContents.map((segment, index) => {
      const existing = existingRunMessages[index]
      return {
        ...(existing || createMessage('assistant', characterId, '', 'pending', timestamp)),
        content: segment.type === 'text' ? segment.text : '',
        ...(segment.type === 'emoticon'
          ? {
              emoticonId: segment.emoticonId,
              emoticonDescription: emoticonDescriptions.get(segment.emoticonId)
            }
          : { emoticonId: undefined, emoticonDescription: undefined }),
        status: index === nextContents.length - 1 ? status : 'complete'
      }
    })

    session.messages.splice(firstIndex, existingRunMessages.length, ...nextMessages)
    if (nextSessionStatus) {
      session.status = nextSessionStatus
    }
    session.contextUsage = { ...contextUsage }
    session.updatedAt = timestamp
    this.fullSessions.set(session.id, session)
    this.refreshSessionRecord(session)
    this.persistQueue.scheduleSession(session.id)

    return this.cloneWithDerivedStatus(session)
  }

  /**
   * @description 更新一次 assistant 运行中最后一条气泡的状态。
   * @param sessionId 会话 ID。
   * @param firstMessageId 本次运行开始时创建的第一条 assistant 消息 ID。
   * @param status 最后一条 assistant 气泡的新状态。
   * @param errorMessage 失败落定时记录的错误信息；其他状态忽略。
   * @returns 合成派生状态后的会话快照。
   * @remarks 只修改消息；会话落定状态由 run 收尾流程经 setSessionRestingStatus 统一管理。
   *   错误信息写入消息的 errorMessage 字段供失败徽章展示，气泡正文只保留角色实际生成的内容。
   */
  updateAssistantRunStatus(
    sessionId: string,
    firstMessageId: string,
    status: MessageStatus,
    errorMessage?: string
  ): ConversationSession {
    const session = this.fullSessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const firstIndex = session.messages.findIndex((message) => message.id === firstMessageId)
    if (firstIndex === -1) {
      throw new Error(`Message not found: ${firstMessageId}`)
    }

    let lastRunMessageIndex = firstIndex
    let scanIndex = firstIndex
    while (
      scanIndex < session.messages.length &&
      session.messages[scanIndex].role === 'assistant'
    ) {
      lastRunMessageIndex = scanIndex
      scanIndex += 1
    }

    const currentMessage = session.messages[lastRunMessageIndex]
    session.messages[lastRunMessageIndex] = {
      ...currentMessage,
      ...(status === 'error' && errorMessage ? { errorMessage } : {}),
      status
    }
    session.updatedAt = now()
    this.fullSessions.set(session.id, session)
    this.refreshSessionRecord(session)
    this.persistQueue.scheduleSession(session.id)

    return this.cloneWithDerivedStatus(session)
  }

  /**
   * @description 删除指定会话：移出摘要索引与全量表并删除其磁盘目录（含会话文档与全部附件）。
   * @param sessionId 目标会话 ID。
   * @remarks 调用方必须先确认会话无活跃运行；删除只依赖摘要索引中的所有者定位磁盘目录，
   *   无需会话处于换入状态。已排队的会话写盘任务在会话消失后自动空转，不会把已删除的会话写回磁盘。
   */
  async deleteSession(sessionId: string): Promise<void> {
    const record = this.records.get(sessionId)
    if (!record) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    this.records.delete(sessionId)
    this.fullSessions.delete(sessionId)
    if (!this.persist) {
      return
    }
    await rm(getChatSessionRoot(record.summary.ownerId, sessionId), {
      recursive: true,
      force: true
    })
  }

  /**
   * @description 删除指定群聊：级联删除其全部会话后移除群定义并持久化注册表。
   * @param groupId 目标群聊 ID。
   * @returns 被级联删除会话的摘要列表。
   * @remarks 调用方必须先确认群下全部会话无活跃运行；删除只依赖摘要索引定位会话，无需换入全量。
   *   磁盘删除在内存移除后执行，已排队的写盘任务与会话删除一致自动空转。
   */
  async deleteGroup(groupId: string): Promise<ConversationSessionSummary[]> {
    const group = this.groups.get(groupId)
    if (!group) {
      throw new Error(`Group not found: ${groupId}`)
    }
    const removedSummaries: ConversationSessionSummary[] = []
    for (const [sessionId, record] of this.records) {
      if (record.summary.ownerId !== groupId) {
        continue
      }
      removedSummaries.push(this.cloneSummaryWithDerivedStatus(record))
      this.records.delete(sessionId)
      this.fullSessions.delete(sessionId)
    }
    this.groups.delete(groupId)
    this.persistQueue.scheduleGroups()
    if (!this.persist) {
      return removedSummaries
    }
    for (const summary of removedSummaries) {
      await rm(getChatSessionRoot(summary.ownerId, summary.id), { recursive: true, force: true })
    }
    return removedSummaries
  }

  /**
   * @description 设置群聊的侧栏置顶标记并持久化注册表。
   * @param groupId 目标群聊 ID。
   * @param pinned 是否置顶。
   * @returns 更新后的群聊快照。
   * @remarks 置顶切换不更新 updatedAt，避免纯偏好变更引起侧栏按活跃时间重排。
   */
  setGroupPinned(groupId: string, pinned: boolean): ChatGroup {
    const group = this.groups.get(groupId)
    if (!group) {
      throw new Error(`Group not found: ${groupId}`)
    }
    if (Boolean(group.pinned) === pinned) {
      return { ...group, participantIds: [...group.participantIds] }
    }
    const next: ChatGroup = { ...group, pinned: pinned ? true : undefined }
    this.groups.set(groupId, next)
    this.persistQueue.scheduleGroups()
    return { ...next, participantIds: [...next.participantIds] }
  }

  /**
   * @description 设置会话的自定义标题并立即持久化。
   * @param sessionId 目标会话 ID。
   * @param title 新标题；去除首尾空白后为空表示清除自定义标题。
   * @returns 更新后的会话快照。
   * @remarks 标题是纯元数据，不更新 updatedAt 以避免侧栏与卡片内列表按活跃时间重排；
   *   运行中的会话同样允许改名。
   */
  renameSession(sessionId: string, title: string): ConversationSession {
    const session = this.fullSessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    const normalizedTitle = title.trim() || undefined
    if (session.title === normalizedTitle) {
      return this.cloneWithDerivedStatus(session)
    }
    session.title = normalizedTitle
    this.refreshSessionRecord(session)
    this.persistQueue.scheduleSession(session.id)
    return this.cloneWithDerivedStatus(session)
  }

  /**
   * @description 将图片输入的二进制内容保存到指定会话附件目录。
   * @param sessionId 目标会话 ID。
   * @param input 包含资源 ID、MIME、文件名和 Data URL 的图片输入。
   * @returns 写入后的图片附件元数据。
   * @remarks 仅允许 PNG、JPEG 和 WebP；所有者直接取自摘要索引，无需会话处于换入状态。
   *   拥有者、会话与资源 ID 的路径段校验由 paths 层统一承担。
   */
  async saveAttachment(sessionId: string, input: ChatImageInput): Promise<ChatImageAttachment> {
    const record = this.records.get(sessionId)
    if (!record) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    const ownerId = record.summary.ownerId
    const extension = CHAT_IMAGE_MIME_EXTENSIONS[input.mimeType]
    if (!extension) {
      throw new Error(`Unsupported image MIME type: ${input.mimeType}`)
    }

    const match = input.dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/)
    if (!match || match[1] !== input.mimeType) {
      throw new Error('Invalid image data URL')
    }
    const data = Buffer.from(match[2], 'base64')
    if (data.byteLength === 0) {
      throw new Error('Image data is empty')
    }
    if (data.byteLength > MAX_IMAGE_BYTES) {
      throw new Error('Image exceeds the 10 MB size limit')
    }

    const attachmentPath = getChatAttachmentPath(ownerId, sessionId, input.resourceId, extension)
    await mkdir(getChatAttachmentsRoot(ownerId, sessionId), { recursive: true })
    await writeFile(attachmentPath, data)
    return {
      resourceId: input.resourceId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: data.byteLength,
      analysis: input.analysis || ''
    }
  }

  /**
   * @description 按资源 ID 读取会话附件并转换为模型或界面可用的 Data URL。
   * @param sessionId 目标会话 ID。
   * @param resourceId 会话内附件资源 ID。
   * @returns 附件元数据及 Data URL；资源不存在时返回 null。
   * @remarks 附件记录的 MIME 类型不在图片白名单内时按资源缺失处理，同样返回 null。
   */
  async readAttachment(
    sessionId: string,
    resourceId: string
  ): Promise<{ attachment: ChatImageAttachment; dataUrl: string } | null> {
    const session = this.fullSessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    const attachment = session.messages
      .flatMap((message) => message.attachments || [])
      .find((item) => item.resourceId === resourceId)
    if (!attachment) {
      return null
    }
    const extension = CHAT_IMAGE_MIME_EXTENSIONS[attachment.mimeType]
    if (!extension) {
      return null
    }
    const attachmentPath = getChatAttachmentPath(session.ownerId, session.id, resourceId, extension)
    if (!(await pathExists(attachmentPath))) {
      return null
    }
    return { attachment: { ...attachment }, dataUrl: await readImageDataUrl(attachmentPath) }
  }

  /**
   * @description 写入会话滚动摘要并持久化。
   * @param sessionId 目标会话 ID。
   * @param summary 新摘要；覆盖锚点消息及其之前的全部历史。
   * @returns 更新后的会话快照。
   * @remarks 摘要与消息同文档原子重写；锚点消息不存在时抛错，由调用方按不可压缩处理。
   */
  updateSessionSummary(sessionId: string, summary: SessionSummary): ConversationSession {
    const session = this.fullSessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    if (!session.messages.some((message) => message.id === summary.anchorMessageId)) {
      throw new Error(`Summary anchor message not found: ${summary.anchorMessageId}`)
    }
    session.summary = summary
    session.updatedAt = now()
    this.fullSessions.set(session.id, session)
    this.refreshSessionRecord(session)
    this.persistQueue.scheduleSession(session.id)
    return this.cloneWithDerivedStatus(session)
  }

  /**
   * @description 更新会话中指定图片资源的综合分析摘要，并替换旧摘要。
   * @param sessionId 目标会话 ID。
   * @param resourceId 会话内附件资源 ID。
   * @param analysis 新的综合分析文本。
   * @returns 更新后的会话快照。
   */
  updateImageAnalysis(
    sessionId: string,
    resourceId: string,
    analysis: string
  ): ConversationSession {
    const session = this.fullSessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    let updated = false
    session.messages = session.messages.map((message) => {
      if (!message.attachments?.some((attachment) => attachment.resourceId === resourceId)) {
        return message
      }
      updated = true
      return {
        ...message,
        attachments: message.attachments.map((attachment) =>
          attachment.resourceId === resourceId ? { ...attachment, analysis } : attachment
        )
      }
    })
    if (!updated) {
      // 消息可能在回合进行中被删除;分析随消息消失是合法态,跳过落库而非令整回合失败。
      void logger.warn(
        'ai',
        'image-analysis-target-missing',
        'Image attachment not found for analysis',
        {
          sessionId,
          resourceId
        }
      )
      return this.cloneWithDerivedStatus(session)
    }
    session.updatedAt = now()
    this.fullSessions.set(session.id, session)
    this.refreshSessionRecord(session)
    this.persistQueue.scheduleSession(session.id)
    return this.cloneWithDerivedStatus(session)
  }

  /**
   * @description 设置一条消息的图片附件元数据，并立即持久化会话。
   * @param sessionId 目标会话 ID。
   * @param messageId 目标消息 ID。
   * @param attachments 要写入的附件元数据。
   * @param persist 是否立即持久化。
   * @returns 更新后的会话快照。
   */
  setMessageAttachments(
    sessionId: string,
    messageId: string,
    attachments: ChatImageAttachment[],
    persist = true
  ): ConversationSession {
    const session = this.fullSessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    const index = session.messages.findIndex((message) => message.id === messageId)
    if (index === -1) {
      throw new Error(`Message not found: ${messageId}`)
    }
    session.messages[index] = {
      ...session.messages[index],
      ...(attachments.length > 0
        ? { attachments: attachments.map((attachment) => ({ ...attachment })) }
        : { attachments: undefined })
    }
    session.updatedAt = now()
    this.fullSessions.set(session.id, session)
    this.refreshSessionRecord(session)
    if (persist) {
      this.persistQueue.scheduleSession(session.id)
    }
    return this.cloneWithDerivedStatus(session)
  }

  /**
   * @description 将单个会话快照原子写入其独立 session.json 文件。
   * @param sessionId 要持久化的会话 ID。
   * @returns 写入完成后的 Promise。
   * @remarks 只持久化换入内存的全量会话；会话不存在（已删除或已换出）时静默跳过，
   *   换出路径已保证先冲刷本队列再移除内存快照。
   */
  private async persistSession(sessionId: string): Promise<void> {
    if (!this.persist) {
      return
    }
    const session = this.fullSessions.get(sessionId)
    if (!session) {
      return
    }
    // 落盘使用落定状态。紧凑序列化降低长会话的写盘体积与耗时。
    await writeJsonFileAtomic(getChatSessionPath(session.ownerId, session.id), session, 0)
  }

  /**
   * @description 将群聊注册表原子写入磁盘。
   * @returns 写入完成后的 Promise。
   */
  private async persistGroups(): Promise<void> {
    if (!this.persist) {
      return
    }
    await writeJsonFileAtomic(getChatGroupsPath(), this.getGroups())
  }
}
