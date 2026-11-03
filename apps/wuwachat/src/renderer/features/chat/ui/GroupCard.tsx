import { memo, useCallback, useState, type ReactElement } from 'react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import type { CharacterSummary, ChatGroup } from '@gamechat/type'
import { cn } from '@renderer/common/lib/cn'
import { getIpcErrorMessage } from '@renderer/common/lib/error-message'
import { toast } from 'sonner'
import { trackError, trackUiEvent } from '@renderer/app/telemetry'
import { deleteGroup, setGroupPinned } from '@renderer/services/ai'
import { useCharacterRegistryStore } from '@renderer/store/character-registry'
import { useSessionStore } from '@renderer/store/session'
import { EMPTY_CONVERSATION_TEXT, useSessionActions } from '../hooks/use-session-actions'
import ConversationItem from './ConversationItem'
import groupAvatar from '@renderer/assets/T_IconPhoneSystemType03.png'
import { useSkinSlot, useSkinStyle } from '@renderer/features/appearance'
import { useShallow } from 'zustand/react/shallow'
import { Pin } from 'lucide-react'

type GroupCardProps = {
  group: ChatGroup
  participants: CharacterSummary[]
  /** 该群聊当前的侧栏置顶状态。 */
  isPinned: boolean
}

/**
 * @description 渲染单个群聊的侧栏卡片与展开态会话列表。
 * @param props 群聊定义、固定成员摘要列表与置顶状态。
 * @returns 群聊卡片元素。
 * @remarks 卡片右键菜单提供置顶切换与删除群聊（级联删除全部群会话）；会话条目右键支持
 *   重命名与删除，列表标题以自定义会话标题优先于消息预览。
 */
function GroupCardImpl({ group, participants, isPinned }: GroupCardProps): ReactElement {
  const {
    currentGroupId,
    currentSessionId,
    setCurrentGroupId,
    setCurrentSessionId,
    activateSession
  } = useSessionStore(
    useShallow((state) => ({
      currentGroupId: state.currentGroupId,
      currentSessionId: state.currentSessionId,
      setCurrentGroupId: state.setCurrentGroupId,
      setCurrentSessionId: state.setCurrentSessionId,
      activateSession: state.activateSession
    }))
  )
  const setActivateChar = useCharacterRegistryStore((state) => state.setActivateChar)
  const [isHovering, setIsHovering] = useState(false)
  const [isPressed, setIsPressed] = useState(false)
  const sessions = useSessionStore(
    useShallow((state) => state.summaries.filter((summary) => summary.ownerId === group.id))
  )
  const isActive = currentGroupId === group.id
  // 展开即激活：同一时刻只有当前聊天对象的卡片保持展开，侧栏不允许多卡同时展开。
  const isExpanded = isActive
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
  const title = participants.map((participant) => participant.name).join('、') || '群聊'

  const { handleDeleteSession, handleRenameSession } = useSessionActions()

  /**
   * @description 删除整个群聊并级联删除其全部会话，成功后从本地注册表移除该群聊。
   * @remarks 群下会话列表项由 session-removed 广播逐项移除；当前指向该群聊的选择由
   *   removeGroup 统一清空。删除失败时以全局提示展示错误。
   */
  const handleDeleteGroup = useCallback((): void => {
    void deleteGroup({ groupId: group.id })
      .then(() => {
        useSessionStore.getState().removeGroup(group.id)
      })
      .catch((error) => {
        trackError('delete-group-failed', getIpcErrorMessage(error), error)
        toast.error(getIpcErrorMessage(error))
      })
  }, [group.id])

  /**
   * @description 切换当前群聊的置顶状态，成功后把新群聊快照合并进本地注册表。
   */
  const handleTogglePinned = useCallback((): void => {
    void setGroupPinned({ groupId: group.id, pinned: !isPinned })
      .then((nextGroup) => {
        useSessionStore.getState().upsertGroup(nextGroup)
      })
      .catch((error) => {
        trackError('group-pin-failed', getIpcErrorMessage(error), error)
        toast.error(getIpcErrorMessage(error))
      })
  }, [group.id, isPinned])

  return (
    <div data-rail-card className="flex flex-col gap-2">
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <div
            className={cn(
              'h-fit w-full cursor-pointer rounded-sm border-2 border-transparent p-0.5 transition-transform duration-200',
              !isExpanded ? 'hover:scale-101 hover:border-[#D6D9DB]' : 'border-transparent',
              cardWrapperStyle
            )}
            onClick={() => {
              const nextSession = sessions[0]
              trackUiEvent('group-selected', 'User selected a group chat', {
                groupId: group.id,
                nextSessionId: nextSession?.id || null
              })
              // 折叠即退出聊天：再次点击当前聊天对象时收起列表并清空群聊目标，右侧面板回到空态。
              if (isActive) {
                setCurrentGroupId(null)
                setCurrentSessionId(null)
                return
              }
              setActivateChar(null)
              setCurrentGroupId(group.id)
              activateSession(nextSession?.id || null)
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
              <div className="pointer-events-none absolute top-2 left-4 flex size-15 items-center justify-center">
                <img
                  src={groupAvatar}
                  className="size-9 rounded-full object-cover"
                  draggable="false"
                />
              </div>
              <span
                className={cn(
                  'pointer-events-none absolute top-3.5 left-26 max-w-32 truncate text-lg font-semibold',
                  isExpanded ? 'text-black' : isHovering ? 'text-black/60' : 'text-white'
                )}
              >
                {title}
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
            <ContextMenu.Item
              onSelect={handleDeleteGroup}
              className="flex cursor-pointer items-center rounded-md px-2 py-1.5 text-sm text-red-500 outline-none data-[highlighted]:bg-gray-100"
            >
              删除群聊
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
                onClick={() => activateSession(summary.id)}
                onDelete={() => handleDeleteSession(summary.id)}
                onRename={(title) => handleRenameSession(summary.id, title)}
              />
            ))}
            <ConversationItem
              isNew
              onClick={() => {
                trackUiEvent('group-session-new', 'User started a new group conversation', {
                  groupId: group.id
                })
                setActivateChar(null)
                setCurrentGroupId(group.id)
                setCurrentSessionId(null)
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

const GroupCard = memo(GroupCardImpl)

export default GroupCard
