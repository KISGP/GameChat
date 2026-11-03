import { useRef, type ReactElement } from 'react'
import { useAppearanceStore } from '../store/appearance'
import {
  BUBBLE_STYLES,
  BOZAI_BUBBLE_ID,
  BOZAI_TEXT_COLOR,
  DAWEI_BUBBLE_ID,
  XINYUEHU_BUBBLE_ID
} from '../bubbles/catalog'
import { UserBubbleFrame } from '../bubbles/render/UserBubbleFrame'
import { Bubble, BubbleContent, BubbleTail } from '@renderer/common/components/bubble'
import { cn } from '@renderer/common/lib/cn'

/** 详情区演示气泡使用的示例文本。 */
const DEMO_TEXT = '或者……我们去做点开心的事？骑摩托兜风、看电影、打游戏都行~'

export default function BubbleSelector(): ReactElement {
  const bubbleId = useAppearanceStore((state) => state.appearance.bubbleId)
  const setBubbleId = useAppearanceStore((state) => state.setBubbleId)
  const activeStyle = BUBBLE_STYLES.find((style) => style.id === bubbleId) ?? BUBBLE_STYLES[0]
  const isFoxStyle = activeStyle.id === XINYUEHU_BUBBLE_ID
  const isDaweiStyle = activeStyle.id === DAWEI_BUBBLE_ID
  const isBozaiStyle = activeStyle.id === BOZAI_BUBBLE_ID
  const spineFrame = isFoxStyle || isDaweiStyle || isBozaiStyle
  const demoBubbleRef = useRef<HTMLDivElement | null>(null)

  return (
    <div className="flex h-full w-full gap-8">
      <div className="my-2 grid h-fit shrink-0 grid-cols-2 gap-2">
        {BUBBLE_STYLES.map((style) => (
          <button
            key={style.id}
            type="button"
            className={cn(
              'group relative overflow-hidden rounded-md border-2 transition-all',
              activeStyle.id === style.id
                ? 'border-amber-200 shadow-[0_0_0_1px_rgba(253,230,138,0.5)]'
                : 'border-white/20 hover:border-amber-200/70'
            )}
            onClick={() => setBubbleId(style.id)}
          >
            <img
              src={style.previewSrc}
              alt={style.name}
              className="h-18 w-46 object-cover transition-transform duration-200 group-hover:scale-[1.02]"
            />
          </button>
        ))}
      </div>
      <div className="flex-1 text-white">
        <p className="my-2">{activeStyle.name}</p>
        <div className="relative inline-block h-96 w-160 overflow-hidden rounded-md bg-black/20">
          <div className="absolute inset-x-10 top-16 flex justify-end">
            <Bubble ref={demoBubbleRef} align="end" variant="chat" className="max-w-md">
              {spineFrame ? null : <BubbleTail />}
              <BubbleContent
                className={cn(
                  'relative z-30 rounded-tl-md rounded-tr-none rounded-br-md rounded-bl-xl',
                  !isBozaiStyle && 'text-white',
                  !spineFrame && 'bg-[#393C4B]'
                )}
                style={isBozaiStyle ? { color: BOZAI_TEXT_COLOR } : undefined}
              >
                {DEMO_TEXT}
              </BubbleContent>
              {spineFrame && <UserBubbleFrame bubbleId={activeStyle.id} boxRef={demoBubbleRef} />}
            </Bubble>
          </div>
        </div>

        <p className="mb-2 border-b border-white/20 pt-2 pb-1">{activeStyle.description}</p>
        <p className="text-xs text-gray-300/80">{activeStyle.obtained}</p>
      </div>
    </div>
  )
}
