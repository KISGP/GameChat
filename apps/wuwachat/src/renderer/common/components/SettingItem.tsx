import { type ReactElement, type ReactNode, useRef, useState } from 'react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@renderer/common/components/collapsible'
import { useCollapseTween } from '@renderer/common/hooks/useCollapseTween'
import { cn } from '@renderer/common/lib/cn'

type SettingItemProps = {
  title: string
  // 标题下方常显的说明文本；缺省时不占位。
  description?: ReactNode
  expandedItems?: ReactNode[]
  children?: ReactNode
  // 可选受控展开状态；提供后折叠区开合完全由调用方决定，内部状态不再参与。
  open?: boolean
  // 折叠区开合变化回调，与 open 成对提供。
  onOpenChange?: (open: boolean) => void
}

/**
 * @description 渲染带有可选控制器和可折叠详情项的设置条目。
 * @param props 设置条目标题、常显说明、展开内容、控制器与可选受控开合。
 * @returns 设置条目。
 */
export function SettingItem({
  title,
  description,
  expandedItems = [],
  children,
  open,
  onOpenChange
}: SettingItemProps): ReactElement {
  const [isOpenExpanded, setIsOpenExpanded] = useState(false)
  const hasExpandableContent = expandedItems.length > 0
  const isControlled = open !== undefined
  const expandedOpen = hasExpandableContent
    ? ((isControlled ? open : isOpenExpanded) ?? false)
    : false
  const contentRef = useRef<HTMLDivElement>(null)

  useCollapseTween(contentRef, expandedOpen)

  /**
   * @description 响应折叠区开合变化，未受控时同步内部状态，并转发调用方回调。
   * @param nextOpen 目标开合状态。
   * @returns 无返回值。
   */
  const handleOpenChange = (nextOpen: boolean): void => {
    if (!isControlled) {
      setIsOpenExpanded(nextOpen)
    }
    onOpenChange?.(nextOpen)
  }

  return (
    <Collapsible
      open={expandedOpen}
      onOpenChange={hasExpandableContent ? handleOpenChange : undefined}
    >
      <div className="relative rounded border-2 border-[rgb(40,40,40)] hover:border-[#e8c690] p-px">
        <div className="flex size-full items-center justify-between rounded bg-[rgb(4,4,4,0.5)] px-6 py-2">
          {hasExpandableContent ? (
            <div className="min-w-0 flex-1">
              <CollapsibleTrigger asChild>
                <h3
                  className={cn(
                    'block w-full text-left text-lg font-medium text-white',
                    description ? 'pt-2' : 'py-2'
                  )}
                >
                  {title}
                </h3>
              </CollapsibleTrigger>
              {description && (
                <p className="pb-2 text-sm text-white/55">{description}</p>
              )}
            </div>
          ) : (
            <div className="min-w-0 flex-1">
              <h3
                className={cn(
                  'text-lg font-medium text-white',
                  description ? 'pt-2' : 'py-2'
                )}
              >
                {title}
              </h3>
              {description && (
                <p className="pb-2 text-sm text-white/55">{description}</p>
              )}
            </div>
          )}

          {children && <div className="relative z-10 shrink-0">{children}</div>}
        </div>
      </div>

      {hasExpandableContent && (
        <CollapsibleContent ref={contentRef} forceMount>
          <div className="mx-2 space-y-1">
            {expandedItems.map((item, index) => (
              <div
                key={index}
                className="rounded-xs bg-black/50 px-4 py-1 text-sm"
              >
                {item}
              </div>
            ))}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  )
}
