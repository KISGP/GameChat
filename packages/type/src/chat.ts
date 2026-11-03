import type { CharacterSettings } from './settings'

export type CharacterSummary = {
  id: string
  name: string
  description?: string
  avatar: string
  cardBg?: string
  /** 角色活动立绘的媒体协议地址。 */
  pixActivity: string
  /** 角色立牌图标的媒体协议地址。 */
  rolePile: string
}

export type CharacterSource = 'preset' | 'custom'

export type CharacterSyncStatus = {
  updateAvailable?: boolean
  syncState?: 'queued' | 'downloading'
  remoteUnavailable: boolean
  syncError?: string
}

export type CharacterDownloadProgress = {
  characterId: string
  receivedBytes: number
  totalBytes: number | null
}

export type LocalCharacterEntry = CharacterSummary & {
  source: CharacterSource
  visible: boolean
  settings: CharacterSettings
  /** 角色信息（info.json `tts.fish`）携带的 Fish Audio 仓库预设音色 ID；未提供时缺省。 */
  ttsFishPreset?: string
  /** 角色情报/介绍文本（当前语言的展示串）；来自 info.json，未提供时缺省。 */
  information?: string
  syncStatus?: CharacterSyncStatus
}

export type RemoteCharacterEntry = {
  id: string
  name: string
  description?: string
  /** 角色情报/介绍文本（当前语言的展示串）；来自索引 information 字段，缺失时缺省。 */
  information?: string
  avatar?: string
  cardBg?: string
  pixActivity?: string
  rolePile?: string
  updateAt?: string | null
  syncState?: 'queued' | 'downloading' | 'failed'
  syncError?: string
}

export type CharacterRegistry = {
  local: LocalCharacterEntry[]
  remote: RemoteCharacterEntry[]
  refreshedAt: string | null
  isSyncing: boolean
  syncError?: string
}

export type CharacterPromptDocument = {
  characterId: string
  prompt: string
}

export type MessageRole = 'user' | 'assistant'

export type MessageStatus = 'pending' | 'streaming' | 'complete' | 'error' | 'aborted'

export type SessionStatus = 'idle' | 'running' | 'error'

export type ConversationMessage = {
  id: string
  role: MessageRole
  senderId: string
  content: string
  emoticonId?: string
  emoticonDescription?: string
  attachments?: ChatImageAttachment[]
  status: MessageStatus
  /** 产生该消息的运行所用模型条目标识；渲染层据此派生「改用模型」提示。 */
  modelId?: string
  /** 回合失败的错误信息（含状态码等供应商报错文本）；仅供失败徽章展示，不进入模型上下文。 */
  errorMessage?: string
  createdAt: string
}

export type ChatImageAttachment = {
  resourceId: string
  fileName: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  sizeBytes: number
  analysis: string
}

export type ChatImageInput = ChatImageAttachment & {
  dataUrl: string
}

export type ChatGroup = {
  id: string
  participantIds: string[]
  // 侧栏置顶标记；缺省视为未置顶。
  pinned?: boolean
  createdAt: string
  updatedAt: string
}

/**
 * @description 聊天目标：以存储寻址的所有者 ID 定位会话。
 * @remarks 单角色会话的 owner 即唯一成员角色 ID；群聊会话的 owner 是由固定成员生成的群标识。
 */
export type ChatTarget = {
  ownerId: string
}

/** 最近一次最终角色回复调用的实际上下文占用统计。 */
export type ContextUsage =
  | {
      status: 'available'
      /** 产生该次统计的模型条目标识。 */
      modelId: string
      /** 记录时该模型的上下文窗口容量快照；模型未配置窗口容量时缺省。 */
      contextWindow?: number
      /** 记录时生效的输入上下文预算（窗口 × 全局预算比例）；窗口容量未配置时缺省。 */
      budgetTokens?: number
      /** 统计写入时间（ISO 8601）。 */
      recordedAt: string
      /** 供应商返回的实际输入 token 数。 */
      inputTokens: number
      /**
       * 供应商返回的命中缓存的输入 token 数；供应商上报缓存细分时必有。
       * @remarks chat-completions 格式的 inputTokens 已包含命中部分，命中率即 cacheReadTokens / inputTokens；
       *   anthropic 格式在未显式启用缓存断点时不会出现该字段。
       */
      cacheReadTokens?: number
    }
  | {
      status: 'unavailable'
      /** 产生该次统计的模型条目标识。 */
      modelId: string
      /** 统计写入时间（ISO 8601）。 */
      recordedAt: string
      /** 记录时生效的输入上下文预算（窗口 × 全局预算比例），与 available 分支同口径。 */
      budgetTokens?: number
      /** 供应商未返回用量时按本地估算器得出的终答输入 token 估算值（校准后）。 */
      estimatedTokens?: number
    }

export type ConversationSession = {
  id: string
  /** 存储寻址所有者：单角色为角色 ID，群聊为由固定成员生成的群标识；磁盘布局 chats/<ownerId>/<sessionId>/。 */
  ownerId: string
  /** 固定参与成员角色 ID；是否群聊由 participants.length > 1 派生。 */
  participants: string[]
  // 用户自定义会话标题；缺省或空时按最后一条消息预览展示。
  title?: string
  messages: ConversationMessage[]
  status: SessionStatus
  /** 最近一次最终角色回复调用的上下文统计；尚无成功的最终回复时缺省。 */
  contextUsage?: ContextUsage
  /** 滚动摘要：覆盖锚点消息及其之前的全部历史；尚无压缩记录时缺省。 */
  summary?: SessionSummary
  createdAt: string
  updatedAt: string
}

/** 会话滚动摘要：锚点消息标记摘要与原文窗口的分界。 */
export type SessionSummary = {
  /** 摘要正文；覆盖锚点消息及其之前的全部历史。 */
  text: string
  /** 摘要覆盖区间的最后一条消息 ID。 */
  anchorMessageId: string
  /** 摘要写入时间（ISO 8601）。 */
  recordedAt: string
}

/**
 * @description 会话列表摘要：侧栏与跨进程列表链路驻留的轻量会话视图，不含消息数组。
 * @remarks status 在主进程读取时按运行活性派生；lastMessagePreview 为最后一条消息的文本内容，
 *   纯表情消息为空串，由展示层回退默认文案。
 */
export type ConversationSessionSummary = {
  id: string
  /** 存储寻址所有者：单角色为角色 ID，群聊为由固定成员生成的群标识。 */
  ownerId: string
  /** 固定参与成员角色 ID；是否群聊由 participants.length > 1 派生。 */
  participants: string[]
  title?: string
  status: SessionStatus
  /** 最后一条消息的文本内容；会话无消息时为空串。 */
  lastMessagePreview: string
  /** 会话当前消息总数。 */
  messageCount: number
  createdAt: string
  updatedAt: string
}

/** 角色在单个会话中的状态卡视图：设置页角色卡内的只读展示。 */
export type CharacterSessionStateCardView = {
  sessionId: string
  /** 会话展示文案；与聊天会话列表同口径，恒为非空串。 */
  sessionTitle: string
  /** 状态卡 Markdown 全文；尚无内容时为空串。 */
  content: string
  /** 最近写入时间（ISO 8601）；尚无文件时为 null。 */
  updatedAt: string | null
}

export type ChatAppendMessageRequest = {
  holdId: string
  requestId: string
  sessionId?: string | null
  target: ChatTarget
  /** 本批消息使用的模型条目标识；合并发送窗口内以首条消息的选择为准。 */
  modelId: string
  segment: ChatUserSegment
}

export type ChatUserSegment =
  | { type: 'text'; text: string; images?: ChatImageInput[] }
  | { type: 'emoticon'; emoticonId: string }

export type ChatAppendMessageResult = {
  requestId: string
  sessionId: string
  messageId: string
  /** 追加完成后的会话全量快照，供渲染层换入活动会话缓存。 */
  session: ConversationSession
  /** 追加完成后的会话摘要，供渲染层合并侧栏列表项。 */
  summary: ConversationSessionSummary
}

export type ChatTriggerRunRequest = {
  holdId: string
  requestId: string
  sessionId: string
  target: ChatTarget
  modelId: string
}

export type ChatCreateGroupRequest = {
  participantIds: string[]
}

export type ChatRunAccepted = {
  requestId: string
  sessionId: string
  messageId: string
}

export type ChatRetryMessageRequest = {
  requestId: string
  sessionId: string
  /** 要重试的失败或中断 assistant 消息 ID；必须是会话当前最后一条消息。 */
  messageId: string
  modelId: string
}

export type ChatRemoveFailedTurnRequest = {
  requestId: string
  sessionId: string
  /** 要移除的失败或中断 assistant 消息 ID；其前连续的用户消息一并移除。 */
  assistantMessageId: string
}

export type ChatRemoveFailedTurnResult = {
  requestId: string
  sessionId: string
  /** 移除完成后的会话全量快照，供渲染层换入活动会话缓存。 */
  session: ConversationSession
  /** 移除完成后的会话摘要，供渲染层合并侧栏列表项。 */
  summary: ConversationSessionSummary
}

export type ChatCompressSessionRequest = {
  sessionId: string
}

export type ChatCompressSessionResult = {
  sessionId: string
  /** compressed 表示已生成新摘要；nothing-to-compress 表示没有可整理的历史区间。 */
  outcome: 'compressed' | 'nothing-to-compress'
}

export type ChatExportSessionRequest = {
  sessionId: string
}

export type ChatExportSessionResult =
  | {
      /** 用户在保存对话框中取消了导出。 */
      canceled: true
    }
  | {
      canceled: false
      /** 导出文件的实际落盘路径。 */
      filePath: string
      /** 导出的消息总数。 */
      messageCount: number
    }

export type ChatDeleteSessionRequest = {
  sessionId: string
}

export type ChatDeleteSessionResult = {
  sessionId: string
}

export type ChatDeleteGroupRequest = {
  groupId: string
}

export type ChatDeleteGroupResult = {
  groupId: string
}

export type ChatRenameSessionRequest = {
  sessionId: string
  /** 新的自定义标题；空串表示清除自定义标题、回退到消息预览展示。 */
  title: string
}

export type ChatRenameSessionResult = {
  session: ConversationSession
  /** 改名后的会话摘要，供渲染层合并侧栏列表项。 */
  summary: ConversationSessionSummary
}

export type ChatSetGroupPinnedRequest = {
  groupId: string
  pinned: boolean
}

export type ChatRunStartedEvent = {
  type: 'run-started'
  requestId: string
  session: ConversationSession
  /** 该会话对应的列表摘要，供渲染层合并侧栏列表项。 */
  summary: ConversationSessionSummary
  messageId: string
}

export type ChatRunCharacterStreamEvent = {
  type: 'character-stream'
  requestId: string
  sessionId: string
  messageId: string
  /** 本条增量携带的原始文本。 */
  text: string
}

export type ChatRunSessionSyncedEvent = {
  type: 'session-synced'
  requestId: string
  session: ConversationSession
  /** 该会话对应的列表摘要，供渲染层合并侧栏列表项。 */
  summary: ConversationSessionSummary
}

/**
 * @description 会话删除广播：主进程删除会话成功后通知渲染层移除本地会话列表项。
 * @remarks 删除不属于任何聊天运行，因此不携带 requestId。
 */
export type ChatRunSessionRemovedEvent = {
  type: 'session-removed'
  sessionId: string
}

export type ChatRunFinishedEvent = {
  type: 'run-finished'
  requestId: string
  sessionId: string
  messageId: string
}

export type ChatRunErrorEvent = {
  type: 'run-error'
  requestId: string
  sessionId: string
  messageId: string
  error: string
}

export type ChatRunAbortedEvent = {
  type: 'run-aborted'
  requestId: string
  sessionId: string
  messageId: string
}

export type ChatRunCharacterStateEvent = {
  type: 'character-state'
  requestId: string
  sessionId: string
  characterId: string
  state: 'evaluating' | 'replying' | 'failed' | 'idle'
}

export type ChatRunEvent =
  | ChatRunStartedEvent
  | ChatRunCharacterStreamEvent
  | ChatRunSessionSyncedEvent
  | ChatRunSessionRemovedEvent
  | ChatRunFinishedEvent
  | ChatRunErrorEvent
  | ChatRunAbortedEvent
  | ChatRunCharacterStateEvent
