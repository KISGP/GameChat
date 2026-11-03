import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode
} from 'react'
import { flushSync } from 'react-dom'
import { List, type RowComponentProps, useDynamicRowHeight, useListCallbackRef } from 'react-window'
import {
  ArrowLeftRight,
  Ban,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  FileText,
  LoaderCircle,
  Pencil,
  RotateCcw,
  ScrollText,
  Square,
  Volume2,
  X
} from 'lucide-react'
import { useGSAP } from '@gsap/react'
import { gsap } from 'gsap'
import { cn } from '@renderer/common/lib/cn'
import { useMotionPreference } from '@renderer/app/hooks/useMotionPreference'
import { useAppSettingsStore } from '@renderer/store/app-settings'
import { findProviderModel, useProvidersStore } from '@renderer/store/providers'
import { useDismissedBadgesStore } from '../store/dismissed-badges'
import { useStreamingStore } from '@renderer/store/streaming'
import { splitStreamingAssistantMessageSegments } from '@gamechat/schema'
import bgAvatar from '@renderer/assets/avatar-bg.png'
import playerAvatar from '@renderer/assets/T_IconRoleHeadCircle256_5_a_UI.png'
import { Bubble, BubbleContent, BubbleTail } from '@renderer/common/components/bubble'
import { Button } from '@renderer/common/components/button'
import { track } from '@renderer/services/logs'
import { cancel, synthesize } from '@renderer/services/tts'
import { getCharacterEmoticons, getUserEmoticons } from '@renderer/services/emoticons'
import { getChatAttachmentMediaUrl } from '@gamechat/schema'
import type { CharacterSummary, ChatImageAttachment, ConversationMessage } from '@gamechat/type'
import type { ChatEmoticonImage } from '@gamechat/schema'
import { trackError } from '@renderer/app/telemetry'
import { useAppearanceStore } from '@renderer/features/appearance/store/appearance'
import {
  buildMessageListItems,
  type ChatBadgeKind,
  type MessageBadgeItem,
  type MessageEntryItem,
  type MessageListItem
} from '../lib/message-list-items'
import {
  BOZAI_BUBBLE_ID,
  BOZAI_TEXT_COLOR,
  DAWEI_BUBBLE_ID,
  XINYUEHU_BUBBLE_ID
} from '@renderer/features/appearance/bubbles/catalog'
import { UserBubbleFrame } from '@renderer/features/appearance/bubbles/render/UserBubbleFrame'
import { useVoiceOutputStore } from '../store/voice'
import { getTtsErrorMessage } from '../lib/tts-error'
import { VoiceMessageBubble } from './VoiceMessageBubble'

gsap.registerPlugin(useGSAP)

type MessageListProps = {
  messages: ConversationMessage[]
  sessionId: string | null
  sessionOwnerId: string | null
  activateChar: CharacterSummary | null
  participants: CharacterSummary[]
  /** 会话滚动摘要的锚点消息 ID；其后第一条消息上方派生「已整理为摘要」徽章。 */
  summaryAnchorMessageId: string | null
  retryableMessageId: string | null
  onRetryMessage: (messageId: string) => void
  /** 用户点击失败轮次用户气泡上的「重新编辑」按钮，携带该轮失败 assistant 消息 ID。 */
  onEditMessage: (assistantMessageId: string) => void
  isRetryDisabled: boolean
}

/**
 * @description 将消息内容写入系统剪贴板。
 * @param content 需要复制的消息文本。
 * @returns 内容是否已成功复制。
 * @remarks 剪贴板权限被拒绝时记录错误，避免点击操作静默失败。
 */
async function copyMessageContent(content: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(content)
    return true
  } catch (error) {
    trackError('copy-message-failed', 'Failed to copy chat message content', error)
    return false
  }
}

type SpeechState = {
  messageId: string
  phase: 'synthesizing' | 'playing'
} | null

type SpeechError = {
  messageId: string
  message: string
}

/**
 * @description 将浏览器音频元素的失败状态写入应用日志，用于区分协议加载与 WAV 解码问题。
 * @param audio 触发错误事件的音频元素。
 * @param messageId 当前播放控制对应的角色消息标识。
 */
function logTtsPlaybackFailure(audio: HTMLAudioElement, messageId: string): void {
  const mediaError = audio.error
  void track({
    level: 'error',
    source: 'renderer',
    event: 'tts-audio-playback-failed',
    message: 'Synthesized TTS audio could not be played',
    context: {
      currentSrc: audio.currentSrc,
      mediaErrorCode: mediaError?.code ?? null,
      mediaErrorMessage: mediaError?.message ?? null,
      messageId,
      networkState: audio.networkState,
      readyState: audio.readyState,
      src: audio.src
    }
  }).catch((error: unknown) => {
    trackError('record-tts-failure-failed', 'Failed to record TTS playback failure', error)
  })
}

/**
 * @description 展开条内单个圆钮的统一外观类名。
 * @remarks 圆钮以透明底叠在白色条上，hover 时底色与图标同步加深；禁用与激活态由调用点按需叠加。
 */
const STRIP_BUTTON_CLASS =
  'flex size-7 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-black/5 hover:text-[#333] disabled:cursor-not-allowed disabled:opacity-30'

type MessageActionsAreaProps = {
  isUserMessage: boolean
  /** 包裹的气泡内容。 */
  children: ReactNode
  message: ConversationMessage
  /** 消息内容为空时禁用复制。 */
  isCopyDisabled: boolean
  /** TTS 就绪且角色消息可朗读时才提供播放入口。 */
  canSpeak: boolean
  speechState: SpeechState
  speechError: SpeechError | null
  onToggleSpeech: (message: ConversationMessage) => void
  /** 语音气泡消息的合成与播放均已结束时提供转文字入口。 */
  isVoiceTextAvailable: boolean
  isVoiceTextVisible: boolean
  onToggleVoiceText: () => void
  /** 该消息是当前重试目标时提供重新生成入口。 */
  retryTargetId: string | undefined
  isRetryDisabled: boolean
  onRetryMessage: (messageId: string) => void
  /** 该消息是失败轮次的输入用户消息时提供重新编辑入口，携带失败 assistant 消息 ID。 */
  editTargetId: string | undefined
  onEditMessage: (assistantMessageId: string) => void
}

/**
 * @description 消息操作区：包裹气泡内容，并在气泡下方头像侧提供可淡入的图标按钮条。
 * @param props 消息侧别、包裹的气泡内容与各操作的可用性、回调。
 * @returns 消息操作区元素。
 * @remarks 平时完全不显示；hover 消息区或键盘聚焦时按钮条在头像侧角落淡入为图标按钮排，
 *   移开或失焦淡出隐藏；动画经 GSAP 驱动并遵循动画偏好设置。
 */
function MessageActionsArea({
  isUserMessage,
  children,
  message,
  isCopyDisabled,
  canSpeak,
  speechState,
  speechError,
  onToggleSpeech,
  isVoiceTextAvailable,
  isVoiceTextVisible,
  onToggleVoiceText,
  retryTargetId,
  isRetryDisabled,
  onRetryMessage,
  editTargetId,
  onEditMessage
}: MessageActionsAreaProps): ReactElement {
  const areaRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const showStripRef = useRef<() => void>(() => {})
  const hideStripRef = useRef<() => void>(() => {})
  const copyButtonRef = useRef<HTMLButtonElement>(null)
  const indicatorRef = useRef<HTMLSpanElement>(null)
  const resetTimerRef = useRef<number | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const animateCopyConfirmationRef = useRef<() => void>(() => {})
  const [isCopied, setIsCopied] = useState(false)
  const { shouldAnimate } = useMotionPreference()
  const isSpeaking = speechState?.messageId === message.id
  const isSynthesizing = isSpeaking && speechState.phase === 'synthesizing'
  const isPlaying = isSpeaking && speechState.phase === 'playing'
  const hasSpeechError = speechError?.messageId === message.id
  const speechLabel = isSynthesizing
    ? '停止生成语音'
    : isPlaying
      ? '停止播放'
      : hasSpeechError
        ? '语音生成失败'
        : '播放语音'

  useGSAP(
    (_, contextSafe) => {
      if (!contextSafe) {
        return
      }

      animateCopyConfirmationRef.current = contextSafe(() => {
        const indicator = indicatorRef.current

        if (!indicator || !shouldAnimate) {
          return
        }

        gsap.killTweensOf(indicator)
        gsap.fromTo(
          indicator,
          { autoAlpha: 0.35, rotation: -18, scale: 0.65 },
          { autoAlpha: 1, duration: 0.28, ease: 'back.out(2)', rotation: 0, scale: 1 }
        )
      })

      return () => {
        animateCopyConfirmationRef.current = () => {}
      }
    },
    { dependencies: [shouldAnimate], revertOnUpdate: true, scope: copyButtonRef }
  )

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current)
      }

      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
      }
    },
    []
  )

  /**
   * @description 将消息内容写入剪贴板并播放对勾确认反馈。
   * @remarks 复制失败时不进入反馈态，错误已由复制工具记录。
   */
  const handleCopy = async (): Promise<void> => {
    const wasCopied = await copyMessageContent(message.content)

    if (!wasCopied) {
      return
    }

    setIsCopied(true)

    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current)
    }

    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current)
    }

    animationFrameRef.current = window.requestAnimationFrame(() => {
      animateCopyConfirmationRef.current()
    })
    resetTimerRef.current = window.setTimeout(() => {
      setIsCopied(false)
    }, 1600)
  }

  useGSAP(
    (_, contextSafe) => {
      if (!contextSafe) {
        return
      }

      const strip = stripRef.current

      if (!strip) {
        return
      }

      gsap.set(strip, { autoAlpha: 0 })

      showStripRef.current = contextSafe(() => {
        gsap.killTweensOf(strip)

        if (!shouldAnimate) {
          gsap.set(strip, { autoAlpha: 1 })
          return
        }

        gsap.to(strip, { autoAlpha: 1, duration: 0.18, ease: 'power2.out' })
      })

      hideStripRef.current = contextSafe(() => {
        gsap.killTweensOf(strip)

        if (!shouldAnimate) {
          gsap.set(strip, { autoAlpha: 0 })
          return
        }

        gsap.to(strip, { autoAlpha: 0, duration: 0.15, ease: 'power1.in' })
      })

      return () => {
        showStripRef.current = () => {}
        hideStripRef.current = () => {}
      }
    },
    { dependencies: [shouldAnimate], revertOnUpdate: true, scope: areaRef }
  )

  return (
    <div
      ref={areaRef}
      className={cn(
        'relative mt-1 flex flex-col gap-2',
        isUserMessage ? 'items-end' : 'items-start'
      )}
      onPointerEnter={() => showStripRef.current()}
      onPointerLeave={() => hideStripRef.current()}
      onFocus={() => showStripRef.current()}
      onBlur={(event) => {
        const nextFocusedElement = event.relatedTarget

        if (
          !(nextFocusedElement instanceof Node) ||
          !event.currentTarget.contains(nextFocusedElement)
        ) {
          hideStripRef.current()
        }
      }}
    >
      {children}
      <div
        ref={stripRef}
        className={cn(
          'absolute top-[calc(100%+4px)] z-20 flex h-7 items-center rounded-full opacity-0',
          'bg-white shadow-[0_2px_8px_rgba(0,0,0,0.18)] ring-1 ring-black/5',
          isUserMessage ? 'right-0' : 'left-0'
        )}
      >
        <div className={cn('flex items-center gap-0.5', isUserMessage && 'flex-row-reverse')}>
          <button
            ref={copyButtonRef}
            type="button"
            onClick={() => void handleCopy()}
            disabled={isCopyDisabled}
            className={cn(STRIP_BUTTON_CLASS, isCopied && 'text-green-500 hover:text-green-500')}
            title={isCopied ? '已复制' : '复制消息'}
            aria-label={isCopied ? '消息已复制' : '复制消息'}
          >
            <span ref={indicatorRef} className="flex items-center justify-center">
              {isCopied ? <Check size={16} strokeWidth={2.5} /> : <Copy size={16} />}
            </span>
          </button>
          {canSpeak && (
            <button
              type="button"
              onClick={() => onToggleSpeech(message)}
              className={cn(
                STRIP_BUTTON_CLASS,
                hasSpeechError && 'text-red-500 hover:text-red-500'
              )}
              title={
                isSynthesizing
                  ? '停止生成语音'
                  : isPlaying
                    ? '停止播放'
                    : hasSpeechError
                      ? `语音生成失败：${speechError?.message ?? ''}`
                      : '播放角色语音'
              }
              aria-label={speechLabel}
            >
              {isSynthesizing ? (
                <LoaderCircle size={16} className="animate-spin" />
              ) : isPlaying ? (
                <Square size={14} fill="currentColor" />
              ) : hasSpeechError ? (
                <CircleAlert size={16} />
              ) : (
                <Volume2 size={16} />
              )}
            </button>
          )}
          {isVoiceTextAvailable && (
            <button
              type="button"
              onClick={onToggleVoiceText}
              className={cn(STRIP_BUTTON_CLASS, isVoiceTextVisible && 'text-[#393C4B]')}
              title={isVoiceTextVisible ? '隐藏文字' : '转文字'}
              aria-label={isVoiceTextVisible ? '隐藏文字' : '转文字'}
            >
              <FileText size={16} />
            </button>
          )}
          {editTargetId !== undefined && (
            <button
              type="button"
              onClick={() => onEditMessage(editTargetId)}
              className={STRIP_BUTTON_CLASS}
              title="重新编辑"
              aria-label="重新编辑"
            >
              <Pencil size={16} />
            </button>
          )}
          {retryTargetId !== undefined && (
            <button
              type="button"
              onClick={() => onRetryMessage(retryTargetId)}
              disabled={isRetryDisabled}
              className={STRIP_BUTTON_CLASS}
              title="重新生成"
              aria-label="重新生成"
            >
              <RotateCcw size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

type CollapsibleMessageContentProps = {
  content: string
  // 消息是否已完成；只有完成消息参与折叠，流式内容保持完整高度。
  isComplete: boolean
  maxLineCount: number
}

type AttachmentPreviewProps = {
  sessionOwnerId: string | null
  sessionId: string | null
  attachment: ChatImageAttachment
}

type EmoticonBubbleProps = {
  id: string
  role: ConversationMessage['role']
  characterId: string
}

/**
 * @description 按消息来源读取并展示表情图片，缺失时显示稳定占位符。
 * @param id 表情全局 ID。
 * @param role 消息角色。
 * @param characterId 当前角色 ID。
 * @returns 表情图片或占位元素。
 */
function EmoticonBubble({ id, role, characterId }: EmoticonBubbleProps): ReactElement {
  const [image, setImage] = useState<ChatEmoticonImage | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = role === 'user' ? getUserEmoticons() : getCharacterEmoticons(characterId)
    void load
      .then((images) => {
        if (!cancelled) setImage(images.find((item) => item.id === id) || null)
      })
      .catch((error) => {
        if (!cancelled) {
          trackError('load-chat-emoticon-failed', 'Failed to load chat emoticon', error)
          setImage(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [characterId, id, role])

  if (image?.dataUrl && !image.unavailable) {
    return (
      <img
        src={image.dataUrl}
        alt={image.description}
        className="size-30 object-contain"
        draggable="false"
      />
    )
  }
  return (
    <div className="flex size-30 items-center justify-center bg-gray-200/80 px-2 text-center text-xs text-gray-500">
      {id}
    </div>
  )
}

/**
 * @description 以媒体协议地址直接展示聊天附件图片。
 * @param sessionOwnerId 会话所有者 ID。
 * @param sessionId 当前会话 ID。
 * @param attachment 图片附件元数据。
 * @remarks 图片经自定义协议由主进程按白名单路径提供，加载失败时回退为文件名占位。
 */
function AttachmentPreview({
  sessionOwnerId,
  sessionId,
  attachment
}: AttachmentPreviewProps): ReactElement {
  const [hasFailed, setHasFailed] = useState(false)
  const src =
    sessionOwnerId && sessionId
      ? getChatAttachmentMediaUrl(
          sessionOwnerId,
          sessionId,
          attachment.resourceId,
          attachment.mimeType
        )
      : null

  return (
    <div className="relative size-28 shrink-0 overflow-hidden rounded-md border border-black/10 bg-gray-100">
      {src && !hasFailed ? (
        <img
          src={src}
          alt={attachment.fileName}
          className="size-full object-cover"
          draggable="false"
          onError={() => setHasFailed(true)}
        />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-1 px-2 text-center text-[10px] text-gray-500">
          <span className="max-w-full truncate">{attachment.fileName}</span>
          <span>{hasFailed ? '图片加载失败' : '会话不可用'}</span>
        </div>
      )}
    </div>
  )
}

function CollapsibleMessageContent({
  content,
  isComplete,
  maxLineCount
}: CollapsibleMessageContentProps): ReactElement {
  const contentRef = useRef<HTMLParagraphElement>(null)
  const toggleIconRef = useRef<SVGSVGElement>(null)
  // 折叠态高度缓存：仅在折叠终态下刷新，作为展开补间的取样起点。
  const collapsedHeightRef = useRef<number | null>(null)
  const previousCompleteRef = useRef<boolean | null>(null)
  const previousExpandedRef = useRef<boolean | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const [isOverflowing, setIsOverflowing] = useState(false)
  // 行钳制由该状态单独驱动：只在完成消息的折叠终态生效，收起或完成补间结束后才恢复，
  // 避免钳制把动画期间的超出行从绘制里截掉；流式期间经渲染期调整为常关。
  const [isClampActive, setIsClampActive] = useState(true)
  const { shouldAnimate } = useMotionPreference()

  if (!isComplete && isClampActive) {
    setIsClampActive(false)
  }

  useLayoutEffect(() => {
    const contentElement = contentRef.current

    if (!contentElement || !isComplete || isExpanded || !isClampActive) {
      return
    }

    /**
     * @description 根据折叠后的实际高度判断消息是否需要展示展开按钮。
     */
    const updateOverflowState = (): void => {
      setIsOverflowing(contentElement.scrollHeight > contentElement.clientHeight + 1)
    }

    updateOverflowState()
    const resizeObserver = new ResizeObserver(updateOverflowState)
    resizeObserver.observe(contentElement)

    return () => {
      resizeObserver.disconnect()
    }
  }, [content, isComplete, isExpanded, isClampActive, maxLineCount])

  /**
   * @description 量取当前排版宽度下的折叠态高度，作为收起补间的目标。
   * @returns 施加行钳制后的段落高度，单位为像素；元素未挂载时返回 0。
   * @remarks 以临时写内联样式并立即还原的方式量取；还原走快照回写，保留补间残留的内联高度。
   */
  const measureCollapsedHeight = (): number => {
    const contentElement = contentRef.current

    if (!contentElement) {
      return 0
    }

    const { style } = contentElement
    const snapshot = style.cssText
    style.display = '-webkit-box'
    style.webkitBoxOrient = 'vertical'
    style.webkitLineClamp = String(maxLineCount)
    style.overflow = 'hidden'
    const collapsedHeight = contentElement.getBoundingClientRect().height
    style.cssText = snapshot

    return collapsedHeight
  }

  /**
   * @description 切换消息展开态并触发高度补间。
   * @remarks 展开方向在状态翻转前记录折叠高度作补间起点，并立即解除行钳制让完整文字参与动画；钳制样式延迟到收起补间结束才恢复。
   */
  const toggleExpanded = (): void => {
    const contentElement = contentRef.current

    if (!isExpanded && contentElement && contentElement.style.height === '') {
      collapsedHeightRef.current = contentElement.getBoundingClientRect().height
    }

    if (!isExpanded) {
      setIsClampActive(false)
    }

    setIsExpanded((expanded) => !expanded)
  }

  useGSAP(
    () => {
      const contentElement = contentRef.current

      if (!contentElement) {
        return
      }

      const wasComplete = previousCompleteRef.current
      const wasExpanded = previousExpandedRef.current

      previousCompleteRef.current = isComplete
      previousExpandedRef.current = isExpanded
      gsap.killTweensOf(contentElement)

      if (
        wasExpanded === null ||
        (wasExpanded === isExpanded && wasComplete === isComplete) ||
        !shouldAnimate
      ) {
        // 首次挂载、非翻转触发或关闭动效：直接摆定终态，不播补间。
        gsap.set(contentElement, { clearProps: 'height' })

        if (toggleIconRef.current) {
          gsap.set(toggleIconRef.current, { rotation: isExpanded ? 180 : 0 })
        }

        if (!isExpanded && isComplete) {
          setIsClampActive(true)
        }

        return
      }

      if (toggleIconRef.current) {
        gsap.to(toggleIconRef.current, {
          rotation: isExpanded ? 180 : 0,
          duration: 0.2,
          ease: 'power2.out',
          overwrite: 'auto'
        })
      }

      if (isExpanded) {
        // 展开：自折叠高度揭示到完整高度，结束后交还自适应，后续内容增长由文档流自然接管。
        const fromHeight =
          contentElement.style.height === ''
            ? (collapsedHeightRef.current ?? contentElement.getBoundingClientRect().height)
            : contentElement.getBoundingClientRect().height

        gsap.set(contentElement, { height: fromHeight })
        gsap.to(contentElement, {
          height: contentElement.scrollHeight,
          duration: 0.22,
          ease: 'power2.out',
          overwrite: 'auto',
          onComplete: () => {
            gsap.set(contentElement, { clearProps: 'height' })
          }
        })

        return
      }

      // 收拢：手动收起或流式完成时自动折叠；元素保持无钳制绘制，自当前高度收敛到折叠高度，结束时恢复行钳制。
      gsap.to(contentElement, {
        height: measureCollapsedHeight(),
        duration: 0.18,
        ease: 'power2.inOut',
        overwrite: 'auto',
        onComplete: () => {
          gsap.set(contentElement, { clearProps: 'height' })
          // 清高度后元素回到无钳制的全高状态；用 flushSync 让钳制在本帧绘制前提交，避免收尾闪现完整气泡。
          flushSync(() => setIsClampActive(true))
        }
      })
    },
    { dependencies: [isComplete, isExpanded, shouldAnimate] }
  )

  return (
    <div>
      <p
        ref={contentRef}
        className="text-[15px] leading-relaxed font-medium tracking-wide select-text"
        style={
          isClampActive
            ? {
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: maxLineCount,
                display: '-webkit-box',
                overflow: 'hidden'
              }
            : undefined
        }
      >
        {content}
      </p>
      {isOverflowing && (
        <Button
          variant="link"
          onClick={toggleExpanded}
          className="mt-1 h-auto p-0 font-medium text-current"
          aria-expanded={isExpanded}
        >
          <ChevronDown ref={toggleIconRef} />
          {isExpanded ? '收起' : '展开'}
        </Button>
      )}
    </div>
  )
}

type TypingIndicatorBubbleProps = {
  isUserMessage: boolean
}

/**
 * @description 渲染等待中的三点动画气泡，供占位消息与语音合成等待期共用。
 * @param isUserMessage 是否为用户侧气泡，决定配色与圆角朝向。
 * @returns 三点动画气泡元素。
 */
function TypingIndicatorBubble({ isUserMessage }: TypingIndicatorBubbleProps): ReactElement {
  return (
    <Bubble
      align={isUserMessage ? 'end' : 'start'}
      variant="chat"
      className="max-w-md drop-shadow-[0_1px_2px_rgba(0,0,0,0.05)] filter"
    >
      <BubbleTail />
      <BubbleContent
        className={cn(
          'min-h-12 px-5 py-3 text-[#333]',
          isUserMessage
            ? 'rounded-tl-md rounded-tr-none rounded-br-md rounded-bl-xl bg-[#393C4B] text-white'
            : 'rounded-tl-none rounded-tr-md rounded-br-xl rounded-bl-md bg-white text-[#333]'
        )}
      >
        <div className="flex h-6 items-center gap-1 px-1">
          <div className="size-2 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.3s]" />
          <div className="size-2 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.15s]" />
          <div className="size-2 animate-bounce rounded-full bg-gray-400" />
        </div>
      </BubbleContent>
    </Bubble>
  )
}

/** 消息列表行共享的装配数据与回调。 */
type MessageRowBaseProps = {
  items: MessageListItem[]
  sessionId: string | null
  sessionOwnerId: string | null
  activateChar: CharacterSummary | null
  participants: CharacterSummary[]
  retryableMessageId: string | null
  onRetryMessage: (messageId: string) => void
  isRetryDisabled: boolean
  speechState: SpeechState
  speechError: SpeechError | null
  onToggleSpeech: (message: ConversationMessage) => void
  onToggleVoiceMessage: (message: ConversationMessage) => void
  messageCollapseLineCount: number
  ttsEnabled: boolean
  arrivalTracker: MessageArrivalTracker
  onDismissBadge: (key: string) => void
  onEditMessage: (assistantMessageId: string) => void
}

type MessageListRowProps = RowComponentProps<MessageRowBaseProps>

/** 徽章种类到图标的映射。 */
const BADGE_ICONS: Record<ChatBadgeKind, ReactElement> = {
  'model-switch': <ArrowLeftRight size={12} />,
  summary: <ScrollText size={12} />,
  failure: <CircleAlert size={12} />,
  interrupted: <Ban size={12} />
}

/**
 * @description 消息列表行分发器：按条目种类路由到徽章行或消息行。
 * @param props react-window 传入的行属性与装配数据。
 * @returns 徽章行或消息行元素。
 * @remarks 分发不携带自身 hooks，两种行的 hooks 列表互不干扰；行种类翻转时按组件类型整体重挂载。
 */
function MessageListRow({ index, style, ...rowProps }: MessageListRowProps): ReactElement {
  const item = rowProps.items[index]
  const sharedProps = { style, ...rowProps }
  return item.kind === 'badge' ? (
    <MessageBadgeRow item={item} {...sharedProps} />
  ) : (
    <MessageItem item={item} {...sharedProps} />
  )
}

/**
 * @description 渲染由落盘事实派生的系统提示徽章行，携带重试目标的徽章附带重试圆钮，全部徽章可关闭。
 * @param item 徽章条目。
 * @param style react-window 行定位样式。
 * @param arrivalTracker 消息入场追踪状态。
 * @param retryableMessageId 当前可重试的消息 ID。
 * @param onRetryMessage 重试回调，携带目标消息 ID。
 * @param isRetryDisabled 重试是否处于禁用态。
 * @param onDismissBadge 关闭徽章回调，携带徽章条目键。
 * @returns 居中徽章行元素。
 */
function MessageBadgeRow({
  item,
  style,
  arrivalTracker,
  retryableMessageId,
  onRetryMessage,
  isRetryDisabled,
  onDismissBadge
}: MessageRowBaseProps & { item: MessageBadgeItem; style?: CSSProperties }): ReactElement {
  const rowRef = useRef<HTMLDivElement>(null)
  const { shouldAnimate } = useMotionPreference()

  useGSAP(
    () => {
      const row = rowRef.current
      if (!row || !arrivalTracker.arrivals.has(item.key)) {
        return
      }

      arrivalTracker.arrivals.delete(item.key)
      if (shouldAnimate) {
        gsap.from(row.children, {
          autoAlpha: 0,
          duration: 0.24,
          ease: 'power2.out',
          y: 8
        })
      }
    },
    { dependencies: [arrivalTracker, shouldAnimate], scope: rowRef }
  )

  const retryMessageId =
    item.messageId !== undefined && retryableMessageId === item.messageId
      ? item.messageId
      : undefined

  return (
    <div ref={rowRef} style={style}>
      <div className="flex items-center justify-center gap-2 px-10 py-1.5">
        <span
          title={item.detail}
          className={cn(
            'inline-flex max-w-[min(100%,28rem)] items-center gap-1.5 rounded-full py-1 pr-1 pl-3 text-xs',
            item.badge === 'failure' ? 'bg-red-50 text-red-400' : 'bg-gray-100 text-gray-500'
          )}
        >
          <span className="shrink-0">{BADGE_ICONS[item.badge]}</span>
          <span className="truncate">{item.label}</span>
          <button
            type="button"
            onClick={() => onDismissBadge(item.key)}
            className="flex size-4 shrink-0 items-center justify-center rounded-full text-current opacity-50 transition-colors hover:bg-black/10 hover:opacity-100"
            title="关闭提示"
            aria-label="关闭提示"
          >
            <X size={11} />
          </button>
        </span>
        {retryMessageId !== undefined && (
          <button
            type="button"
            onClick={() => onRetryMessage(retryMessageId)}
            disabled={isRetryDisabled}
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-gray-400 opacity-60 transition-colors hover:text-[#333] hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
            title="重试"
            aria-label="重试"
          >
            <RotateCcw size={16} />
          </button>
        )}
      </div>
    </div>
  )
}

function MessageItem({
  item,
  style,
  sessionId,
  sessionOwnerId,
  activateChar,
  participants,
  isRetryDisabled,
  onRetryMessage,
  speechState,
  speechError,
  onToggleSpeech,
  onToggleVoiceMessage,
  messageCollapseLineCount,
  ttsEnabled,
  arrivalTracker,
  onEditMessage
}: MessageRowBaseProps & { item: MessageEntryItem; style?: CSSProperties }): ReactElement {
  const message = item.message
  const isUserMessage = message.role === 'user'
  const bubbleId = useAppearanceStore((state) => state.appearance.bubbleId)
  // 金框仅套在用户文本气泡上；语音、表情与占位指示器保持原样
  const spineBubbleFrame = isUserMessage && bubbleId === XINYUEHU_BUBBLE_ID
  const daweiBubbleFrame = isUserMessage && bubbleId === DAWEI_BUBBLE_ID
  const bozaiBubbleFrame = isUserMessage && bubbleId === BOZAI_BUBBLE_ID
  const bubbleBoxRef = useRef<HTMLDivElement | null>(null)
  const speaker =
    participants.find((participant) => participant.id === message.senderId) || activateChar || null
  const voiceEntry = useVoiceOutputStore((state) => state.entries[message.id])
  const textVisible = useVoiceOutputStore((state) => state.textVisibleIds[message.id] ?? false)
  const toggleTextVisible = useVoiceOutputStore((state) => state.toggleTextVisible)
  const { shouldAnimate } = useMotionPreference()
  const rowRef = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const row = rowRef.current
      if (!row || !arrivalTracker.arrivals.has(item.key)) {
        return
      }

      arrivalTracker.arrivals.delete(item.key)
      if (shouldAnimate) {
        gsap.from(row.children, {
          autoAlpha: 0,
          duration: 0.24,
          ease: 'power2.out',
          stagger: 0.05,
          y: 12
        })
      }
    },
    { dependencies: [arrivalTracker, shouldAnimate], scope: rowRef }
  )

  const isVoicePending = voiceEntry?.status === 'queued' || voiceEntry?.status === 'synthesizing'
  const isVoicePlaying = speechState?.messageId === message.id && speechState.phase === 'playing'
  const isCopyDisabled = !message.content.trim()
  // 重试钮的落点由列表组装决定：重试目标气泡自身，或空中断尾部前最近的用户消息气泡。
  const retryTargetId = item.retryTargetId
  const editTargetId = item.editTargetId
  const canSpeak =
    ttsEnabled &&
    !isUserMessage &&
    !voiceEntry &&
    message.status === 'complete' &&
    Boolean(message.content.trim())

  return (
    <div ref={rowRef} className="group" style={style}>
      <div className={cn('flex gap-1 pb-[34px]', isUserMessage && 'flex-row-reverse gap-5')}>
        <div className={cn('relative size-15', isUserMessage ? 'mr-4' : 'ml-4')}>
          <img src={bgAvatar} />
          <img
            src={isUserMessage ? playerAvatar : speaker?.avatar}
            className="absolute top-0.5 left-0.5 size-14"
            draggable="false"
          />
        </div>

        <div className={cn('flex flex-col', isUserMessage ? 'items-end' : 'items-start')}>
          <div>
            <span
              className={cn(
                'mt-2 block text-sm font-[550] text-[#555]/70',
                isUserMessage ? 'mr-2' : 'ml-2'
              )}
            >
              {isUserMessage ? '漂泊者' : speaker?.name}
            </span>
          </div>

          <MessageActionsArea
            isUserMessage={isUserMessage}
            message={message}
            isCopyDisabled={isCopyDisabled}
            canSpeak={canSpeak}
            speechState={speechState}
            speechError={speechError}
            onToggleSpeech={onToggleSpeech}
            isVoiceTextAvailable={Boolean(voiceEntry) && !isVoicePending}
            isVoiceTextVisible={textVisible}
            onToggleVoiceText={() => toggleTextVisible(message.id)}
            retryTargetId={retryTargetId}
            isRetryDisabled={isRetryDisabled}
            onRetryMessage={onRetryMessage}
            editTargetId={editTargetId}
            onEditMessage={onEditMessage}
          >
            {message.attachments && message.attachments.length > 0 && (
              <div className="flex max-w-full flex-wrap gap-2">
                {message.attachments.map((attachment) => (
                  <AttachmentPreview
                    key={attachment.resourceId}
                    sessionOwnerId={sessionOwnerId}
                    sessionId={sessionId}
                    attachment={attachment}
                  />
                ))}
              </div>
            )}
            {message.emoticonId ? (
              <EmoticonBubble
                id={message.emoticonId}
                role={message.role}
                characterId={speaker?.id ?? ''}
              />
            ) : isVoicePending ? (
              <TypingIndicatorBubble isUserMessage={isUserMessage} />
            ) : (message.status === 'pending' || message.status === 'streaming') &&
              !message.content ? (
              <TypingIndicatorBubble isUserMessage={isUserMessage} />
            ) : message.content ? (
              voiceEntry ? (
                <>
                  <VoiceMessageBubble
                    message={message}
                    entry={voiceEntry}
                    isPlaying={isVoicePlaying}
                    onTogglePlay={() => onToggleVoiceMessage(message)}
                  />
                  {textVisible && (
                    <div className="max-w-md rounded-2xl bg-white/90 px-4 py-3 text-[#333]">
                      <CollapsibleMessageContent
                        key={message.id}
                        content={message.content}
                        isComplete={message.status === 'complete'}
                        maxLineCount={messageCollapseLineCount}
                      />
                    </div>
                  )}
                </>
              ) : (
                <Bubble
                  ref={bubbleBoxRef}
                  align={isUserMessage ? 'end' : 'start'}
                  variant="chat"
                  className="max-w-md drop-shadow-[0_1px_2px_rgba(0,0,0,0.05)] filter"
                >
                  {spineBubbleFrame || daweiBubbleFrame || bozaiBubbleFrame ? null : <BubbleTail />}
                  <BubbleContent
                    className={cn(
                      'min-h-12 px-5 py-3',
                      isUserMessage
                        ? [
                            'rounded-tl-md rounded-tr-none rounded-br-md rounded-bl-xl',
                            spineBubbleFrame || daweiBubbleFrame
                              ? 'relative z-30 bg-transparent text-white'
                              : bozaiBubbleFrame
                                ? 'relative z-30 bg-transparent'
                                : 'bg-[#393C4B] text-white'
                          ]
                        : 'rounded-tl-none rounded-tr-md rounded-br-xl rounded-bl-md bg-white text-[#333]'
                    )}
                    style={bozaiBubbleFrame ? { color: BOZAI_TEXT_COLOR } : undefined}
                  >
                    <CollapsibleMessageContent
                      key={message.id.split(STREAM_MESSAGE_ID_SUFFIX)[0]}
                      content={message.content}
                      isComplete={message.status === 'complete'}
                      maxLineCount={messageCollapseLineCount}
                    />
                  </BubbleContent>
                  {(spineBubbleFrame || daweiBubbleFrame || bozaiBubbleFrame) && (
                    <UserBubbleFrame bubbleId={bubbleId} boxRef={bubbleBoxRef} />
                  )}
                </Bubble>
              )
            ) : null}
          </MessageActionsArea>
        </div>
      </div>
    </div>
  )
}

/**
 * @description 流式分段消息在占位消息标识后追加的临时身份后缀；分段与完成消息共享同一基础标识，使折叠组件实例跨完成瞬间存活。
 */
const STREAM_MESSAGE_ID_SUFFIX = '#stream'

/**
 * @description 在会话消息尾部连续的 assistant 运行块中查找流式占位消息。
 * @param messages 当前会话消息列表。
 * @returns 处于 pending 或 streaming 状态的占位消息；没有进行中的回合时返回 null。
 */
function findInFlightAssistantMessage(messages: ConversationMessage[]): ConversationMessage | null {
  let index = messages.length - 1
  let inFlightMessage: ConversationMessage | null = null
  while (index >= 0 && messages[index].role === 'assistant') {
    if (messages[index].status === 'pending' || messages[index].status === 'streaming') {
      inFlightMessage = messages[index]
    }
    index -= 1
  }
  return inFlightMessage
}

type MessageArrivalTracker = {
  sessionId: string | null
  known: Set<string>
  arrivals: Set<string>
}

/**
 * @description 推进消息入场追踪：相对上一状态新出现的条目键记为待入场。
 * @param previous 当前追踪状态；首次为 null 时仅建立基线。
 * @param sessionId 当前会话标识；会话切换时重设基线，历史条目不播入场动画。
 * @param items 当前展示条目列表（消息与徽章）。
 * @returns 本次渲染的追踪状态；没有新条目时原样返回 previous 以保持引用稳定。
 * @remarks 纯函数，配合渲染期条件 setState 使用；行挂载或追踪状态更新时从 arrivals 消费键并播放入场动画，
 *   滚动导致的重新挂载因键已被消费而不会复播。
 */
function trackMessageArrivals(
  previous: MessageArrivalTracker | null,
  sessionId: string | null,
  items: readonly { key: string }[]
): MessageArrivalTracker {
  if (previous === null || previous.sessionId !== sessionId) {
    return { sessionId, known: new Set(items.map((item) => item.key)), arrivals: new Set() }
  }

  const known = new Set(previous.known)
  const arrivals = new Set<string>()
  for (const item of items) {
    if (!known.has(item.key)) {
      known.add(item.key)
      arrivals.add(item.key)
    }
  }

  if (arrivals.size === 0) {
    return previous
  }
  return { sessionId, known, arrivals }
}

export default function MessageList({
  messages,
  sessionId,
  sessionOwnerId,
  activateChar,
  participants,
  summaryAnchorMessageId,
  retryableMessageId,
  onRetryMessage,
  onEditMessage,
  isRetryDisabled
}: MessageListProps): ReactElement {
  const messageCollapseLineCount = useAppSettingsStore(
    (state) => state.settings.messageCollapseLineCount
  )
  const ttsEnabled = useAppSettingsStore((state) => state.settings.tts.enabled)
  // 语音输出生效时流式期间不渲染文字，占位三点动画持续到语音气泡就绪。
  const voiceOutputEnabled = useAppSettingsStore(
    (state) => state.settings.tts.enabled && state.settings.tts.autoSpeak
  )
  const [listApi, setListApi] = useListCallbackRef(null)
  const [speechState, setSpeechState] = useState<SpeechState>(null)
  const [speechError, setSpeechError] = useState<SpeechError | null>(null)
  const activeSynthesisRequestIdRef = useRef<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [arrivalTracker, setArrivalTracker] = useState<MessageArrivalTracker | null>(null)
  const providersStore = useProvidersStore((state) => state.store)
  const rowHeight = useDynamicRowHeight({
    defaultRowHeight: 80
  })
  // 流式表情合法集合按流式消息的发言角色缓存：群聊下各成员表情集不同，锚定首位参与者
  // 会把发言角色的合法标记误判为非法（预览丢失）或把非法标记放过（提交时被丢弃）。
  const [streamEmoticonCache, setStreamEmoticonCache] = useState<Record<string, string[]>>({})
  const inFlightMessage = findInFlightAssistantMessage(messages)
  const streamText = useStreamingStore((state) =>
    inFlightMessage ? state.streams[inFlightMessage.id]?.text : undefined
  )
  const isStreaming = Boolean(inFlightMessage && streamText)
  const streamSpeakerId = inFlightMessage?.senderId ?? activateChar?.id ?? null
  useEffect(() => {
    // 尚无发言角色或该角色集合已在缓存中时不做任何事，避免在 effect 内同步置空状态
    if (!streamSpeakerId || streamEmoticonCache[streamSpeakerId]) {
      return
    }
    let cancelled = false
    void getCharacterEmoticons(streamSpeakerId)
      .then((images) => {
        if (!cancelled) {
          setStreamEmoticonCache((prev) => ({
            ...prev,
            [streamSpeakerId]: images.map((item) => item.id)
          }))
        }
      })
      .catch((error) => {
        trackError(
          'load-stream-emoticons-failed',
          'Failed to load character emoticons for stream preview',
          error
        )
        if (!cancelled) {
          setStreamEmoticonCache((prev) => ({ ...prev, [streamSpeakerId]: [] }))
        }
      })
    return () => {
      cancelled = true
    }
  }, [streamSpeakerId, streamEmoticonCache])
  const streamingSegments = useMemo(() => {
    if (!inFlightMessage || !streamText || voiceOutputEnabled) return null
    // 与提交侧同一合法集合：只认当前发言角色表情，用户表情不在角色可输出范围内，避免流式期闪现后被提交丢弃。
    return splitStreamingAssistantMessageSegments(
      streamText,
      new Set(streamSpeakerId ? (streamEmoticonCache[streamSpeakerId] ?? []) : [])
    )
  }, [inFlightMessage, streamText, streamSpeakerId, streamEmoticonCache, voiceOutputEnabled])
  const displayMessages = useMemo(() => {
    if (!inFlightMessage || !streamingSegments || streamingSegments.length === 0) {
      return messages
    }
    const placeholderIndex = messages.indexOf(inFlightMessage)
    if (placeholderIndex === -1) {
      return messages
    }
    const streamedMessages = streamingSegments.map((segment) => ({
      ...inFlightMessage,
      id: `${inFlightMessage.id}${STREAM_MESSAGE_ID_SUFFIX}`,
      content: segment.type === 'text' ? segment.text : '',
      emoticonId: segment.type === 'emoticon' ? segment.emoticonId : undefined,
      status: 'streaming' as const
    }))
    const nextMessages = [...messages]
    nextMessages.splice(placeholderIndex, 1, ...streamedMessages)
    return nextMessages
  }, [messages, inFlightMessage, streamingSegments])
  const listItems = useMemo(
    () =>
      buildMessageListItems(displayMessages, {
        summaryAnchorMessageId,
        isGroup: participants.length > 1,
        retryableMessageId,
        resolveModelName: (modelId) => {
          const resolution = findProviderModel(providersStore, modelId)
          return resolution ? resolution.model.model || resolution.model.id : null
        },
        resolveSenderName: (senderId) => {
          const speaker =
            participants.find((participant) => participant.id === senderId) || activateChar
          return speaker?.name ?? null
        }
      }),
    [
      displayMessages,
      summaryAnchorMessageId,
      retryableMessageId,
      participants,
      activateChar,
      providersStore
    ]
  )
  // 徽章关闭记录跨会话与跨启动持久化：用户关闭过的提示不再随重开或重启复现。
  const dismissedKeys = useDismissedBadgesStore((state) => state.keys)
  const dismissedBadgeKeys = useMemo(() => new Set(dismissedKeys), [dismissedKeys])
  const dismissBadge = useDismissedBadgesStore((state) => state.dismissBadge)
  const visibleItems = useMemo(
    () => listItems.filter((item) => !dismissedBadgeKeys.has(item.key)),
    [listItems, dismissedBadgeKeys]
  )
  const lastVisibleMessage = displayMessages[displayMessages.length - 1] || null
  const nextArrivalTracker = trackMessageArrivals(arrivalTracker, sessionId, visibleItems)
  if (arrivalTracker !== nextArrivalTracker) {
    setArrivalTracker(nextArrivalTracker)
  }

  /**
   * @description 停止当前浏览器音频播放，并释放与该播放关联的状态。
   */
  const stopPlayback = useCallback((): void => {
    const audio = audioRef.current
    if (!audio) {
      return
    }

    audio.pause()
    audio.currentTime = 0
    audioRef.current = null
  }, [])

  /**
   * @description 停止正在运行的 TTS 合成或当前已经开始的音频播放。
   */
  const stopSpeech = useCallback((): void => {
    const requestId = activeSynthesisRequestIdRef.current
    activeSynthesisRequestIdRef.current = null
    stopPlayback()
    setSpeechState(null)

    if (requestId) {
      void cancel(requestId).catch((error: unknown) => {
        trackError('cancel-tts-failed', 'Failed to cancel TTS synthesis', error)
      })
    }
  }, [stopPlayback])

  /**
   * @description 播放一段已就绪的音频并维护全局播放状态。
   * @param messageId 正在播放的消息标识。
   * @param audioUrl 可播放的音频地址。
   * @remarks 全局同一时刻只保留一个音频实例；开始新播放前由调用方负责停止旧播放。
   */
  const startPlayback = useCallback((messageId: string, audioUrl: string): void => {
    const audio = new Audio(audioUrl)
    audioRef.current = audio
    setSpeechState({ messageId, phase: 'playing' })

    const stopWhenFinished = (): void => {
      if (audioRef.current !== audio) {
        return
      }
      audioRef.current = null
      setSpeechState(null)
    }
    audio.addEventListener('ended', stopWhenFinished, { once: true })
    audio.addEventListener(
      'error',
      () => {
        logTtsPlaybackFailure(audio, messageId)
        if (audioRef.current !== audio) {
          return
        }
        audioRef.current = null
        setSpeechState(null)
        setSpeechError({ messageId, message: '生成的音频无法播放。' })
      },
      { once: true }
    )
    void audio.play().catch((error: unknown) => {
      if (audioRef.current !== audio) {
        return
      }
      audioRef.current = null
      setSpeechState(null)
      setSpeechError({ messageId, message: getTtsErrorMessage(error) })
      trackError('play-tts-failed', 'Failed to play synthesized TTS audio', error)
    })
  }, [])

  /**
   * @description 为一条已完成的角色消息生成语音，或停止该消息当前的生成与播放。
   * @param message 用户点击语音控制按钮对应的角色消息。
   */
  const handleToggleSpeech = useCallback(
    (message: ConversationMessage): void => {
      const characterId = message.senderId
      if (!characterId) {
        return
      }

      if (speechState?.messageId === message.id) {
        stopSpeech()
        return
      }

      stopSpeech()
      const requestId = globalThis.crypto.randomUUID()
      activeSynthesisRequestIdRef.current = requestId
      setSpeechError(null)
      setSpeechState({ messageId: message.id, phase: 'synthesizing' })

      void synthesize({
        requestId,
        messageId: message.id,
        characterId,
        text: message.content
      })
        .then((result) => {
          if (activeSynthesisRequestIdRef.current !== requestId) {
            return
          }

          activeSynthesisRequestIdRef.current = null
          startPlayback(message.id, result.audioUrl)
        })
        .catch((error: unknown) => {
          if (activeSynthesisRequestIdRef.current !== requestId) {
            return
          }

          activeSynthesisRequestIdRef.current = null
          setSpeechState(null)
          setSpeechError({ messageId: message.id, message: getTtsErrorMessage(error) })
          trackError('synthesize-tts-failed', 'Failed to synthesize TTS audio', error)
        })
    },
    [speechState, startPlayback, stopSpeech]
  )

  /**
   * @description 播放或停止一条语音气泡消息的就绪音频。
   * @param message 用户点击语音气泡对应的角色消息。
   * @remarks 音频已由自动合成产出，这里不再请求合成，直接复用全局播放实例。
   */
  const handleToggleVoiceMessage = useCallback(
    (message: ConversationMessage): void => {
      const entry = useVoiceOutputStore.getState().entries[message.id]
      if (!entry?.audioUrl) {
        return
      }

      if (speechState?.messageId === message.id) {
        stopSpeech()
        return
      }

      stopSpeech()
      startPlayback(message.id, entry.audioUrl)
    },
    [speechState, startPlayback, stopSpeech]
  )

  useEffect(() => {
    return () => {
      const requestId = activeSynthesisRequestIdRef.current
      activeSynthesisRequestIdRef.current = null
      stopPlayback()

      if (requestId) {
        void cancel(requestId).catch((error: unknown) => {
          trackError(
            'cancel-tts-cleanup-failed',
            'Failed to cancel TTS synthesis during cleanup',
            error
          )
        })
      }
    }
  }, [stopPlayback])

  /** 已完成「绘制前瞬时到底」定位的会话标识；会话无消息或未选择时归零。 */
  const entryScrollSessionRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    if (!listApi || !sessionId || visibleItems.length === 0) {
      entryScrollSessionRef.current = null
      return
    }
    if (entryScrollSessionRef.current === sessionId) {
      return
    }
    entryScrollSessionRef.current = sessionId
    // 绘制前按估算行高瞬时定位到底部，激活会话的全量快照是异步换入的，
    // 若等绘制后再滚会先看到顶部再平滑滑落；行高实测后的校正由下方滚动效果以瞬时模式收尾。
    listApi.scrollToRow({ align: 'end', behavior: 'auto', index: visibleItems.length - 1 })
  }, [listApi, sessionId, visibleItems.length])

  /** 已被滚动效果处理过所属会话的标识；用于区分会话进入与新消息推进。 */
  const followScrollSessionRef = useRef<string | null>(null)

  useEffect(() => {
    if (!listApi || visibleItems.length === 0) {
      followScrollSessionRef.current = null
      return
    }

    const isSessionEntry = sessionId !== followScrollSessionRef.current
    followScrollSessionRef.current = sessionId
    const frameId = window.requestAnimationFrame(() => {
      listApi.scrollToRow({
        align: 'end',
        behavior: isSessionEntry || isStreaming ? 'auto' : 'smooth',
        index: visibleItems.length - 1
      })
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [
    lastVisibleMessage?.content,
    lastVisibleMessage?.id,
    listApi,
    visibleItems.length,
    isStreaming,
    sessionId
  ])

  return (
    <List
      listRef={setListApi}
      style={{ paddingBottom: 60, boxSizing: 'border-box' }}
      rowComponent={MessageListRow}
      rowCount={visibleItems.length}
      rowHeight={rowHeight}
      rowProps={{
        items: visibleItems,
        sessionId,
        sessionOwnerId,
        activateChar,
        participants,
        retryableMessageId,
        onRetryMessage,
        onEditMessage,
        isRetryDisabled,
        speechState,
        speechError,
        onToggleSpeech: handleToggleSpeech,
        onToggleVoiceMessage: handleToggleVoiceMessage,
        messageCollapseLineCount,
        ttsEnabled,
        arrivalTracker: nextArrivalTracker,
        onDismissBadge: dismissBadge
      }}
    />
  )
}
