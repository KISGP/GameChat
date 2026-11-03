import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages'
import type { ChatImageInput, ConversationMessage, ConversationSession } from '@gamechat/type'
import { estimateTextTokens } from './context-budget'
import { formatChatEmoticonMarker } from './'
import { contentToText } from './message-content'

export type HistoryViewOptions = {
  /** 从历史中排除的消息 ID，例如当前回合的 assistant 占位。 */
  excludeMessageId?: string
}

export type HistoryRenderOptions = {
  /** 是否按群聊格式渲染（assistant 消息带 `[名字]：` 前缀、不合并连续同角色消息）。 */
  isGroup: boolean
  /** senderId（角色 ID）到展示名的映射。 */
  characterNames: ReadonlyMap<string, string>
  /** 当前轮次用户消息 ID 与实时图片；仅这些消息携带多模态原图。 */
  currentTurn?: { messageIds: ReadonlySet<string>; images: ChatImageInput[] }
}

/**
 * @description 从会话快照筛选可进入模型历史的全部有效消息。
 * @param session 当前会话快照。
 * @param options 过滤选项；缺省时只应用有效消息过滤。
 * @returns 按会话顺序排列、可安全送入模型的消息列表。
 * @remarks 排除空消息、pending 占位与被排除 ID；aborted 消息保留，error 消息排除（失败提示不进入模型上下文）。
 *   存在滚动摘要时，锚点消息及其之前的区间已由摘要替代，不再进入原文窗口。
 */
export function buildSessionHistoryView(
  session: ConversationSession,
  options: HistoryViewOptions = {}
): ConversationMessage[] {
  const anchorIndex = findSummaryAnchorIndex(session)
  return session.messages.filter(
    (message, index) =>
      index > anchorIndex &&
      message.id !== options.excludeMessageId &&
      message.status !== 'error' &&
      (Boolean(message.content.trim()) ||
        Boolean(message.emoticonId) ||
        Boolean(message.attachments?.length)) &&
      (message.role === 'user' || message.status !== 'pending')
  )
}

/**
 * @description 定位会话摘要锚点消息的下标。
 * @param session 含滚动摘要的会话快照。
 * @returns 锚点消息下标；无摘要或锚点不可达时返回 -1。
 * @remarks 锚点经读取侧规范化保证存在；返回 -1 即无摘要。
 */
function findSummaryAnchorIndex(session: ConversationSession): number {
  if (!session.summary) {
    return -1
  }
  return session.messages.findIndex((message) => message.id === session.summary?.anchorMessageId)
}

/**
 * @description 构造滚动摘要的提示词段文本。
 * @param session 含滚动摘要的会话快照。
 * @returns 并入开头 system 的摘要段文本；会话尚无摘要时返回 null。
 */
export function buildSummarySectionText(session: ConversationSession): string | null {
  if (!session.summary) {
    return null
  }
  return `【此前对话摘要】\n${session.summary.text}`
}

/** 压缩区间选择结果：待并入摘要的区间与新锚点。 */
export type CompressionRegion = {
  /** 待并入摘要的消息区间，按会话顺序排列。 */
  region: ConversationMessage[]
  /** 区间最后一条消息，将成为新摘要的锚点。 */
  newAnchor: ConversationMessage
}

/**
 * @description 从有效历史中选择本次压缩的区间：保留窗口（最近 keepCount 条）之外的更早部分。
 * @param validMessages 已过滤的有效历史（按会话顺序），通常来自 buildSessionHistoryView。
 * @param keepCount 原文保留窗口的固定条数；0 表示全部压缩（手动全量整理）。
 * @returns 区间与新锚点；有效历史不超过保留窗口时返回 null。
 * @remarks 自动压缩调用方必须传入不低于 1 的保留窗口，防止水位路径压缩掉全部对话；
 *   手动全量整理传 0，区间覆盖全部有效历史。
 */
export function selectCompressionRegion(
  validMessages: readonly ConversationMessage[],
  keepCount: number
): CompressionRegion | null {
  const windowSize = Math.max(0, Math.floor(keepCount))
  if (validMessages.length <= windowSize) {
    return null
  }
  const region = validMessages.slice(0, validMessages.length - windowSize)
  return { region, newAnchor: region[region.length - 1] }
}

/**
 * @description 按条数上限与 token 上限推导自动压缩的原文保留窗口条数。
 * @param validMessages 已过滤的有效历史（按会话顺序）。
 * @param maxCount 保留窗口的条数上限。
 * @param maxWindowTokens 保留窗口的 token 上限；非正数时视为无限制。
 * @returns 实际保留窗口条数，至少为 1。
 * @remarks 从最新端向前累计消息正文的估算 token，先触达哪个上限就以哪个为准；
 *   至少保留 1 条，防止压缩区间吞掉当前对话的全部原文。多图或长文场景下
 *   token 上限保证压缩后剩余原文仍能装进预算，避免压缩白做。
 */
export function resolveKeepCount(
  validMessages: readonly ConversationMessage[],
  maxCount: number,
  maxWindowTokens: number
): number {
  const countCap = Math.max(1, Math.floor(maxCount))
  const tokenCap = maxWindowTokens > 0 ? maxWindowTokens : Number.POSITIVE_INFINITY
  let totalTokens = 0
  let count = 0
  for (let index = validMessages.length - 1; index >= 0; index -= 1) {
    const cost = estimateTextTokens(validMessages[index].content)
    if (count > 0 && totalTokens + cost > tokenCap) {
      break
    }
    totalTokens += cost
    count += 1
    if (count >= countCap) {
      break
    }
  }
  return count
}

/**
 * @description 校验角色名可安全用作群聊消息前缀。
 * @param name 待校验的角色展示名。
 * @remarks 名字包含 `]`、换行或与 `[emoticon:id]` 标记歧义时，会在群聊历史渲染中注入伪协议标记，因此必须拒绝。
 */
export function assertSafeParticipantName(name: string): void {
  if (!name.trim() || name.includes(']') || /[\r\n]/.test(name)) {
    throw new Error(`Character name is not safe for group chat history: ${name}`)
  }
}

/**
 * @description 将历史消息的表情渲染为携带描述的标记文本。
 * @param message 待渲染的历史消息。
 * @returns `[emoticon:id]（描述）` 文本；消息没有表情时返回空文本，缺少描述时只保留标记。
 * @remarks 描述随标记一起下发，模型无需表情清单即可理解历史中表情的含义。
 */
function formatHistoryEmoticonToken(message: ConversationMessage): string {
  if (!message.emoticonId) {
    return ''
  }
  const marker = formatChatEmoticonMarker(message.emoticonId)
  const description = message.emoticonDescription?.trim()
  return description ? `${marker}（${description}）` : marker
}

/**
 * @description 将会话历史渲染为模型消息数组，单角色与群聊共用同一入口。
 * @param history 已经过滤的历史消息窗口。
 * @param options 渲染格式选项。
 * @returns 不包含 system 提示词的模型消息数组。
 * @remarks 单角色按合并与多模态规则渲染；群聊为 1 气泡 1 消息：assistant 带 `[名字]：` 前缀、user 纯文本、不合并。
 */
export function renderHistoryMessages(
  history: ConversationMessage[],
  options: HistoryRenderOptions
): BaseMessage[] {
  if (!options.isGroup) {
    return renderDirectMessages(history, options.currentTurn)
  }
  return renderGroupMessages(history, options)
}

/**
 * @description 解析模型返回的发言意愿标记。
 * @param text 模型输出。
 * @returns 合法意愿分数，无法解析时返回 null。
 */
export function parseIntentScore(text: string): number | null {
  const match = text.match(/<intent>\s*(\d{1,3})\s*<\/intent>/iu)
  if (!match) return null
  const score = Number(match[1])
  return Number.isInteger(score) && score >= 0 && score <= 100 ? score : null
}

/**
 * @description 按单角色规则渲染历史：连续 user 消息合并，实时图片进入多模态内容。
 * @param history 已经过滤的历史消息窗口。
 * @param currentTurn 当前轮次消息 ID 与待发送图片。
 * @returns 渲染后的模型消息数组。
 */
function renderDirectMessages(
  history: ConversationMessage[],
  currentTurn?: HistoryRenderOptions['currentTurn']
): BaseMessage[] {
  const messages: BaseMessage[] = []
  const currentImagesByResourceId = new Map(
    (currentTurn?.images || []).map((image) => [image.resourceId, image])
  )

  for (const message of history) {
    const attachments = message.attachments || []
    const liveImages =
      message.role === 'user' && currentTurn?.messageIds.has(message.id)
        ? attachments
            .map((attachment) => currentImagesByResourceId.get(attachment.resourceId))
            .filter((image): image is ChatImageInput => Boolean(image))
        : []
    const historicalImageNotes = attachments
      .filter(
        (attachment) =>
          !currentTurn?.messageIds.has(message.id) ||
          !currentImagesByResourceId.has(attachment.resourceId)
      )
      .map((attachment) =>
        formatHistoricalImageNote(attachment.resourceId, attachment.fileName, attachment.analysis)
      )
    const text = [
      formatHistoryEmoticonToken(message),
      message.content.trim(),
      ...historicalImageNotes
    ]
      .filter(Boolean)
      .join('\n\n')

    if (!text && liveImages.length === 0) {
      continue
    }

    if (message.role === 'assistant') {
      messages.push(new AIMessage(text))
      continue
    }

    const previous = messages[messages.length - 1]
    if (previous instanceof HumanMessage) {
      const previousContent = contentToText(previous.content)
      const mergedText = [previousContent, text].filter(Boolean).join('\n')
      const previousImages = Array.isArray(previous.content)
        ? previous.content.filter(
            (item): item is { type: 'image_url'; image_url: { url: string } } =>
              Boolean(
                item &&
                typeof item === 'object' &&
                (item as { type?: unknown }).type === 'image_url'
              )
          )
        : []
      if (liveImages.length === 0 && previousImages.length === 0) {
        messages[messages.length - 1] = new HumanMessage(mergedText)
      } else {
        messages[messages.length - 1] = new HumanMessage({
          content: [
            ...(mergedText ? [{ type: 'text' as const, text: mergedText }] : []),
            ...previousImages,
            ...liveImages.map((image) => ({
              type: 'image_url' as const,
              image_url: { url: image.dataUrl }
            }))
          ]
        })
      }
      continue
    }

    if (liveImages.length === 0) {
      messages.push(new HumanMessage(text))
      continue
    }

    messages.push(
      new HumanMessage({
        content: [
          ...(text ? [{ type: 'text' as const, text }] : []),
          ...liveImages.map((image) => ({
            type: 'image_url' as const,
            image_url: { url: image.dataUrl }
          }))
        ]
      })
    )
  }

  return messages
}

/**
 * @description 按群聊格式渲染历史：1 气泡 1 消息，assistant 补 `[名字]：` 前缀且不合并。
 * @param history 已经过滤的历史消息窗口。
 * @param options 渲染格式选项。
 * @returns 带发言者标注的模型消息数组。
 */
function renderGroupMessages(
  history: ConversationMessage[],
  options: HistoryRenderOptions
): BaseMessage[] {
  const currentImagesByResourceId = new Map(
    (options.currentTurn?.images || []).map((image) => [image.resourceId, image])
  )
  return history.flatMap((message): BaseMessage[] => {
    const attachments = message.attachments || []
    const liveImages =
      message.role === 'user' && options.currentTurn?.messageIds.has(message.id)
        ? attachments
            .map((attachment) => currentImagesByResourceId.get(attachment.resourceId))
            .filter((image): image is ChatImageInput => Boolean(image))
        : []
    const historicalImageNotes = attachments
      .filter(
        (attachment) =>
          !options.currentTurn?.messageIds.has(message.id) ||
          !currentImagesByResourceId.has(attachment.resourceId)
      )
      .map((attachment) =>
        formatHistoricalImageNote(attachment.resourceId, attachment.fileName, attachment.analysis)
      )
    const body = [
      formatHistoryEmoticonToken(message),
      message.content.trim(),
      ...historicalImageNotes
    ]
      .filter(Boolean)
      .join('\n\n')

    if (message.role === 'assistant') {
      const senderName =
        options.characterNames.get(message.senderId) || message.senderId || '未知角色'
      const text = `${senderName}：${body}`
      return text.trim() === `${senderName}：` ? [] : [new AIMessage(text)]
    }

    const text = body
    if (!text && liveImages.length === 0) {
      return []
    }
    if (liveImages.length === 0) {
      return [new HumanMessage(text)]
    }
    return [
      new HumanMessage({
        content: [
          ...(text ? [{ type: 'text' as const, text }] : []),
          ...liveImages.map((image) => ({
            type: 'image_url' as const,
            image_url: { url: image.dataUrl }
          }))
        ]
      })
    ]
  })
}

/**
 * @description 将历史图片压缩为模型可引用的资源索引与综合摘要。
 * @param resourceId 图片资源索引 ID。
 * @param fileName 图片原始文件名。
 * @param analysis 已融合的图片分析摘要。
 * @returns 不携带图片二进制内容的历史图片说明。
 */
function formatHistoricalImageNote(resourceId: string, fileName: string, analysis: string): string {
  const summary =
    analysis.trim() || '暂无图片摘要。若当前问题需要核对图片细节，请根据资源索引重新读取。'
  return `[历史图片 resourceId=${resourceId} fileName=${fileName}]\n图片综合摘要：${summary}`
}
