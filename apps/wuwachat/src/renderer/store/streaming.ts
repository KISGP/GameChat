import { ConversationSession } from '@gamechat/type'
import { create } from 'zustand'

/** 单条流式回复的累计状态。 */
type StreamingEntry = {
  /** 所属会话 ID。 */
  sessionId: string
  /** 所属运行请求 ID，用于终态事件整批清理。 */
  requestId: string
  /** 已累计的原始回复文本。 */
  text: string
}

type StreamingStore = {
  /** 以 assistant 占位消息 ID 键控的流式累计表。 */
  streams: Record<string, StreamingEntry>
  appendChunk: (payload: {
    requestId: string
    sessionId: string
    messageId: string
    text: string
  }) => void
  pruneForSession: (session: ConversationSession) => void
  clearForRequest: (requestId: string) => void
}

/** 帧级合并缓冲：以 assistant 占位消息 ID 键控，token 先入缓冲，统一在下一渲染帧提交。 */
const pendingChunks = new Map<string, { sessionId: string; requestId: string; text: string }>()
let pendingFrameId: number | null = null

/**
 * @description 在下一渲染帧把缓冲的文本增量批量写入 Store。
 * @remarks 渲染进程按帧合并 token，避免每个 token 触发一次组件订阅更新。
 */
function flushPendingChunks(): void {
  pendingFrameId = null
  if (pendingChunks.size === 0) {
    return
  }
  const committed = [...pendingChunks.entries()]
  pendingChunks.clear()
  useStreamingStore.setState((current) => {
    const streams = { ...current.streams }
    for (const [messageId, buffered] of committed) {
      const existing = streams[messageId]
      streams[messageId] = {
        sessionId: buffered.sessionId,
        requestId: buffered.requestId,
        text: (existing?.text ?? '') + buffered.text
      }
    }
    return { streams }
  })
}

/**
 * @description 调度一次帧级合并；已有待处理帧时跳过。
 */
function scheduleFlush(): void {
  if (pendingFrameId !== null) {
    return
  }
  pendingFrameId = requestAnimationFrame(() => {
    flushPendingChunks()
  })
}

/**
 * @description 丢弃指定消息的缓冲增量，避免清屏后残留文本再被提交。
 * @param messageId 目标 assistant 消息 ID。
 */
function dropPendingChunksForMessage(messageId: string): void {
  pendingChunks.delete(messageId)
}

export const useStreamingStore = create<StreamingStore>((set) => ({
  streams: {},
  /**
   * @description 追加一条流式文本增量，按帧合并后写入累计表。
   * @param payload 增量所属的运行、会话与 assistant 占位消息 ID 及文本。
   * @returns 无返回值。
   */
  appendChunk: (payload) => {
    const buffered = pendingChunks.get(payload.messageId)
    if (buffered) {
      buffered.text += payload.text
    } else {
      pendingChunks.set(payload.messageId, {
        sessionId: payload.sessionId,
        requestId: payload.requestId,
        text: payload.text
      })
    }
    scheduleFlush()
  },
  /**
   * @description 按会话快照清理已落定的流式条目。
   * @param session 最新的会话快照。
   * @returns 无返回值。
   * @remarks 快照中对应消息已脱离 pending/streaming 状态时移除累计文本；其他会话的条目不受影响。
   */
  pruneForSession: (session) => {
    set((current) => {
      let changed = false
      const streams: Record<string, StreamingEntry> = {}
      for (const [messageId, entry] of Object.entries(current.streams)) {
        if (entry.sessionId !== session.id) {
          streams[messageId] = entry
          continue
        }
        const message = session.messages.find((item) => item.id === messageId)
        if (message && (message.status === 'pending' || message.status === 'streaming')) {
          streams[messageId] = entry
        } else {
          changed = true
          dropPendingChunksForMessage(messageId)
        }
      }
      return changed ? { streams } : current
    })
  },
  /**
   * @description 按运行请求清理全部流式条目。
   * @param requestId 运行请求 ID。
   * @returns 无返回值。
   * @remarks 运行终态到达时调用，兜底清理未被会话快照覆盖的残留条目。
   */
  clearForRequest: (requestId) => {
    set((current) => {
      let changed = false
      const streams: Record<string, StreamingEntry> = {}
      for (const [messageId, entry] of Object.entries(current.streams)) {
        if (entry.requestId === requestId) {
          changed = true
          dropPendingChunksForMessage(messageId)
        } else {
          streams[messageId] = entry
        }
      }
      return changed ? { streams } : current
    })
  }
}))
