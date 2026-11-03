import { useRef, type ReactElement, type ReactNode } from 'react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@renderer/common/components/collapsible'
import { useCollapseTween } from '@renderer/common/hooks/useCollapseTween'
import { cn } from '@renderer/common/lib/cn'

type CharacterAccordionCardProps = {
  /** 角色显示名。 */
  name: string
  /** 头像图片地址；缺省时显示名字首字。 */
  avatar?: string
  /** 卡面立绘地址，铺在卡片右侧背景；缺省时无立绘。 */
  cardBg?: string
  /** 名字下方的描述行；缺省时不占位。 */
  description?: string
  /** 表头右侧动作区（下载状态、按钮组等）。 */
  headerExtra?: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 展开面板内容，由调用方自组。 */
  children: ReactNode
}

/**
 * @description 角色手风琴卡片公共外壳：头像圆框、名字与描述行、卡面立绘、右侧动作插槽、
 *   悬停描边与展开动画，展开面板内容由 children 自组。
 * @param name 角色显示名。
 * @param avatar 头像地址。
 * @param cardBg 卡面立绘地址。
 * @param description 描述行文本。
 * @param headerExtra 表头右侧动作区。
 * @param open 是否展开（单开状态由页面自持）。
 * @param onOpenChange 展开状态回调。
 * @param children 展开面板内容。
 * @returns 手风琴卡片元素。
 * @remarks 角色设置、记忆、语音三页共用本外壳；页面各自持有单开状态，外壳不维护列表状态。
 */
export function CharacterAccordionCard({
  name,
  avatar,
  cardBg,
  description,
  headerExtra,
  open,
  onOpenChange,
  children
}: CharacterAccordionCardProps): ReactElement {
  const contentRef = useRef<HTMLDivElement>(null)
  const contentBodyRef = useRef<HTMLDivElement>(null)

  useCollapseTween(contentRef, open, contentBodyRef)

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className="relative overflow-hidden rounded p-px transition-colors hover:border-[#e8c690]">
        <div className="relative flex items-stretch rounded bg-[rgb(4,4,4,0.5)]">
          {cardBg && (
            <img
              src={cardBg}
              alt=""
              className={cn(
                'pointer-events-none absolute inset-y-0 right-0 h-full object-cover transition-opacity hover:opacity-70',
                open ? 'opacity-100' : 'opacity-35'
              )}
              draggable={false}
            />
          )}
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="relative z-10 flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
            >
              <div className="size-10 shrink-0 overflow-hidden rounded-full border border-white/20 bg-black/50">
                {avatar ? (
                  <img src={avatar} alt="" className="size-full object-cover" />
                ) : (
                  <div className="flex size-full items-center justify-center text-sm text-white/50">
                    {name.slice(0, 1)}
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <div className="truncate text-base font-medium text-white/90">{name}</div>
                {description && (
                  <div className="mt-1 truncate text-xs text-white/50">{description}</div>
                )}
              </div>
            </button>
          </CollapsibleTrigger>
          {headerExtra && (
            <div className="relative z-10 flex shrink-0 items-center gap-2 px-3">{headerExtra}</div>
          )}
        </div>
      </div>

      <CollapsibleContent ref={contentRef} className="overflow-hidden" forceMount>
        <div ref={contentBodyRef}>
          <div className="mx-2 space-y-3 rounded-xs bg-black/50 p-4">{children}</div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
