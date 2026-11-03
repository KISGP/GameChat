import { randomUUID } from 'crypto'
import type {
  ChatGroup,
  ChatImageAttachment,
  ConversationMessage,
  ConversationSession,
  ContextUsage,
  MessageStatus,
  SessionSummary
} from '@gamechat/type'
import { isPathSegment } from '../../infra'

/**
 * @description 返回当前时间的 ISO 字符串，统一会话文档的时间戳格式。
 * @returns ISO 8601 时间戳。
 */
export function now(): string {
  return new Date().toISOString()
}

/**
 * @description 深拷贝单条消息，隔离附件数组引用。
 * @param message 待拷贝消息。
 * @returns 拷贝后的消息快照。
 */
export function cloneMessage(message: ConversationMessage): ConversationMessage {
  return {
    ...message,
    ...(message.attachments
      ? { attachments: message.attachments.map((attachment) => ({ ...attachment })) }
      : {})
  }
}

/**
 * @description 深拷贝会话快照，隔离参与者、消息与上下文统计引用。
 * @param session 待拷贝会话。
 * @returns 拷贝后的会话快照。
 */
export function cloneSession(session: ConversationSession): ConversationSession {
  return {
    ...session,
    participants: [...session.participants],
    messages: session.messages.map(cloneMessage),
    ...(session.contextUsage ? { contextUsage: { ...session.contextUsage } } : {}),
    ...(session.summary ? { summary: { ...session.summary } } : {})
  }
}

/**
 * @description 创建一条会话消息。
 * @param role 消息角色。
 * @param senderId 发送者标识。
 * @param content 文本内容。
 * @param status 消息状态。
 * @param createdAt 创建时间；缺省取当前时间。
 * @param attachments 可选图片附件元数据。
 * @param emoticonId 可选表情 ID。
 * @param emoticonDescription 可选表情描述。
 * @returns 新消息对象。
 */
export function createMessage(
  role: ConversationMessage['role'],
  senderId: string,
  content: string,
  status: MessageStatus,
  createdAt = now(),
  attachments?: ChatImageAttachment[],
  emoticonId?: string,
  emoticonDescription?: string
): ConversationMessage {
  return {
    id: randomUUID(),
    role,
    senderId,
    content,
    ...(emoticonId ? { emoticonId } : {}),
    ...(emoticonDescription ? { emoticonDescription } : {}),
    status,
    createdAt,
    ...(attachments && attachments.length > 0
      ? { attachments: attachments.map((attachment) => ({ ...attachment })) }
      : {})
  }
}

/**
 * @description 校验会话文档中的上下文统计字段。
 * @param value 从磁盘读取的原始统计值。
 * @returns 合法时返回规范化统计快照；结构不完整或字段非法时返回 undefined。
 */
export function normalizeContextUsage(value: unknown): ContextUsage | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<ContextUsage>
  if (typeof raw.modelId !== 'string' || typeof raw.recordedAt !== 'string' || !raw.recordedAt) {
    return undefined
  }
  const isPositiveInteger = (input: unknown): input is number =>
    typeof input === 'number' && Number.isSafeInteger(input) && input > 0
  const isNonNegativeNumber = (input: unknown): input is number =>
    typeof input === 'number' && Number.isFinite(input) && input >= 0
  if (raw.status === 'unavailable') {
    return { status: 'unavailable', modelId: raw.modelId, recordedAt: raw.recordedAt }
  }
  if (
    raw.status === 'available' &&
    typeof raw.inputTokens === 'number' &&
    Number.isSafeInteger(raw.inputTokens) &&
    raw.inputTokens >= 0
  ) {
    return {
      status: 'available',
      modelId: raw.modelId,
      recordedAt: raw.recordedAt,
      inputTokens: raw.inputTokens,
      ...(isNonNegativeNumber(raw.cacheReadTokens) ? { cacheReadTokens: raw.cacheReadTokens } : {}),
      ...(isPositiveInteger(raw.contextWindow) ? { contextWindow: raw.contextWindow } : {})
    }
  }
  return undefined
}

/**
 * @description 由固定成员集合生成确定性的群聊标识。
 * @param participantIds 群聊成员角色 ID。
 * @returns 成员去重排序、URI 编码后以 `+` 连接的标识。
 * @remarks 编码消除成员 ID 内容与 `+` 分隔符的歧义，选择顺序不影响结果，生成结果可整体通过路径段校验。
 */
export function buildGroupId(participantIds: readonly string[]): string {
  return [...new Set(participantIds)]
    .sort()
    .map((id) => encodeURIComponent(id))
    .join('+')
}

/**
 * @description 校验会话文档是否符合参与者数据模型。
 * @param raw 从磁盘读取的原始会话文档。
 * @param expectedOwnerId 会话目录的拥有者标识。
 * @returns 合法时返回规范化会话；旧格式或非法文档返回 null 并由调用方记录日志。
 * @remarks 旧格式（kind/characterId/groupId 或 legacy participantIds）不做兼容迁移，一律跳过；
 *   上下文统计结构不完整时按尚无实际用量处理。
 */
export function normalizeSession(
  raw: ConversationSession,
  expectedOwnerId: string
): ConversationSession | null {
  if (
    (raw as { kind?: unknown }).kind !== undefined ||
    (raw as { characterId?: unknown }).characterId !== undefined ||
    (raw as { groupId?: unknown }).groupId !== undefined
  ) {
    return null
  }
  if (!Array.isArray(raw.participants) || raw.participants.length === 0) {
    return null
  }
  if (raw.participants.some((participantId) => !isPathSegment(participantId))) {
    return null
  }
  if (!isPathSegment(raw.ownerId) || raw.ownerId !== expectedOwnerId) {
    return null
  }
  if (raw.participants.length === 1 && raw.participants[0] !== raw.ownerId) {
    return null
  }
  const contextUsage = normalizeContextUsage(raw.contextUsage)
  const rawTitle = typeof raw.title === 'string' ? raw.title.trim() : ''
  const summary = normalizeSummary(raw.summary, raw.messages)
  return {
    ...raw,
    // 落定值只保留 idle/error；读取到的 running 归一为 idle，运行态由活跃 run 派生。
    status: raw.status === 'running' ? 'idle' : raw.status,
    ...(contextUsage ? { contextUsage } : {}),
    ...(summary ? { summary } : { summary: undefined }),
    ...(rawTitle ? { title: rawTitle } : { title: undefined }),
    participants: [...raw.participants],
    messages: raw.messages.map((message) => ({
      ...message,
      senderId: message.senderId || (message.role === 'user' ? 'user' : '')
    }))
  }
}

/**
 * @description 校验会话滚动摘要的结构与锚点可达性。
 * @param summary 待校验的摘要值；字段缺失时为 undefined。
 * @param messages 同文档内的消息数组，用于确认锚点消息存在。
 * @returns 合法的摘要快照；结构不完整、正文为空或锚点消息不存在时返回 undefined。
 * @remarks 锚点不可达意味着摘要覆盖区间失去依据，按尚无压缩记录降级，历史回退为全量原文。
 */
function normalizeSummary(
  summary: SessionSummary | undefined,
  messages: ConversationMessage[]
): SessionSummary | undefined {
  if (!summary || typeof summary !== 'object') {
    return undefined
  }
  if (
    typeof summary.text !== 'string' ||
    !summary.text.trim() ||
    typeof summary.anchorMessageId !== 'string' ||
    !summary.anchorMessageId ||
    typeof summary.recordedAt !== 'string' ||
    !summary.recordedAt
  ) {
    return undefined
  }
  if (!messages.some((message) => message.id === summary.anchorMessageId)) {
    return undefined
  }
  return summary
}

/**
 * @description 校验并规范化群聊注册表条目。
 * @param group 原始群聊条目。
 * @returns 合法群聊快照；旧格式、非法条目或群标识与成员集合不一致的条目返回 null。
 */
export function normalizeGroup(group: ChatGroup): ChatGroup | null {
  if (!group || typeof group !== 'object') return null
  if (!Array.isArray(group.participantIds)) return null
  const participantIds = [...new Set(group.participantIds.filter(isPathSegment))]
  if (participantIds.length < 2 || group.id !== buildGroupId(participantIds)) return null
  return { ...group, participantIds, ...(group.pinned === true ? { pinned: true } : {}) }
}

/**
 * @description 创建新的空会话快照。
 * @param ownerId 存储寻址所有者。
 * @param participants 固定成员角色 ID。
 * @param timestamp 创建时间。
 * @returns 新会话快照。
 */
export function createSession(
  ownerId: string,
  participants: string[],
  timestamp: string
): ConversationSession {
  return {
    id: randomUUID(),
    ownerId,
    participants: [...participants],
    messages: [],
    status: 'idle',
    createdAt: timestamp,
    updatedAt: timestamp
  }
}
