import * as ContextMenu from '@radix-ui/react-context-menu'
import { memo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { gsap } from 'gsap'
import { cn } from '@renderer/common/lib/cn'
import { useMotionPreference } from '@renderer/app/hooks/useMotionPreference'
import MessageIcon from '@renderer/assets/message.png'
import { useSkinSlot, useSkinStyle } from '@renderer/features/appearance'
import { Plus } from 'lucide-react'

type ConversationItemProps = {
  content?: string
  isNew?: boolean
  isActive?: boolean
  onClick?: () => void
  /** 右键菜单中的会话删除回调；缺省表示该入口不提供删除。以拒绝结束时入口恢复显示，用于删除失败回退。 */
  onDelete?: () => void | Promise<void>
  /** 右键菜单中的会话重命名回调；缺省表示该入口不提供重命名。参数为去除首尾空白后的新标题，空串表示清除自定义标题。 */
  onRename?: (title: string) => void
  /** 是否禁用删除操作（会话正在运行时禁用）。 */
  isDeleteDisabled?: boolean
}

/**
 * @description 渲染侧栏中的单条会话入口或新建会话按钮。
 * @param props 内容文本、激活态、新建态、点击回调与删除、重命名入口。
 * @returns 会话入口元素。
 */
function ConversationItemImpl({
  content,
  isActive,
  onClick,
  isNew,
  onDelete,
  onRename,
  isDeleteDisabled = false
}: ConversationItemProps): ReactElement {
  const [isHovering, setIsHovering] = useState(false)
  const [isPressed, setIsPressed] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const entryRef = useRef<HTMLDivElement>(null)
  // Escape 取消后输入框卸载仍会触发一次失焦；该标记防止取消后的草稿被误提交。
  const isEditCancelledRef = useRef(false)
  const isExitingRef = useRef(false)
  const { shouldAnimate } = useMotionPreference()
  const conversationStates = useSkinSlot('conversationStates')
  const conversationStyle = useSkinStyle('conversationStates')

  /**
   * @description 先以收起动画退出当前入口再执行删除，删除失败时恢复入口显示。
   */
  const handleDelete = (): void => {
    if (!onDelete) {
      return
    }

    const entry = entryRef.current
    if (!entry || !shouldAnimate || isExitingRef.current) {
      onDelete()
      return
    }

    isExitingRef.current = true
    gsap.killTweensOf(entry)
    gsap.fromTo(
      entry,
      { height: entry.offsetHeight, overflow: 'hidden', transition: 'none' },
      {
        height: 0,
        autoAlpha: 0,
        duration: 0.2,
        ease: 'power1.in',
        onComplete: () => {
          Promise.resolve(onDelete()).catch(() => {
            isExitingRef.current = false
            gsap.to(entry, {
              height: 'auto',
              autoAlpha: 1,
              duration: 0.16,
              ease: 'power2.out',
              onComplete: () => {
                gsap.set(entry, { clearProps: 'height,overflow,visibility,opacity,transition' })
              }
            })
          })
        }
      }
    )
  }

  /**
   * @description 进入重命名编辑态，草稿以当前展示文本为初值。
   */
  const startRename = (): void => {
    isEditCancelledRef.current = false
    setDraft(content ?? '')
    setIsEditing(true)
  }

  /**
   * @description 结束编辑态并把去空白后的草稿提交给重命名回调。
   * @remarks 标题未发生变化时不触发回调，交由展示层保持原文本。
   */
  const commitRename = (): void => {
    setIsEditing(false)
    if (!onRename) {
      return
    }
    const trimmed = draft.trim()
    if (trimmed !== (content ?? '').trim()) {
      onRename(trimmed)
    }
  }

  /**
   * @description 处理编辑输入框的按键：Enter 提交，Escape 取消并恢复原文本。
   * @param event 输入框键盘事件。
   */
  const handleEditKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      isEditCancelledRef.current = true
      setIsEditing(false)
    } else if (event.key === 'Enter') {
      isEditCancelledRef.current = true
      commitRename()
    }
  }

  const entry = (
    <div
      ref={entryRef}
      className={cn(
        'group relative ml-4 inline-block h-12 w-min cursor-pointer rounded-sm border-2 border-transparent p-0.5 transition-all duration-200',
        !isActive && isHovering && 'border-white hover:scale-101'
      )}
      onClick={onClick}
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
      <div className="h-10 w-62.5">
        <img
          src={
            isPressed
              ? conversationStates.pressed
              : isActive
                ? conversationStates.selected
                : isHovering
                  ? conversationStates.hover
                  : conversationStates.normal
          }
          className={cn('h-full w-auto max-w-none object-contain', conversationStyle)}
        />
      </div>

      {isNew && (
        <div className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center">
          <Plus className={cn('size-4', isHovering ? 'text-black' : 'text-white')} />
        </div>
      )}

      {!isNew && (
        <>
          <img
            src={MessageIcon}
            className={cn('absolute top-2 left-3 size-7', !isActive && isHovering && 'invert-50')}
          />

          <div className="absolute top-0 right-4 bottom-1 flex w-44 items-center text-sm font-medium text-white/60">
            {isEditing ? (
              <input
                value={draft}
                autoFocus
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => {
                  if (!isEditCancelledRef.current) {
                    commitRename()
                  }
                }}
                onKeyDown={handleEditKeyDown}
                onFocus={(event) => event.currentTarget.select()}
                onClick={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                className="h-6 w-full min-w-0 rounded-sm border border-[#e8c690]/60 bg-black/70 px-1 text-sm text-white outline-none"
              />
            ) : (
              <span
                className={cn(
                  'truncate',
                  isActive && 'text-white',
                  !isActive && isHovering && 'text-black/80'
                )}
              >
                {content}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )

  if (!onDelete && !onRename) {
    return entry
  }

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{entry}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-200 min-w-28 rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
          {onRename && (
            <ContextMenu.Item
              onSelect={startRename}
              className="flex cursor-pointer items-center rounded-md px-2 py-1.5 text-sm text-gray-700 outline-none data-[highlighted]:bg-gray-100"
            >
              重命名会话
            </ContextMenu.Item>
          )}
          {onDelete && (
            <ContextMenu.Item
              disabled={isDeleteDisabled}
              onSelect={handleDelete}
              className="flex cursor-pointer items-center rounded-md px-2 py-1.5 text-sm text-red-500 outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[highlighted]:bg-gray-100"
            >
              删除会话
            </ContextMenu.Item>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

/**
 * @description 判断会话入口是否需要重渲染。
 * @param prev 前一次渲染的属性。
 * @param next 本次渲染的属性。
 * @returns 展示相关的属性均未变化时返回 true。
 */
function areConversationItemsEqual(
  prev: ConversationItemProps,
  next: ConversationItemProps
): boolean {
  return (
    prev.content === next.content &&
    prev.isActive === next.isActive &&
    prev.isNew === next.isNew &&
    prev.isDeleteDisabled === next.isDeleteDisabled
  )
}

const ConversationItem = memo(ConversationItemImpl, areConversationItemsEqual)

export default ConversationItem
