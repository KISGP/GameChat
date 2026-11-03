import type { CharacterSummary } from '@gamechat/type'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { memo, useState, type ReactElement } from 'react'
import { useSkinSlot, useSkinStyle } from '@renderer/features/appearance'
import { cn } from '@renderer/common/lib/cn'
import { getIpcErrorMessage } from '@renderer/common/lib/error-message'
import { toast } from 'sonner'
import { trackError, trackUiEvent } from '@renderer/app/telemetry'
import { Pin } from 'lucide-react'
import { setCharacterPinned } from '@renderer/services/characters'
import { useSessionStore } from '@renderer/store/session'
import { useCharacterRegistryStore } from '@renderer/store/character-registry'
import { EMPTY_CONVERSATION_TEXT, useSessionActions } from '../hooks/use-session-actions'
import ConversationItem from './ConversationItem'
import { useShallow } from 'zustand/react/shallow'

type CharacterCardProps = {
  char: CharacterSummary
  /** 该角色当前的侧栏置顶状态。 */
  isPinned: boolean
}

/**
 * @description 渲染单个角色的侧栏卡片与展开态会话列表。
 * @param props 角色摘要与置顶状态。
 * @returns 角色卡片元素。
 * @remarks 卡片右键菜单提供置顶切换；会话条目右键支持重命名与删除，
 *   列表标题以自定义会话标题优先于消息预览。
 */
function CharacterCardImpl({ char, isPinned }: CharacterCardProps): ReactElement {
  const { activateChar, setActivateChar } = useCharacterRegistryStore(
    useShallow((state) => ({
      activateChar: state.activateChar,
      setActivateChar: state.setActivateChar
    }))
  )
  const {
    currentSessionId,
    setCurrentSessionId,
    activateSession,
    setCurrentGroupId,
    startNewSession
  } = useSessionStore(
    useShallow((state) => ({
      currentSessionId: state.currentSessionId,
      setCurrentSessionId: state.setCurrentSessionId,
      activateSession: state.activateSession,
      setCurrentGroupId: state.setCurrentGroupId,
      startNewSession: state.startNewSession
    }))
  )
  const sessions = useSessionStore(
    useShallow((state) => state.summaries.filter((summary) => summary.ownerId === char.id))
  )
  const isActive = activateChar?.id === char.id
  // 展开即激活：同一时刻只有当前聊天对象的卡片保持展开，侧栏不允许多卡同时展开。
  const isExpanded = isActive
  const [isHovering, setIsHovering] = useState(false)
  const [isPressed, setIsPressed] = useState(false)
  const cardStates = useSkinSlot('cardStates')
  const cardStyle = useSkinStyle('cardStates')
  const cardWrapperStyle = useSkinStyle('cardWrapper')

  const currentBg = isPressed
    ? cardStates.pressed
    : isExpanded
      ? cardStates.selected
      : isHovering
        ? cardStates.hover
        : cardStates.normal

  const { handleDeleteSession, handleRenameSession } = useSessionActions()

  /**
   * @description 切换当前角色的置顶状态，失败时以全局提示展示错误。
   * @remarks 注册表由主进程广播刷新，本回调无需手动写入本地注册表 Store。
   */
  const handleTogglePinned = (): void => {
    void setCharacterPinned(char.id, !isPinned).catch((error) => {
      trackError('character-pin-failed', getIpcErrorMessage(error), error)
      toast.error(getIpcErrorMessage(error))
    })
  }

  return (
    <div data-rail-card className="flex flex-col gap-2">
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <div
            className={cn(
              'h-fit w-full cursor-pointer rounded-sm border-2 border-transparent p-0.5 transition-transform duration-200',
              !isExpanded ? 'hover:scale-101 hover:border-white' : 'border-transparent',
              cardWrapperStyle
            )}
            onClick={() => {
              trackUiEvent('character-selected', 'User selected a character card', {
                characterId: char.id,
                nextSessionId: sessions[0]?.id || null
              })
              // 折叠即退出聊天：再次点击当前聊天对象时收起列表并清空激活，右侧面板回到空态。
              if (isActive) {
                setActivateChar(null)
                setCurrentSessionId(null)
                return
              }
              setActivateChar(char)
              setCurrentGroupId(null)
              activateSession(sessions[0]?.id || null)
            }}
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => {
              setIsHovering(false)
              setIsPressed(false)
            }}
            onMouseDown={(event) => {
              if (event.button === 0) {
                setIsPressed(true)
              }
            }}
            onMouseUp={() => setIsPressed(false)}
          >
            <div className="relative z-10 h-fit w-full cursor-pointer">
              <img
                src={currentBg}
                className={cn('w-full object-cover', cardStyle)}
                draggable="false"
              />

              <img
                src={char.avatar}
                className="pointer-events-none absolute top-2 left-4 size-15"
                draggable="false"
              />

              <span
                className={cn(
                  'pointer-events-none absolute top-3.5 left-26 text-lg font-semibold',
                  isExpanded ? 'text-black' : isHovering ? 'text-black/60' : 'text-white'
                )}
              >
                {char.name}
              </span>

              {isPinned && (
                <Pin
                  className={cn(
                    'pointer-events-none absolute top-3.5 right-4 size-4',
                    isExpanded ? 'text-black' : isHovering ? 'text-black/60' : 'text-white'
                  )}
                />
              )}
            </div>
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className="z-200 min-w-28 rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
            <ContextMenu.Item
              onSelect={handleTogglePinned}
              className="flex cursor-pointer items-center rounded-md px-2 py-1.5 text-sm text-gray-700 outline-none data-[highlighted]:bg-gray-100"
            >
              {isPinned ? '取消置顶' : '置顶'}
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-300 ease-out',
          isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        )}
      >
        <div className={cn(!isExpanded && 'hidden')}>
          <div className="flex flex-col gap-2 px-1">
            {sessions.map((summary) => (
              <ConversationItem
                key={summary.id}
                content={summary.title || summary.lastMessagePreview || EMPTY_CONVERSATION_TEXT}
                isActive={summary.id === currentSessionId}
                isDeleteDisabled={summary.status === 'running'}
                onClick={() => {
                  trackUiEvent('session-selected', 'User switched conversation session', {
                    characterId: char.id,
                    sessionId: summary.id
                  })
                  activateSession(summary.id)
                }}
                onDelete={() => handleDeleteSession(summary.id)}
                onRename={(title) => handleRenameSession(summary.id, title)}
              />
            ))}
            <ConversationItem
              isNew
              onClick={() => {
                trackUiEvent('session-new', 'User started a new conversation session', {
                  characterId: char.id
                })
                setActivateChar(char)
                setCurrentGroupId(null)
                startNewSession()
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

const CharacterCard = memo(CharacterCardImpl)

export default CharacterCard
