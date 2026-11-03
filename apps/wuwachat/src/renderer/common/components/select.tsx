import * as React from 'react'
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-react'
import { buttonVariants } from '@renderer/common/components/button'
import { usePressScale } from '@renderer/common/hooks/usePressScale'
import {
  Select as SelectPrimitive,
  SelectContent as SelectContentPrimitive,
  SelectGroup as SelectGroupPrimitive,
  SelectPortal as SelectPortalPrimitive,
  SelectItem as SelectItemPrimitive,
  SelectLabel as SelectLabelPrimitive,
  SelectScrollDownButton as SelectScrollDownButtonPrimitive,
  SelectScrollUpButton as SelectScrollUpButtonPrimitive,
  SelectTrigger as SelectTriggerPrimitive,
  SelectValue as SelectValuePrimitive,
  SelectViewport as SelectViewportPrimitive,
  SelectIcon as SelectIconPrimitive,
  SelectItemIndicator as SelectItemIndicatorPrimitive,
  SelectSeparator as SelectSeparatorPrimitive,
  SelectItemText as SelectItemTextPrimitive
} from '@radix-ui/react-select'

import { cn } from '@renderer/common/lib/cn'

/**
 * @description 渲染受控的 Select 根节点。
 * @param props 透传给 Radix Select Root 的属性。
 * @returns Select 根节点。
 */
function Select({ ...props }: React.ComponentProps<typeof SelectPrimitive>) {
  return <SelectPrimitive data-slot="select" {...props} />
}

/**
 * @description 渲染 Select 的分组选项容器。
 * @param props 透传给分组节点的属性。
 * @returns Select 选项分组。
 */
function SelectGroup({ className, ...props }: React.ComponentProps<typeof SelectGroupPrimitive>) {
  return (
    <SelectGroupPrimitive
      data-slot="select-group"
      className={cn('scroll-my-1 p-1', className)}
      {...props}
    />
  )
}

/**
 * @description 渲染 Select 当前值占位区域。
 * @param props 透传给值节点的属性。
 * @returns Select 当前值节点。
 */
function SelectValue({ ...props }: React.ComponentProps<typeof SelectValuePrimitive>) {
  return <SelectValuePrimitive data-slot="select-value" {...props} />
}

/**
 * @description 渲染符合项目视觉风格的 Select 触发器。
 * @param props 透传给触发器节点的属性。
 * @returns Select 触发器。
 * @remarks 触发器整体是 Radix 渲染的 button；下拉箭头为按钮形态的装饰元素，hover 底块、展开高亮与按压缩放分别由触发器悬停、aria-expanded 与 usePressScale 驱动，点击仍由触发器统一承接，内部不嵌套 button。
 */
function SelectTrigger({
  className,
  size = 'default',
  children,
  ...props
}: React.ComponentProps<typeof SelectTriggerPrimitive> & {
  size?: 'sm' | 'default'
}): React.ReactElement {
  const chevronRef = React.useRef<HTMLSpanElement | null>(null)
  usePressScale(chevronRef)

  return (
    <SelectTriggerPrimitive
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        'group/trigger flex w-fit items-center justify-between gap-2 rounded border border-white/15 bg-black/35 py-2 pr-3 pl-3 text-sm whitespace-nowrap text-white transition-colors outline-none select-none hover:bg-black/45 focus-visible:border-[#e8c690] focus-visible:ring-1 focus-visible:ring-[#e8c690]/35 disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-white/35 data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
        className
      )}
      {...props}
    >
      {children}
      <SelectIconPrimitive asChild>
        <span
          ref={chevronRef}
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
            'group-aria-expanded/trigger:bg-foreground/10 group-aria-expanded/trigger:text-foreground text-white/45 hover:text-white/80'
          )}
        >
          <ChevronDownIcon className="size-4" />
        </span>
      </SelectIconPrimitive>
    </SelectTriggerPrimitive>
  )
}

/**
 * @description 渲染 Select 下拉面板与视口。
 * @param props 透传给内容节点的属性。
 * @returns Select 下拉面板。
 */
function SelectContent({
  className,
  children,
  position = 'popper',
  align = 'center',
  ...props
}: React.ComponentProps<typeof SelectContentPrimitive>) {
  return (
    <SelectPortalPrimitive>
      <SelectContentPrimitive
        data-slot="select-content"
        data-align-trigger={position === 'item-aligned'}
        className={cn(
          'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 relative z-300 max-h-(--radix-select-content-available-height) min-w-44 overflow-hidden rounded-lg border-2 border-[rgb(51,51,51)] bg-[rgba(8,8,8,0.96)] text-white shadow-[0_14px_32px_rgba(0,0,0,0.45)] ring-1 ring-white/5 backdrop-blur-sm duration-100 data-[align-trigger=true]:animate-none',
          position === 'popper' &&
            'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
          className
        )}
        position={position}
        align={align}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectViewportPrimitive
          data-position={position}
          className={cn(
            'p-1 data-[position=popper]:w-full data-[position=popper]:min-w-(--radix-select-trigger-width)',
            position === 'popper' && ''
          )}
        >
          {children}
        </SelectViewportPrimitive>
        <SelectScrollDownButton />
      </SelectContentPrimitive>
    </SelectPortalPrimitive>
  )
}

/**
 * @description 渲染 Select 分组标签。
 * @param props 透传给标签节点的属性。
 * @returns Select 分组标签。
 */
function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectLabelPrimitive>) {
  return (
    <SelectLabelPrimitive
      data-slot="select-label"
      className={cn('px-2 py-1 text-xs text-white/45', className)}
      {...props}
    />
  )
}

/**
 * @description 渲染项目风格的 Select 选项。
 * @param props 透传给选项节点的属性。
 * @returns Select 单个选项。
 */
function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectItemPrimitive>) {
  return (
    <SelectItemPrimitive
      data-slot="select-item"
      className={cn(
        'relative flex w-full cursor-default items-start gap-2 rounded-sm border border-transparent px-2 py-2 pr-8 text-sm text-white/78 outline-hidden transition-colors select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:border-[#e8c690]/35 data-[highlighted]:bg-[#e8c690]/10 data-[highlighted]:text-[#f2dfbd] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2',
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute top-2.5 right-2 flex size-4 items-center justify-center text-[#e8c690]">
        <SelectItemIndicatorPrimitive>
          <CheckIcon className="pointer-events-none" />
        </SelectItemIndicatorPrimitive>
      </span>
      <SelectItemTextPrimitive>{children}</SelectItemTextPrimitive>
    </SelectItemPrimitive>
  )
}

/**
 * @description 渲染 Select 分隔线。
 * @param props 透传给分隔线节点的属性。
 * @returns Select 分隔线。
 */
function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectSeparatorPrimitive>) {
  return (
    <SelectSeparatorPrimitive
      data-slot="select-separator"
      className={cn('pointer-events-none -mx-1 my-1 h-px bg-white/8', className)}
      {...props}
    />
  )
}

/**
 * @description 渲染向上滚动按钮。
 * @param props 透传给滚动按钮节点的属性。
 * @returns Select 向上滚动按钮。
 */
function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectScrollUpButtonPrimitive>) {
  return (
    <SelectScrollUpButtonPrimitive
      data-slot="select-scroll-up-button"
      className={cn(
        'z-10 flex cursor-default items-center justify-center border-b border-white/8 bg-black/95 py-1 text-white/45 [&_svg:not([class*="size-"])]:size-4',
        className
      )}
      {...props}
    >
      <ChevronUpIcon />
    </SelectScrollUpButtonPrimitive>
  )
}

/**
 * @description 渲染向下滚动按钮。
 * @param props 透传给滚动按钮节点的属性。
 * @returns Select 向下滚动按钮。
 */
function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectScrollDownButtonPrimitive>) {
  return (
    <SelectScrollDownButtonPrimitive
      data-slot="select-scroll-down-button"
      className={cn(
        'z-10 flex cursor-default items-center justify-center border-t border-white/8 bg-black/95 py-1 text-white/45 [&_svg:not([class*="size-"])]:size-4',
        className
      )}
      {...props}
    >
      <ChevronDownIcon />
    </SelectScrollDownButtonPrimitive>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue
}
