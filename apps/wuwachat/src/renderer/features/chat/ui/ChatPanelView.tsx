import { useState, type ReactElement } from 'react'
import type { CharacterSummary, ChatImageInput, ConversationMessage } from '@gamechat/type'
import {
  useSkinSlot,
  useSkinStyle,
  useAppearanceStore,
  useSkinDecorations,
  SkinSpineMounts,
  DEFAULT_ORNAMENT_MOUNT,
  getOrnamentById
} from '@renderer/features/appearance'
import { cn } from '@renderer/common/lib/cn'
import { SpineCanvas } from '@renderer/common/components/SpineCanvas'
import type { SpineFitBounds } from '@renderer/common/lib/spine-viewer'
import ChatComposer, { type ChatCommandId } from './ChatComposer'
import MessageList from './MessageList'

type ChatPanelViewProps = {
  activateChar: CharacterSummary | null
  participants: CharacterSummary[]
  groupStatusText: string
  activeBackgroundFullSrc: string
  messages: ConversationMessage[]
  sessionId: string | null
  sessionOwnerId: string | null
  /** 会话滚动摘要的锚点消息 ID；其后的第一条消息上方渲染「已整理」分界标记。 */
  summaryAnchorMessageId: string | null
  /** 用户在命令面板中选中一条会话命令。 */
  onRunCommand: (command: ChatCommandId) => void
  retryableMessageId: string | null
  onRetryMessage: (messageId: string) => void
  /** 用户点击失败轮次用户气泡上的「重新编辑」按钮，携带该轮失败 assistant 消息 ID。 */
  onEditMessage: (assistantMessageId: string) => void
  onSendMessage: (message: string, images: ChatImageInput[]) => Promise<void>
  /** 注入输入框的回填草稿；对象更换时覆盖当前输入。 */
  injectedDraft?: { text: string }
  /** 编辑失败消息时展示在输入框上方的提示文案。 */
  editingNotice?: string
  /** 用户取消编辑失败消息。 */
  onCancelEdit?: () => void
  onEmoticonPick: (emoticonId: string) => void
  onStop?: () => void
  isLoading: boolean
  allowImages: boolean
  onTypingActivity?: () => void
}

export default function ChatPanelView({
  activateChar,
  participants,
  groupStatusText,
  activeBackgroundFullSrc,
  messages,
  sessionId,
  sessionOwnerId,
  summaryAnchorMessageId,
  onRunCommand,
  retryableMessageId,
  onRetryMessage,
  onEditMessage,
  onSendMessage,
  injectedDraft,
  editingNotice,
  onCancelEdit,
  onEmoticonPick,
  onStop,
  isLoading,
  onTypingActivity,
  allowImages
}: ChatPanelViewProps): ReactElement {
  const isGroupChat = participants.length > 1
  // 用户装备的聊天面板摆件，未装备时为 null
  const ornament = getOrnamentById(useAppearanceStore((state) => state.appearance.ornamentId))
  // 已回报布局尺寸的摆件标识与包围盒；切换摆件后旧布局作废，容器等待新尺寸期间不可见
  const [ornamentLayout, setOrnamentLayout] = useState<{
    id: string
    bounds: SpineFitBounds
  } | null>(null)
  // 当前皮肤声明的装饰与摆件挂载几何；未声明处使用基线值
  const decorations = useSkinDecorations()
  const ornamentMount = decorations?.ornamentMount ?? DEFAULT_ORNAMENT_MOUNT
  const panelBaseStates = useSkinSlot('panelBaseStates')
  const panelBaseStyle = useSkinStyle('panelBaseStates')
  const charFrame = useSkinSlot('panelCharFrame')
  const charFrameStyle = useSkinStyle('panelCharFrame')
  const charFrameOverlay = useSkinSlot('panelCharFrameOverlay')
  const charFrameOverlayStyle = useSkinStyle('panelCharFrameOverlay')
  const panelTitleStyle = useSkinStyle('panelTitle')
  const panelDescriptionStyle = useSkinStyle('panelDescription')
  // 空态判定与 ChatPanel 的会话对象推导一致：角色或群聊任一被选中即视为会话进行中。
  const hasConversation = activateChar !== null || participants.length > 0
  const panelBase = hasConversation ? panelBaseStates.conversation : panelBaseStates.empty
  const title = isGroupChat
    ? `群聊：${participants.map((participant) => participant.name).join('、')}`
    : activateChar?.name
  const description = isGroupChat ? groupStatusText || '固定成员群聊' : activateChar?.description

  return (
    <div className="relative h-156 w-205">
      <div className="relative h-156 w-205">
        {panelBase && (
          <img
            src={panelBase}
            className={cn(
              'absolute top-0 left-0 size-full object-cover drop-shadow-[0_0_0_#ffffff]',
              panelBaseStyle
            )}
            draggable="false"
          />
        )}
        {!activeBackgroundFullSrc.includes('T_PhoneSystemPanelS.png') && (
          <img
            src={activeBackgroundFullSrc}
            className="absolute bottom-0 object-contain drop-shadow-[0_0_0_#ffffff]"
            draggable="false"
          />
        )}
        <img
          src={charFrame}
          className={cn('absolute z-10 w-full object-contain', charFrameStyle)}
          draggable="false"
        />
        {charFrameOverlay && (
          <img
            src={charFrameOverlay}
            className={charFrameOverlayStyle}
            draggable="false"
          />
        )}
      </div>

      <span className={cn('absolute top-4 left-12 z-20 text-lg font-semibold', panelTitleStyle)}>
        {title}
      </span>

      <span
        className={cn(
          'text-foreground/50 absolute top-12 left-12 z-20 text-xs font-semibold',
          panelDescriptionStyle
        )}
      >
        {description}
      </span>

      <div className="absolute top-26 right-3 bottom-2 left-4">
        <MessageList
          messages={messages}
          sessionId={sessionId}
          sessionOwnerId={sessionOwnerId}
          activateChar={activateChar}
          participants={participants}
          summaryAnchorMessageId={summaryAnchorMessageId}
          retryableMessageId={retryableMessageId}
          onRetryMessage={onRetryMessage}
          onEditMessage={onEditMessage}
          isRetryDisabled={isLoading}
        />
      </div>

      <ChatComposer
        onSendMessage={onSendMessage}
        onEmoticonPick={onEmoticonPick}
        onStop={onStop}
        isLoading={isLoading}
        injectedDraft={injectedDraft}
        editingNotice={editingNotice}
        onCancelEdit={onCancelEdit}
        charId={activateChar?.id || participants[0]?.id}
        onTypingActivity={onTypingActivity}
        onRunCommand={onRunCommand}
        participantNames={
          isGroupChat ? participants.map((participant) => participant.name) : undefined
        }
        allowImages={allowImages}
        voiceCheckCharacterIds={participants.map((participant) => participant.id)}
      />

      {ornament && (
        <div
          className={cn(
            ornamentMount.className,
            'pointer-events-none',
            !(ornamentLayout?.id === ornament.id) && 'invisible'
          )}
        >
          <SpineCanvas
            assetId={ornament.id}
            animations={ornament.animations}
            tapAnimations={ornament.tapAnimations}
            onBounds={(bounds) => setOrnamentLayout({ id: ornament.id, bounds })}
            scale={ornamentMount.scale ?? 1}
            className="pointer-events-auto h-full w-full cursor-pointer"
          />
        </div>
      )}

      <SkinSpineMounts surface="chatPanel" />
    </div>
  )
}
