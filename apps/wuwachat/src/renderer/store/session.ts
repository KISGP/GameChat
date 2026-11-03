import { ChatGroup, ChatRunEvent, ConversationSession, ConversationSessionSummary } from '@gamechat/type'
import { create } from 'zustand'
import { getSessionDetail } from '@renderer/services/ai'
import { trackError } from '@renderer/app/telemetry'

type SessionStore = {
  /** 全部会话的侧栏摘要列表，按更新时间倒序。 */
  summaries: ConversationSessionSummary[]
  /** 当前激活会话的全量快照缓存；与 currentSessionId 不对应时视为无效。 */
  activeSession: ConversationSession | null
  groups: ChatGroup[]
  currentSessionId: ConversationSession['id'] | null
  currentGroupId: ChatGroup['id'] | null
  setSummaries: (summaries: ConversationSessionSummary[]) => void
  setGroups: (groups: ChatGroup[]) => void
  upsertGroup: (group: ChatGroup) => void
  applySessionUpdate: (session: ConversationSession, summary: ConversationSessionSummary) => void
  setCurrentSessionId: (sessionId: ConversationSession['id'] | null) => void
  activateSession: (sessionId: ConversationSession['id'] | null) => void
  setCurrentGroupId: (groupId: ChatGroup['id'] | null) => void
  startNewSession: () => void
  removeSession: (sessionId: ConversationSession['id']) => void
  removeGroup: (groupId: ChatGroup['id']) => void
  mergeRunEventSession: (event: ChatRunEvent) => void
}

/**
 * @description 将新的会话摘要合并到现有列表，并按更新时间倒序排列。
 * @param summaries 当前会话摘要列表。
 * @param nextSummary 待合并的会话摘要。
 * @returns 合并并排序后的会话摘要列表。
 */
function mergeSummary(
  summaries: ConversationSessionSummary[],
  nextSummary: ConversationSessionSummary
): ConversationSessionSummary[] {
  const merged = [nextSummary, ...summaries.filter((summary) => summary.id !== nextSummary.id)]
  return merged.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  summaries: [],
  activeSession: null,
  groups: [],
  currentSessionId: null,
  currentGroupId: null,
  /**
   * @description 替换当前会话摘要列表。
   * @param summaries 要写入的主进程会话摘要列表。
   * @returns 无返回值。
   */
  setSummaries: (summaries) => set({ summaries }),
  /**
   * @description 替换当前独立群聊注册表。
   * @param groups 要写入的群聊定义列表。
   * @returns 无返回值。
   */
  setGroups: (groups) => set({ groups }),
  /**
   * @description 将单个群聊定义合并进注册表。
   * @param group 需要写入或更新的群聊定义。
   * @returns 无返回值。
   */
  upsertGroup: (group) =>
    set((current) => ({
      groups: [group, ...current.groups.filter((item) => item.id !== group.id)]
    })),
  /**
   * @description 合并一次会话全量快照与其摘要。
   * @param session 主进程返回的会话全量快照。
   * @param summary 同一来源的会话摘要。
   * @returns 无返回值。
   * @remarks 全量快照仅在该会话正是当前激活会话时换入活动缓存，其余会话只更新侧栏摘要，
   *   渲染层不驻留非激活会话的消息数据。
   */
  applySessionUpdate: (session, summary) => {
    set((current) => ({
      summaries: mergeSummary(current.summaries, summary),
      ...(current.currentSessionId === session.id ? { activeSession: session } : {})
    }))
  },
  /**
   * @description 设置当前显示的会话标识。
   * @param sessionId 要选中的会话标识；传入 null 时取消选择。
   * @returns 无返回值。
   * @remarks 仅更新选择状态，不拉取全量快照；全量数据由调用方经 applySessionUpdate
   *   或 activateSession 换入，全量与选择不对应时界面视为未加载。
   */
  setCurrentSessionId: (sessionId) =>
    set((current) => ({
      currentSessionId: sessionId,
      ...(current.currentSessionId !== sessionId ? { activeSession: null } : {})
    })),
  /**
   * @description 激活指定会话并换入其全量快照。
   * @param sessionId 要激活的会话标识；传入 null 时仅取消选择。
   * @returns 无返回值。
   * @remarks 重复激活同一会话且全量已在缓存时直接跳过；拉取结果以 currentSessionId
   *   守卫，用户中途切换后迟到的响应会被丢弃。
   */
  activateSession: (sessionId) => {
    const state = get()
    // 同一选择且全量已就绪（或取消选择）时直接跳过，避免重复拉取。
    if (
      state.currentSessionId === sessionId &&
      (sessionId === null || state.activeSession?.id === sessionId)
    ) {
      return
    }
    set({ currentSessionId: sessionId, activeSession: null })
    if (!sessionId) {
      return
    }
    void getSessionDetail(sessionId)
      .then((session) => {
        if (get().currentSessionId !== sessionId) {
          return
        }
        if (!session) {
          trackError(
            'load-session-detail-missing',
            'Session detail was not found for the activated session',
            new Error(sessionId)
          )
          return
        }
        set({ activeSession: session })
      })
      .catch((error) => {
        if (get().currentSessionId !== sessionId) {
          return
        }
        trackError('load-session-detail-failed', 'Failed to load session detail', error)
      })
  },
  /**
   * @description 设置当前显示的群聊目标。
   * @param groupId 要选中的群聊标识；传入 null 时取消选择。
   * @returns 无返回值。
   */
  setCurrentGroupId: (groupId) => set({ currentGroupId: groupId }),
  /**
   * @description 清除当前会话选择并开始新的会话流程。
   * @returns 无返回值。
   * @remarks 聊天对象（角色或群聊）由调用链经各自 store 保留，本 action 仅负责清除会话选择
   *   与活动会话缓存。
   */
  startNewSession: () => {
    set({ currentSessionId: null, activeSession: null })
  },
  /**
   * @description 从会话摘要列表移除指定会话，并在当前选择指向它时清空选择与活动缓存。
   * @param sessionId 被删除的会话标识。
   * @returns 无返回值。
   */
  removeSession: (sessionId) =>
    set((current) => ({
      summaries: current.summaries.filter((summary) => summary.id !== sessionId),
      currentSessionId: current.currentSessionId === sessionId ? null : current.currentSessionId,
      activeSession: current.activeSession?.id === sessionId ? null : current.activeSession
    })),
  /**
   * @description 从群聊注册表移除指定群聊，并在当前选择指向它时清空当前群聊目标。
   * @param groupId 被删除的群聊标识。
   * @returns 无返回值。
   * @remarks 群下会话列表项由 session-removed 广播逐项移除。
   */
  removeGroup: (groupId) =>
    set((current) => ({
      groups: current.groups.filter((item) => item.id !== groupId),
      currentGroupId: current.currentGroupId === groupId ? null : current.currentGroupId
    })),
  /**
   * @description 根据聊天运行事件同步会话摘要与活动会话缓存。
   * @param event 主进程发送的聊天运行事件。
   * @returns 无返回值。
   * @remarks 仅处理携带全量快照与摘要的 run-started 与 session-synced 事件；全量快照只在
   *   事件会话正是当前激活会话时换入，其余会话仅更新侧栏摘要。
   */
  mergeRunEventSession: (event) => {
    if (event.type !== 'run-started' && event.type !== 'session-synced') {
      return
    }

    set((current) => ({
      summaries: mergeSummary(current.summaries, event.summary),
      ...(current.currentSessionId === event.session.id ? { activeSession: event.session } : {})
    }))
  }
}))

/**
 * @description 创建活动会话快照选择器：仅当缓存全量与当前选择对应时返回会话。
 * @returns 接收 Store 状态并返回活动会话的选择器。
 * @remarks 激活会话的全量拉取是异步的，选择已切换而缓存未就绪期间返回 null，
 *   消费方按未加载状态渲染。
 */
export const selectActiveSession = (state: SessionStore): ConversationSession | null =>
  state.activeSession && state.activeSession.id === state.currentSessionId
    ? state.activeSession
    : null
