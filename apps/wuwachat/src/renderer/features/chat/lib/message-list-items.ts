import type { ConversationMessage } from '@gamechat/type'

/** 消息列表内系统提示徽章的种类。 */
export type ChatBadgeKind = 'model-switch' | 'summary' | 'failure' | 'interrupted'

/** 消息列表的展示条目：对话消息，或由落盘事实派生的系统提示徽章。 */
export type MessageListItem =
  | {
      kind: 'message'
      key: string
      message: ConversationMessage
      /** 该气泡按钮框承载重试时的重试目标消息 ID；缺省表示本气泡不承载重试钮。 */
      retryTargetId?: string
      /**
       * 该气泡是失败轮次的输入用户消息时携带对应失败 assistant 消息 ID，供「重新编辑」按钮定位；
       * 缺省表示本气泡不承载编辑钮。
       */
      editTargetId?: string
    }
  | {
      kind: 'badge'
      key: string
      badge: ChatBadgeKind
      /**
       * 徽章主文案；模型切换含模型名，失败含角色名与供应商错误信息。
       */
      label: string
      /** 失败徽章悬停展示的供应商错误信息全文。 */
      detail?: string
      /** 徽章对应的消息 ID；失败徽章用它挂载重试按钮。 */
      messageId?: string
    }

/** 对话消息条目。 */
export type MessageEntryItem = Extract<MessageListItem, { kind: 'message' }>

/** 系统提示徽章条目。 */
export type MessageBadgeItem = Extract<MessageListItem, { kind: 'badge' }>

export type MessageListItemsOptions = {
  /** 会话滚动摘要的锚点消息 ID；其后第一条消息上方派生「已整理为摘要」徽章。 */
  summaryAnchorMessageId: string | null
  /** 是否群聊；失败徽章在群聊下带发言角色名。 */
  isGroup: boolean
  /** 当前可重试的消息 ID；重试钮由重试目标自身的气泡或其前最近的可见回复气泡承载。 */
  retryableMessageId: string | null
  /** 模型条目标识到展示名的解析；模型已被删除时返回 null。 */
  resolveModelName: (modelId: string) => string | null
  /** 角色 ID 到展示名的解析。 */
  resolveSenderName: (senderId: string) => string | null
}

/**
 * @description 把失败轮次的编辑标记挂到失败 assistant 消息前最近一条用户消息条目上。
 * @param items 已组装的展示条目列表。
 * @param assistantMessageId 失败或中断的 assistant 消息 ID。
 * @remarks 「重新编辑」按钮据此定位到该轮输入的用户气泡；没有前置用户消息时不挂标记。
 */
function markFailureEditTarget(items: MessageListItem[], assistantMessageId: string): void {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const candidate = items[index]
    if (candidate.kind === 'message' && candidate.message.role === 'user') {
      candidate.editTargetId = assistantMessageId
      return
    }
  }
}

/**
 * @description 将会话消息组装为消息列表展示条目，按落盘事实派生系统提示徽章。
 * @param messages 当前展示的消息列表（已完成流式分段替换）。
 * @param options 锚点、群聊标记与名称解析回调。
 * @returns 徽章与消息交替的展示条目列表。
 * @remarks 徽章是渲染期派生物，不新增存储：模型切换对比相邻消息的 modelId 戳，摘要徽章取锚点边界，
 *   失败与空中断取消息落定状态；首条带戳消息与无戳旧数据不产生切换徽章，中断且有半截内容的消息保留原气泡。
 *   重试钮的承载规则：半截内容的中断气泡与失败徽章自身承载重试（后者无气泡实体）；空中断尾部是
 *   纯提示，重试钮挂在其前最近一条用户消息的按钮框里，语义是重新生成对该消息的回复。
 */
export function buildMessageListItems(
  messages: readonly ConversationMessage[],
  options: MessageListItemsOptions
): MessageListItem[] {
  const items: MessageListItem[] = []
  /** 上一个已见过的模型戳；undefined 表示尚未见过任何戳，首条带戳消息不提示。 */
  let lastModelId: string | undefined = undefined
  let previousMessage: ConversationMessage | null = null
  for (const message of messages) {
    if (
      options.summaryAnchorMessageId !== null &&
      previousMessage?.id === options.summaryAnchorMessageId
    ) {
      items.push({
        kind: 'badge',
        key: `summary:${options.summaryAnchorMessageId}`,
        badge: 'summary',
        label: '已整理为摘要'
      })
    }
    if (message.modelId && lastModelId !== undefined && lastModelId !== message.modelId) {
      const modelName = options.resolveModelName(message.modelId)
      items.push({
        kind: 'badge',
        key: `switch:${message.id}`,
        badge: 'model-switch',
        label: modelName ? `改用模型 ${modelName}` : '模型已切换'
      })
    }
    if (message.modelId) {
      lastModelId = message.modelId
    }
    previousMessage = message
    if (message.role === 'assistant' && message.status === 'error') {
      const errorText = message.errorMessage?.trim() || legacyFailureText(message.content)
      const senderName = options.isGroup ? options.resolveSenderName(message.senderId) : null
      const base = senderName ? `${senderName} 回复失败` : '回复失败'
      items.push({
        kind: 'badge',
        key: `failure:${message.id}`,
        badge: 'failure',
        label: errorText ? `${base}：${errorText}` : base,
        detail: errorText || undefined,
        messageId: message.id
      })
      markFailureEditTarget(items, message.id)
      continue
    }
    if (message.role === 'assistant' && message.status === 'aborted' && !message.content.trim()) {
      // 空中断尾部是纯提示；可重试时重试钮挂在其前最近一条用户消息的按钮框里，
      // 语义是「重新生成对该消息的回复」，重试目标仍是中断尾部本身。
      if (message.id === options.retryableMessageId) {
        for (let index = items.length - 1; index >= 0; index -= 1) {
          const candidate = items[index]
          if (candidate.kind === 'message' && candidate.message.role === 'user') {
            candidate.retryTargetId = message.id
            break
          }
        }
      }
      markFailureEditTarget(items, message.id)
      items.push({
        kind: 'badge',
        key: `interrupted:${message.id}`,
        badge: 'interrupted',
        label: '已中断'
      })
      continue
    }
    // 带半截内容的中断气泡保留原样展示；其轮次的编辑标记挂到前置用户气泡上。
    if (message.role === 'assistant' && message.status === 'aborted') {
      markFailureEditTarget(items, message.id)
    }
    items.push({
      kind: 'message',
      key: message.id,
      message,
      ...(message.id === options.retryableMessageId ? { retryTargetId: message.id } : {})
    })
  }
  // 手动全量压缩后锚点即最后一条消息，其后没有可依附的消息：摘要徽章改挂在列表末尾，
  // 保证每一次压缩都在列表中留下可见标记。
  if (
    options.summaryAnchorMessageId !== null &&
    previousMessage?.id === options.summaryAnchorMessageId
  ) {
    items.push({
      kind: 'badge',
      key: `summary:${options.summaryAnchorMessageId}`,
      badge: 'summary',
      label: '已整理为摘要'
    })
  }
  return items
}

/**
 * @description 从旧格式失败消息的正文提取错误信息。
 * @param content 失败消息的落盘正文。
 * @returns 前缀后的错误文本；正文不带固定前缀（半截回复或空）时返回空串。
 * @remarks 旧数据把错误信息写在消息正文里，新数据的错误信息存于 errorMessage 字段，正文不携带错误文案。
 */
function legacyFailureText(content: string): string {
  const prefix = '回复生成失败：'
  const trimmed = content.trim()
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length).trim() : ''
}
