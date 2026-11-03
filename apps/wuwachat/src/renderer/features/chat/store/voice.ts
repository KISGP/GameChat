import type { ChatRunEvent, ConversationMessage, ConversationSession } from '@gamechat/type'
import { create } from 'zustand'
import { useAppSettingsStore } from '@renderer/store/app-settings'
import { useSessionStore } from '@renderer/store/session'
import { synthesize } from '@renderer/services/tts'
import { getTtsErrorMessage, trackAutoTtsFailure } from '../lib/tts-error'

/**
 * @description 自动语音输出的单条消息合成状态。
 */
export type VoiceMessageStatus = 'queued' | 'synthesizing' | 'ready' | 'error'

/**
 * @description 一条消息的自动语音输出状态记录。
 */
export type VoiceMessageEntry = {
  // 当前合成状态；queued 与 synthesizing 阶段界面一律显示三点动画占位。
  status: VoiceMessageStatus
  // 合成成功后的可播放音频地址；其余状态为 null。
  audioUrl: string | null
  // 合成失败原因，可直接展示；仅在 status 为 error 时有值。
  error: string | null
}

/**
 * @description 聊天自动语音输出的渲染层状态与入口动作。
 */
type VoiceOutputStore = {
  // 以 assistant 消息 ID 键控的语音输出状态表。
  entries: Record<string, VoiceMessageEntry>
  // 以 assistant 消息 ID 键控的「转文字」方框展开状态。
  textVisibleIds: Record<string, boolean>
  /**
   * @description 消费聊天运行事件，把本轮新回复渐进纳入语音输出。
   * @param event 主进程发送的聊天运行事件。
   * @returns 无返回值。
   * @remarks run-started 记录本轮输入标记；运行存续期间每次 session-synced 把标记之后
   *   已提交的 assistant 消息即时入队，使合成与后续回合的生成重叠；run-finished 依会话存储
   *   再兜底扫描一次，run-error 与 run-aborted 清除标记；入队判定幂等，已纳入的消息自动跳过；
   *   失败消息不自动重试，由用户手动重试。
   */
  handleRunEvent: (event: ChatRunEvent) => void
  /**
   * @description 重新排队一条合成失败消息的语音合成。
   * @param message 待重试的角色消息。
   * @returns 无返回值。
   */
  retrySynthesis: (message: ConversationMessage) => void
  /**
   * @description 切换指定消息「转文字」方框的展开状态。
   * @param messageId 目标 assistant 消息 ID。
   * @returns 无返回值。
   */
  toggleTextVisible: (messageId: string) => void
}

/** 等待串行合成的消息队列；主进程同一时刻只允许一个合成任务，渲染层在此排队。 */
const pendingMessages: ConversationMessage[] = []
/** 队列排水循环是否正在运行。 */
let isDraining = false

/**
 * @description 以 requestId 键控的进行中运行输入标记，值为本轮输入的最后一个用户消息 ID。
 * @remarks 渐进合成以标记为边界扫描其后提交的 assistant 消息，运行到达终态时清除对应标记。
 */
const activeRunMarkers = new Map<string, string>()

/**
 * @description 判定语音输出是否处于生效状态。
 * @returns TTS 总开关与自动语音输出开关同时开启时返回 true。
 */
function isVoiceOutputActive(): boolean {
  const { enabled, autoSpeak } = useAppSettingsStore.getState().settings.tts
  return enabled && autoSpeak
}

/**
 * @description 把一条消息写入语音状态表并进入串行合成队列。
 * @param message 待合成的角色消息。
 */
function enqueueVoiceSynthesis(message: ConversationMessage): void {
  useVoiceOutputStore.setState((current) => ({
    entries: {
      ...current.entries,
      [message.id]: { status: 'queued', audioUrl: null, error: null }
    }
  }))
  pendingMessages.push(message)
  void drainVoiceQueue()
}

/**
 * @description 依次消费合成队列，逐条调用主进程合成并回写状态。
 * @remarks 主进程同一时刻只接受一个合成任务，本循环保证渲染层请求严格串行；
 *   单条失败记为 error 态并继续后续消息，不中断队列。
 */
async function drainVoiceQueue(): Promise<void> {
  if (isDraining) {
    return
  }
  isDraining = true
  try {
    while (pendingMessages.length > 0) {
      const message = pendingMessages.shift()
      if (!message) {
        continue
      }
      useVoiceOutputStore.setState((current) => ({
        entries: {
          ...current.entries,
          [message.id]: { status: 'synthesizing', audioUrl: null, error: null }
        }
      }))
      try {
        const result = await synthesize({
          requestId: globalThis.crypto.randomUUID(),
          messageId: message.id,
          characterId: message.senderId,
          text: message.content
        })
        useVoiceOutputStore.setState((current) => ({
          entries: {
            ...current.entries,
            [message.id]: { status: 'ready', audioUrl: result.audioUrl, error: null }
          }
        }))
      } catch (error) {
        trackAutoTtsFailure(message.id, error)
        useVoiceOutputStore.setState((current) => ({
          entries: {
            ...current.entries,
            [message.id]: { status: 'error', audioUrl: null, error: getTtsErrorMessage(error) }
          }
        }))
      }
    }
  } finally {
    isDraining = false
  }
}

/**
 * @description 遍历输入标记之后的连续 assistant 消息，把可合成的未入队消息加入串行语音队列。
 * @param session 当前会话快照。
 * @param markerMessageId 本轮输入的最后一个用户消息 ID。
 * @remarks 已有语音条目、状态非 complete 或内容为空的消息跳过；扫描幂等，可被多个事件重复触发。
 */
function enqueueCommittedAssistantMessages(
  session: ConversationSession,
  markerMessageId: string
): void {
  const markerIndex = session.messages.findIndex((item) => item.id === markerMessageId)
  if (markerIndex < 0) {
    return
  }
  for (const message of session.messages.slice(markerIndex + 1)) {
    if (message.role !== 'assistant') {
      break
    }
    const existing = useVoiceOutputStore.getState().entries[message.id]
    if (existing || message.status !== 'complete' || !message.content.trim()) {
      continue
    }
    enqueueVoiceSynthesis(message)
  }
}

export const useVoiceOutputStore = create<VoiceOutputStore>((set) => ({
  entries: {},
  textVisibleIds: {},
  handleRunEvent: (event) => {
    if (event.type === 'run-started') {
      if (isVoiceOutputActive()) {
        activeRunMarkers.set(event.requestId, event.messageId)
      }
      return
    }
    if (event.type === 'session-synced') {
      const markerMessageId = activeRunMarkers.get(event.requestId)
      if (markerMessageId) {
        enqueueCommittedAssistantMessages(event.session, markerMessageId)
      }
      return
    }
    if (event.type === 'run-finished') {
      activeRunMarkers.delete(event.requestId)
      if (!isVoiceOutputActive()) {
        return
      }
      // 语音跟随当前可见会话：仅当结束的运行正是活动会话时，用其最新全量快照补队尾回复。
      const state = useSessionStore.getState()
      const session = state.activeSession?.id === event.sessionId ? state.activeSession : null
      if (session) {
        enqueueCommittedAssistantMessages(session, event.messageId)
      }
      return
    }
    if (event.type === 'run-error' || event.type === 'run-aborted') {
      activeRunMarkers.delete(event.requestId)
    }
  },
  retrySynthesis: (message) => {
    if (!message.content.trim()) {
      return
    }
    enqueueVoiceSynthesis(message)
  },
  toggleTextVisible: (messageId) => {
    set((current) => ({
      textVisibleIds: { ...current.textVisibleIds, [messageId]: !current.textVisibleIds[messageId] }
    }))
  }
}))
