import type { ReactElement } from 'react'
import { CircleAlert, RotateCcw } from 'lucide-react'
import type { ConversationMessage } from '@gamechat/type'
import { Bubble, BubbleContent, BubbleTail } from '@renderer/common/components/bubble'
import { cn } from '@renderer/common/lib/cn'
import { useMotionPreference } from '@renderer/app/hooks/useMotionPreference'
import type { VoiceMessageEntry } from '../store/voice'
import { useVoiceOutputStore } from '../store/voice'
import { useAudioDuration } from '../hooks/use-audio-duration'

type VoiceMessageBubbleProps = {
  message: ConversationMessage
  entry: VoiceMessageEntry
  // 该消息的语音是否正在播放。
  isPlaying: boolean
  // 点击气泡切换播放的回调。
  onTogglePlay: () => void
}

const readyContentClassName =
  'h-12 w-30 items-center rounded-tl-none rounded-tr-md rounded-br-xl rounded-bl-md bg-white px-4 py-3 text-[#333]'
const errorContentClassName =
  'min-h-12 items-center gap-3 rounded-tl-none rounded-tr-md rounded-br-xl rounded-bl-md bg-white px-5 py-3 text-[#333]'

/**
 * @description 渲染躺倒 Wi-Fi 造型的声波图标，圆点在左、三段弧线朝右展开。
 * @param playing 是否正在播放；播放中且未关闭动效时弧线自内向外依次脉动。
 * @returns 声波图标元素。
 */
function VoiceWaveIcon({ playing }: { playing: boolean }): ReactElement {
  const { shouldAnimate } = useMotionPreference()
  const animate = playing && shouldAnimate

  return (
    <svg
      viewBox="0 0 20 20"
      className="size-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx={3.8} cy={10} r={1.4} fill="currentColor" stroke="none" />
      <path
        d="M6.8 7.6a2.4 2.4 0 0 1 0 4.8"
        className={cn(animate && 'animate-[voice-wave-pulse_0.9s_ease-in-out_infinite]')}
      />
      <path
        d="M9.4 5.4a4.6 4.6 0 0 1 0 9.2"
        className={cn(
          animate && 'animate-[voice-wave-pulse_0.9s_ease-in-out_infinite] [animation-delay:0.15s]'
        )}
      />
      <path
        d="M12 3.2a6.8 6.8 0 0 1 0 13.6"
        className={cn(
          animate && 'animate-[voice-wave-pulse_0.9s_ease-in-out_infinite] [animation-delay:0.3s]'
        )}
      />
    </svg>
  )
}

/**
 * @description 以微信语音样式呈现一条已完成语音合成的角色消息：整块气泡是播放控件，
 *   声波弧线在播放中依次脉动，秒数在音频元数据就绪后显示。
 * @param message 语音气泡对应的角色消息。
 * @param entry 该消息的语音输出状态。
 * @param isPlaying 该消息的语音是否正在播放。
 * @param onTogglePlay 点击气泡切换播放的回调。
 * @returns 语音气泡元素。
 * @remarks 失败态在气泡内保留失败原因与重试按钮；秒数在元数据不可读时留空，不显示占位。
 */
export function VoiceMessageBubble({
  message,
  entry,
  isPlaying,
  onTogglePlay
}: VoiceMessageBubbleProps): ReactElement {
  const retrySynthesis = useVoiceOutputStore((state) => state.retrySynthesis)
  const hasError = entry.status === 'error'
  const duration = useAudioDuration(hasError ? null : entry.audioUrl)
  const secondsText = duration === null ? '' : `${Math.max(1, Math.round(duration))}″`

  return (
    <Bubble
      align="start"
      variant="chat"
      className="max-w-md drop-shadow-[0_1px_2px_rgba(0,0,0,0.05)] filter"
    >
      <BubbleTail />
      <BubbleContent
        className={cn('flex', hasError ? errorContentClassName : readyContentClassName)}
      >
        {hasError ? (
          <>
            <CircleAlert size={16} className="shrink-0 text-red-500" />
            <span
              className="max-w-56 truncate text-sm text-red-500"
              title={entry.error ?? undefined}
            >
              {entry.error}
            </span>
            <button
              type="button"
              onClick={() => retrySynthesis(message)}
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:text-[#333]"
              title="重试语音生成"
              aria-label="重试语音生成"
            >
              <RotateCcw size={15} />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onTogglePlay}
            className="flex h-full w-full items-center gap-2.5 text-left transition-opacity hover:opacity-75"
            title={isPlaying ? '停止播放' : '播放语音'}
            aria-label={isPlaying ? '停止播放' : '播放语音'}
          >
            <VoiceWaveIcon playing={isPlaying} />
            {secondsText && (
              <span className="text-[15px] font-medium tabular-nums select-text">
                {secondsText}
              </span>
            )}
          </button>
        )}
      </BubbleContent>
    </Bubble>
  )
}
