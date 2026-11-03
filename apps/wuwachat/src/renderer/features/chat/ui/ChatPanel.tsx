import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { ChatImageInput, ChatRunEvent, ChatTarget, ChatUserSegment, ConversationMessage } from '@gamechat/type'
import { trackError, trackUiEvent } from '@renderer/app/telemetry'
import { useCharacterRegistryStore } from '@renderer/store/character-registry'
import { selectActiveBackground, useAppearanceStore } from '@renderer/features/appearance'
import { selectActiveSession, useSessionStore } from '@renderer/store/session'
import { findProviderModel, useProvidersStore } from '@renderer/store/providers'
import { useModelSelectionStore } from '../store/model-selection'
import { useAppSettingsStore } from '@renderer/store/app-settings'
import { getIpcErrorMessage } from '@renderer/common/lib/error-message'
import { toast } from 'sonner'
import { getVoiceOutputBlockReason } from '../lib/voice-readiness'
import ChatPanelView from './ChatPanelView'
import type { ChatCommandId } from './ChatComposer'
import {
  abortRun,
  compressSession,
  exportSession,
  onRunEvent,
  appendMessage,
  removeFailedTurn,
  retryMessage,
  triggerRun as triggerRunService
} from '@renderer/services/ai'

/**
 * @description 找出可重试的回复消息 ID：会话最后一条 assistant 消息处于失败或中断状态时提供重试。
 * @param messages 当前会话消息列表。
 * @returns 可重试的 assistant 消息 ID；没有可重试目标时返回 null。
 */
function getRetryableMessageId(messages: ConversationMessage[]): string | null {
  const lastMessage = messages[messages.length - 1]
  if (
    !lastMessage ||
    lastMessage.role !== 'assistant' ||
    (lastMessage.status !== 'error' && lastMessage.status !== 'aborted')
  ) {
    return null
  }
  return lastMessage.id
}

export default function ChatPanel(): ReactElement {
  const activateChar = useCharacterRegistryStore((state) => state.activateChar)
  const localCharacters = useCharacterRegistryStore((state) => state.registry.local)
  const activeBackground = useAppearanceStore(selectActiveBackground)
  const providersStore = useProvidersStore((state) => state.store)
  const selectedModelId = useModelSelectionStore((state) => state.selectedModelId)
  const selectedModel = findProviderModel(providersStore, selectedModelId)
  const currentModelId = selectedModel?.model.id ?? null
  const chatSendMerge = useAppSettingsStore((state) => state.settings.chatSendMerge)
  const currentGroupId = useSessionStore((state) => state.currentGroupId)
  const groups = useSessionStore((state) => state.groups)
  const setCurrentSessionId = useSessionStore((state) => state.setCurrentSessionId)
  const [isLoading, setIsLoading] = useState(false)
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null)
  /** 正在编辑的失败轮次：重新发送时先移除该轮再走正常发送，取消或切换会话则保留失败记录。 */
  const [editingFailure, setEditingFailure] = useState<{
    sessionId: string
    assistantMessageId: string
  } | null>(null)
  /** 注入输入框的回填草稿；每次注入都换新对象以触发输入框更新。 */
  const [draftInjection, setDraftInjection] = useState<{ text: string } | null>(null)
  const holdRef = useRef<{
    holdId: string
    sessionId: string | null
    target: ChatTarget
    modelId: string
    firstAppendAt: number
    timer: ReturnType<typeof setTimeout> | null
  } | null>(null)
  const lastTypingAtRef = useRef(0)

  const currentSession = useSessionStore(selectActiveSession)
  const currentSessionId = currentSession?.id ?? null
  const currentGroup = groups.find((group) => group.id === currentGroupId) || null
  const target: ChatTarget | null = currentGroup
    ? { ownerId: currentGroup.id }
    : activateChar
      ? { ownerId: activateChar.id }
      : null
  const isCurrentSessionForTarget = Boolean(
    currentSession && target && currentSession.ownerId === target.ownerId
  )
  const messages = isCurrentSessionForTarget ? currentSession?.messages || [] : []
  const participantIds = currentGroup?.participantIds || (activateChar ? [activateChar.id] : [])
  const participants = participantIds
    .filter((id): id is string => Boolean(id))
    .map((id) => localCharacters.find((character) => character.id === id))
    .filter((character): character is (typeof localCharacters)[number] => Boolean(character))
  const retryableMessageId = getRetryableMessageId(messages)
  const effectiveIsLoading = isLoading
  const [characterStates, setCharacterStates] = useState<
    Map<string, Extract<ChatRunEvent, { type: 'character-state' }>['state']>
  >(new Map())
  const groupStatusText = [...characterStates.entries()]
    .filter(([, state]) => state === 'evaluating' || state === 'replying')
    .map(([characterId, state]) => {
      const character = participants.find((participant) => participant.id === characterId)
      if (!character) return null
      return `${character.name}${state === 'evaluating' ? '正在判断是否回应…' : '正在回复…'}`
    })
    .filter((text): text is string => Boolean(text))
    .join(' ')

  const clearPendingRequest = useCallback((): void => {
    setPendingRequestId(null)
  }, [])

  useEffect(() => {
    const unsubscribe = onRunEvent((event: ChatRunEvent) => {
      // 不属于任何运行的事件（如删除广播）没有 requestId，永远不匹配当前 pending 请求。
      if (!('requestId' in event) || pendingRequestId !== event.requestId) {
        return
      }

      if (event.type === 'character-state') {
        setCharacterStates((current) => {
          const next = new Map(current)
          if (event.state === 'idle') {
            next.delete(event.characterId)
          } else {
            next.set(event.characterId, event.state)
          }
          return next
        })
        return
      }

      if (
        event.type === 'run-finished' ||
        event.type === 'run-error' ||
        event.type === 'run-aborted'
      ) {
        clearPendingRequest()
        setIsLoading(false)
        setCharacterStates(new Map())
      }
    })

    return () => {
      unsubscribe()
    }
  }, [clearPendingRequest, pendingRequestId])

  const handleStop = useCallback(() => {
    const requestId = pendingRequestId
    if (!requestId) return

    trackUiEvent('chat-abort-requested', 'User requested to abort the current chat run', {
      requestId,
      sessionId: currentSession?.id,
      target
    })
    void abortRun(requestId)
  }, [activateChar?.id, currentSession?.id, pendingRequestId])

  const triggerRun = useCallback((): void => {
    const hold = holdRef.current
    if (!hold || !hold.sessionId) return
    // 合并窗口内用户可能已切换会话：活动缓存与 hold 对应时才做本地空轮校验，
    // 不对应时跳过本地计数直接触发，由主进程校验等待窗口。
    const session = useSessionStore.getState().activeSession
    let count = 0
    if (session && session.id === hold.sessionId) {
      let index = session.messages.length - 1
      while (index >= 0 && session.messages[index].role === 'user') {
        count += 1
        index -= 1
      }
      if (count === 0) {
        holdRef.current = null
        return
      }
    }
    if (hold.timer) {
      clearTimeout(hold.timer)
      hold.timer = null
    }
    const requestId = globalThis.crypto.randomUUID()
    setPendingRequestId(requestId)
    setIsLoading(true)
    setCharacterStates(new Map())
    trackUiEvent('chat-run-triggered', 'Chat hold triggered a model run', {
      requestId,
      holdId: hold.holdId,
      sessionId: hold.sessionId,
      target: hold.target,
      messageCount: count
    })
    void triggerRunService({
      holdId: hold.holdId,
      requestId,
      sessionId: hold.sessionId,
      target: hold.target,
      modelId: hold.modelId
    })
      .catch((error) => {
        trackError('trigger-run-failed', getIpcErrorMessage(error), error)
        toast.error(getIpcErrorMessage(error))
        clearPendingRequest()
        setIsLoading(false)
      })
      .finally(() => {
        holdRef.current = null
      })
  }, [clearPendingRequest, setCharacterStates])

  const scheduleHold = useCallback((): void => {
    const hold = holdRef.current
    if (!hold) return
    if (hold.timer) clearTimeout(hold.timer)
    const configured = chatSendMerge.enabled ? chatSendMerge.delaySeconds * 1000 : 0
    const remaining = Math.max(0, hold.firstAppendAt + 30000 - Date.now())
    const delay = Math.min(configured, remaining)
    hold.timer = setTimeout(triggerRun, delay)
    if (delay === 0) triggerRun()
  }, [chatSendMerge.delaySeconds, chatSendMerge.enabled, triggerRun])

  const handleTypingActivity = useCallback((): void => {
    const hold = holdRef.current
    if (!hold) return
    const now = Date.now()
    if (now - lastTypingAtRef.current < 500) return
    lastTypingAtRef.current = now
    scheduleHold()
  }, [scheduleHold])
  const triggerRunRef = useRef(triggerRun)
  useEffect(() => {
    triggerRunRef.current = triggerRun
  }, [triggerRun])

  const appendSegment = useCallback(
    async (segment: ChatUserSegment): Promise<void> => {
      if (!target || !currentModelId) return
      let hold = holdRef.current
      const isSameTarget = Boolean(hold && hold.target.ownerId === target.ownerId)
      if (!isSameTarget) {
        // 模型引用在批内首条消息时冻结：合并发送窗口内的选择器切换作用于下一批。
        hold = {
          holdId: globalThis.crypto.randomUUID(),
          sessionId: currentSessionId,
          target,
          modelId: currentModelId,
          firstAppendAt: Date.now(),
          timer: null
        }
        holdRef.current = hold
      }
      if (!hold) return
      const requestId = globalThis.crypto.randomUUID()
      trackUiEvent('chat-send', 'User sent a chat message', {
        requestId,
        holdId: hold.holdId,
        sessionId: hold.sessionId,
        target: hold.target,
        modelId: hold.modelId,
        messageLength: segment.type === 'text' ? segment.text.length : 0
      })
      const result = await appendMessage({
        holdId: hold.holdId,
        requestId,
        sessionId: hold.sessionId,
        target: hold.target,
        modelId: hold.modelId,
        segment
      })
      const currentHold = holdRef.current
      if (!currentHold || currentHold.holdId !== hold.holdId) return
      currentHold.sessionId = result.sessionId
      // 先落选择再合并快照：合并动作只在快照正是当前选择时换入活动缓存。
      setCurrentSessionId(result.sessionId)
      useSessionStore.getState().applySessionUpdate(result.session, result.summary)
    },
    [currentModelId, currentSessionId, setCurrentSessionId, target]
  )

  const handleSendMessage = useCallback(
    async (text: string, images: ChatImageInput[] = []): Promise<void> => {
      // 编辑失败轮次时先清场：移除失败气泡与其输入用户消息后，本轮发送才不会留下重复记录；
      // 清场失败（如会话正在运行）则中止本次发送，草稿与编辑态原样保留。
      if (editingFailure?.sessionId === currentSessionId) {
        try {
          const result = await removeFailedTurn({
            requestId: globalThis.crypto.randomUUID(),
            sessionId: editingFailure.sessionId,
            assistantMessageId: editingFailure.assistantMessageId
          })
          setCurrentSessionId(result.sessionId)
          useSessionStore.getState().applySessionUpdate(result.session, result.summary)
          setEditingFailure(null)
        } catch (error) {
          trackError('remove-failed-turn-failed', getIpcErrorMessage(error), error)
          toast.error(getIpcErrorMessage(error))
          return
        }
      }
      try {
        await appendSegment({ type: 'text', text, ...(images.length ? { images } : {}) })
      } catch (error) {
        trackError('append-message-failed', getIpcErrorMessage(error), error)
        toast.error(getIpcErrorMessage(error))
        throw error
      }
      if (!chatSendMerge.enabled) triggerRun()
      else scheduleHold()
    },
    [
      appendSegment,
      chatSendMerge.enabled,
      currentSessionId,
      editingFailure,
      scheduleHold,
      triggerRun
    ]
  )

  const handleEmoticonPick = useCallback(
    (emoticonId: string): void => {
      // 表情发送同样会触发模型回复，语音输出开启时与文本发送共用就绪预检。
      void getVoiceOutputBlockReason(participantIds)
        .then((reason) => {
          if (reason) {
            toast.error(reason)
            return
          }
          return appendSegment({ type: 'emoticon', emoticonId }).then(() => {
            if (!chatSendMerge.enabled) triggerRun()
            else scheduleHold()
          })
        })
        .catch((error) => {
          trackError('append-message-failed', getIpcErrorMessage(error), error)
          toast.error(getIpcErrorMessage(error))
        })
    },
    [appendSegment, chatSendMerge.enabled, participantIds, scheduleHold, triggerRun]
  )

  useEffect(
    () => () => {
      triggerRunRef.current()
    },
    []
  )

  const targetKey = target ? `owner:${target.ownerId}` : null
  const previousTargetKeyRef = useRef(targetKey)
  useEffect(() => {
    const previousTargetKey = previousTargetKeyRef.current
    previousTargetKeyRef.current = targetKey
    const hold = holdRef.current
    const holdKey = hold?.target ? `owner:${hold.target.ownerId}` : null
    if (
      hold &&
      previousTargetKey &&
      targetKey !== previousTargetKey &&
      holdKey === previousTargetKey
    ) {
      triggerRun()
    }
  }, [targetKey, triggerRun])

  const handleRetryMessage = useCallback(
    (messageId: string): void => {
      if (!currentSessionId || messageId !== retryableMessageId) {
        return
      }
      if (!currentModelId) {
        toast.error('请先在输入框选择模型后再重试。')
        return
      }

      const requestId = globalThis.crypto.randomUUID()
      setPendingRequestId(requestId)
      setIsLoading(true)
      setCharacterStates(new Map())
      trackUiEvent('chat-retry-triggered', 'User retried a failed chat reply', {
        requestId,
        sessionId: currentSessionId,
        messageId,
        modelId: currentModelId
      })
      void retryMessage({
        requestId,
        sessionId: currentSessionId,
        messageId,
        modelId: currentModelId
      }).catch((error) => {
        trackError('retry-message-failed', getIpcErrorMessage(error), error)
        toast.error(getIpcErrorMessage(error))
        clearPendingRequest()
        setIsLoading(false)
      })
    },
    [clearPendingRequest, currentModelId, currentSessionId, retryableMessageId, setCharacterStates]
  )

  /**
   * @description 进入失败轮次的编辑状态：把该轮用户文本按序回填输入框并展示编辑提示。
   * @param assistantMessageId 失败轮次的 assistant 消息 ID。
   */
  const handleEditMessage = useCallback(
    (assistantMessageId: string): void => {
      const session = useSessionStore.getState().activeSession
      if (!session || session.id !== currentSessionId) {
        return
      }
      const failedIndex = session.messages.findIndex((message) => message.id === assistantMessageId)
      if (failedIndex === -1) {
        return
      }
      const failedMessage = session.messages[failedIndex]
      if (
        failedMessage.role !== 'assistant' ||
        (failedMessage.status !== 'error' && failedMessage.status !== 'aborted')
      ) {
        return
      }
      const turnTexts: string[] = []
      for (let index = failedIndex - 1; index >= 0; index -= 1) {
        const message = session.messages[index]
        if (message.role !== 'user') break
        if (message.content.trim()) turnTexts.unshift(message.content)
      }
      setEditingFailure({ sessionId: session.id, assistantMessageId })
      if (turnTexts.length > 0) {
        setDraftInjection({ text: turnTexts.join('\n') })
      }
      trackUiEvent('chat-edit-started', 'User started editing a failed chat turn', {
        sessionId: session.id,
        assistantMessageId
      })
    },
    [currentSessionId]
  )

  const handleCancelEdit = useCallback((): void => {
    setEditingFailure(null)
  }, [])

  const handleRunCommand = useCallback(
    (command: ChatCommandId): void => {
      if (!currentSessionId) {
        return
      }
      if (command === 'compress') {
        if (effectiveIsLoading) {
          toast.error('会话正在回复中，暂时无法整理历史。')
          return
        }
        trackUiEvent('session-compress-command', 'User ran the compress session command', {
          sessionId: currentSessionId
        })
        void compressSession({ sessionId: currentSessionId })
          .then((result) => {
            toast.success(
              result.outcome === 'compressed' ? '已把较早的历史整理为摘要。' : '没有可整理的历史。'
            )
          })
          .catch((error) => {
            trackError('compress-session-failed', getIpcErrorMessage(error), error)
            toast.error(getIpcErrorMessage(error))
          })
        return
      }
      trackUiEvent('session-export-command', 'User ran the export session command', {
        sessionId: currentSessionId
      })
      void exportSession({ sessionId: currentSessionId })
        .then((result) => {
          if (!result.canceled) {
            toast.success(`已导出到 ${result.filePath}`)
          }
        })
        .catch((error) => {
          trackError('export-session-failed', getIpcErrorMessage(error), error)
          toast.error(getIpcErrorMessage(error))
        })
    },
    [currentSessionId, effectiveIsLoading]
  )

  return (
    <ChatPanelView
      activateChar={activateChar || participants[0] || null}
      participants={participants}
      groupStatusText={groupStatusText}
      activeBackgroundFullSrc={activeBackground.fullSrc}
      messages={messages}
      sessionId={currentSessionId}
      sessionOwnerId={currentSession?.ownerId ?? null}
      summaryAnchorMessageId={currentSession?.summary?.anchorMessageId ?? null}
      onRunCommand={handleRunCommand}
      retryableMessageId={retryableMessageId}
      onRetryMessage={handleRetryMessage}
      onEditMessage={handleEditMessage}
      injectedDraft={draftInjection ?? undefined}
      editingNotice={
        editingFailure?.sessionId === currentSessionId
          ? '正在编辑失败的消息，发送后将移除失败记录'
          : undefined
      }
      onCancelEdit={handleCancelEdit}
      onSendMessage={handleSendMessage}
      onEmoticonPick={handleEmoticonPick}
      onTypingActivity={handleTypingActivity}
      onStop={handleStop}
      isLoading={effectiveIsLoading}
      allowImages={participants.length <= 1 && (selectedModel?.model.supportsImages ?? false)}
    />
  )
}
