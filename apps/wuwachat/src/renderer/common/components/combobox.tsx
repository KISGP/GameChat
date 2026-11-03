'use client'

import * as React from 'react'
import { Combobox as ComboboxPrimitive } from '@base-ui/react'
import { cn } from '@renderer/common/lib/cn'
import { CheckIcon, ChevronDownIcon, XIcon } from 'lucide-react'

import { Button } from '@renderer/common/components/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput
} from '@renderer/common/components/input-group'

/** Base UI Combobox 根节点，按原样透传泛型组件本体。 */
const Combobox = ComboboxPrimitive.Root

/**
 * @description 渲染 Combobox 当前值显示区。
 * @param props 透传给 Base UI Combobox Value 的属性。
 * @returns Combobox 值显示节点。
 */
function ComboboxValue({ ...props }: ComboboxPrimitive.Value.Props): React.JSX.Element {
  return <ComboboxPrimitive.Value data-slot="combobox-value" {...props} />
}

/**
 * @description 渲染 Combobox 触发器，默认附带下拉箭头。
 * @param props 透传给 Base UI Combobox Trigger 的属性，支持 render 复合到自定义元素。
 * @returns Combobox 触发器。
 */
function ComboboxTrigger({
  className,
  children,
  ...props
}: ComboboxPrimitive.Trigger.Props): React.JSX.Element {
  return (
    <ComboboxPrimitive.Trigger
      data-slot="combobox-trigger"
      className={cn("[&_svg:not([class*='size-'])]:size-4", className)}
      {...props}
    >
      {children}
      <ChevronDownIcon className="pointer-events-none size-4 text-white/45" />
    </ComboboxPrimitive.Trigger>
  )
}

/**
 * @description 渲染 Combobox 的清空按钮。
 * @param props 透传给 Base UI Combobox Clear 的属性。
 * @returns Combobox 清空按钮。
 */
function ComboboxClear({ className, ...props }: ComboboxPrimitive.Clear.Props): React.JSX.Element {
  return (
    <ComboboxPrimitive.Clear
      data-slot="combobox-clear"
      className={cn(className)}
      {...props}
      render={
        <InputGroupButton variant="ghost" size="icon-xs" className="hover:bg-white/10">
          <XIcon className="pointer-events-none" />
        </InputGroupButton>
      }
    />
  )
}

/**
 * @description 渲染 Combobox 输入框，可选附带触发箭头与清空按钮。
 * @param props 透传给 Base UI Combobox Input 的属性。
 * @param props.showTrigger 是否在输入框尾部显示下拉触发箭头。
 * @param props.showClear 是否在输入框尾部显示清空按钮。
 * @returns Combobox 输入框。
 * @remarks 输入框基于 InputGroup 组合，宽度与高度由调用方通过 className 覆盖。
 */
function ComboboxInput({
  className,
  children,
  disabled = false,
  showTrigger = true,
  showClear = false,
  ...props
}: ComboboxPrimitive.Input.Props & {
  showTrigger?: boolean
  showClear?: boolean
}): React.JSX.Element {
  return (
    <InputGroup className={cn('w-auto', className)}>
      <ComboboxPrimitive.Input render={<InputGroupInput disabled={disabled} />} {...props} />
      <InputGroupAddon align="inline-end">
        {showTrigger && (
          <ComboboxTrigger
            render={
              <InputGroupButton
                size="icon-xs"
                variant="ghost"
                data-slot="input-group-button"
                className="group-has-data-[slot=combobox-clear]/input-group:hidden data-pressed:bg-transparent hover:bg-white/10"
                disabled={disabled}
              />
            }
          />
        )}
        {showClear && <ComboboxClear disabled={disabled} />}
      </InputGroupAddon>
      {children}
    </InputGroup>
  )
}

/**
 * @description 渲染 Combobox 下拉面板：portal 定位并跟随锚点宽度。
 * @param props 透传给 Base UI Combobox Popup 的属性。
 * @param props.side 弹出方向，默认底部。
 * @param props.sideOffset 与锚点的间距，默认 6px。
 * @param props.align 对齐方式，默认起始边对齐。
 * @param props.alignOffset 对齐偏移，默认 0。
 * @param props.anchor 自定义定位锚点。
 * @returns Combobox 下拉面板。
 * @remarks 面板经 Positioner 定位到触发元素，超出可用空间时自动翻转，不会被滚动容器裁剪。
 *   面板 portal 到 document.body，DOM 上落在 Radix 模态弹窗的内容区外，弹窗的滚动隔离会在
 *   document 上取消这类目标的滚轮默认行为；面板吞掉滚轮冒泡，让列表按浏览器原生滚动处理。
 */
function ComboboxContent({
  className,
  side = 'bottom',
  sideOffset = 6,
  align = 'start',
  alignOffset = 0,
  anchor,
  onWheel,
  onTouchMove,
  ...props
}: ComboboxPrimitive.Popup.Props &
  Pick<
    ComboboxPrimitive.Positioner.Props,
    'side' | 'align' | 'sideOffset' | 'alignOffset' | 'anchor'
  >): React.JSX.Element {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="pointer-events-auto isolate z-300"
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          data-chips={!!anchor}
          className={cn(
            'group/combobox-content border-2 border-[rgb(51,51,51)] bg-[rgba(8,8,8,0.96)] text-white shadow-[0_14px_32px_rgba(0,0,0,0.45)] ring-1 ring-white/5 backdrop-blur-sm data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 *:data-[slot=input-group]:border-white/10 *:data-[slot=input-group]:bg-black/20 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 relative max-h-(--available-height) w-(--anchor-width) max-w-(--available-width) min-w-[calc(var(--anchor-width)+--spacing(7))] origin-(--transform-origin) overflow-hidden rounded-lg duration-100 data-[chips=true]:min-w-(--anchor-width) *:data-[slot=input-group]:m-1 *:data-[slot=input-group]:mb-0 *:data-[slot=input-group]:h-8 *:data-[slot=input-group]:shadow-none',
            className
          )}
          {...props}
          onWheel={(event) => {
            onWheel?.(event)
            event.stopPropagation()
          }}
          onTouchMove={(event) => {
            onTouchMove?.(event)
            event.stopPropagation()
          }}
        />
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  )
}

/**
 * @description 渲染 Combobox 选项列表容器，超出高度时内部滚动。
 * @param props 透传给 Base UI Combobox List 的属性，children 支持按 items 渲染的函数。
 * @returns Combobox 选项列表。
 */
function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props): React.JSX.Element {
  return (
    <ComboboxPrimitive.List
      data-slot="combobox-list"
      className={cn(
        'no-scrollbar max-h-[min(calc(--spacing(72)---spacing(9)),calc(var(--available-height)---spacing(9)))] scroll-py-1 overflow-y-auto overscroll-contain p-1 data-empty:p-0',
        className
      )}
      {...props}
    />
  )
}

/**
 * @description 渲染 Combobox 单个选项，选中时在行尾显示勾标。
 * @param props 透传给 Base UI Combobox Item 的属性。
 * @returns Combobox 选项。
 */
function ComboboxItem({
  className,
  children,
  ...props
}: ComboboxPrimitive.Item.Props): React.JSX.Element {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        'data-highlighted:border-[#e8c690]/35 data-highlighted:bg-[#e8c690]/10 data-highlighted:text-[#f2dfbd] relative flex w-full cursor-default items-center gap-2 rounded-sm border border-transparent px-2 py-2 pr-8 text-sm text-white/78 outline-hidden transition-colors select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=\'size-\'])]:size-4',
        className
      )}
      {...props}
    >
      {children}
      <ComboboxPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute top-2.5 right-2 flex size-4 items-center justify-center text-[#e8c690]">
            <CheckIcon className="pointer-events-none" />
          </span>
        }
      />
    </ComboboxPrimitive.Item>
  )
}

/**
 * @description 渲染 Combobox 选项分组容器。
 * @param props 透传给 Base UI Combobox Group 的属性。
 * @returns Combobox 选项分组。
 */
function ComboboxGroup({ className, ...props }: ComboboxPrimitive.Group.Props): React.JSX.Element {
  return <ComboboxPrimitive.Group data-slot="combobox-group" className={cn(className)} {...props} />
}

/**
 * @description 渲染 Combobox 选项分组的标题。
 * @param props 透传给 Base UI Combobox GroupLabel 的属性。
 * @returns Combobox 分组标题。
 */
function ComboboxLabel({
  className,
  ...props
}: ComboboxPrimitive.GroupLabel.Props): React.JSX.Element {
  return (
    <ComboboxPrimitive.GroupLabel
      data-slot="combobox-label"
      className={cn('px-2 py-1.5 text-xs text-white/45', className)}
      {...props}
    />
  )
}

/**
 * @description 渲染 Combobox 集合占位节点，供 Chip 等游离元素挂载选项注册。
 * @param props 透传给 Base UI Combobox Collection 的属性。
 * @returns Combobox 集合节点。
 */
function ComboboxCollection({
  ...props
}: ComboboxPrimitive.Collection.Props): React.JSX.Element {
  return <ComboboxPrimitive.Collection data-slot="combobox-collection" {...props} />
}

/**
 * @description 渲染 Combobox 无匹配选项时的空态提示。
 * @param props 透传给 Base UI Combobox Empty 的属性。
 * @returns Combobox 空态提示。
 */
function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props): React.JSX.Element {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cn(
        'hidden w-full justify-center py-2 text-center text-sm text-white/45 group-data-empty/combobox-content:flex',
        className
      )}
      {...props}
    />
  )
}

/**
 * @description 渲染 Combobox 选项分隔线。
 * @param props 透传给 Base UI Combobox Separator 的属性。
 * @returns Combobox 分隔线。
 */
function ComboboxSeparator({
  className,
  ...props
}: ComboboxPrimitive.Separator.Props): React.JSX.Element {
  return (
    <ComboboxPrimitive.Separator
      data-slot="combobox-separator"
      className={cn('bg-white/8 -mx-1 my-1 h-px', className)}
      {...props}
    />
  )
}

/**
 * @description 渲染多选 Combobox 的已选值 Chips 容器。
 * @param props 透传给 Base UI Combobox Chips 的属性。
 * @returns Combobox Chips 容器。
 */
function ComboboxChips({
  className,
  ...props
}: React.ComponentPropsWithRef<typeof ComboboxPrimitive.Chips> &
  ComboboxPrimitive.Chips.Props): React.JSX.Element {
  return (
    <ComboboxPrimitive.Chips
      data-slot="combobox-chips"
      className={cn(
        'border-white/15 bg-black/20 transition-colors focus-within:border-[#e8c690] focus-within:ring-[#e8c690]/35 focus-within:ring-3 has-aria-invalid:border-red-400/60 has-aria-invalid:ring-red-400/25 has-aria-invalid:ring-3 flex min-h-8 flex-wrap items-center gap-1 rounded-lg border bg-clip-padding px-2.5 py-1 text-sm has-data-[slot=combobox-chip]:px-1',
        className
      )}
      {...props}
    />
  )
}

/**
 * @description 渲染多选 Combobox 的单个已选值标签，默认附带移除按钮。
 * @param props 透传给 Base UI Combobox Chip 的属性。
 * @param props.showRemove 是否显示移除按钮，默认显示。
 * @returns Combobox 已选值标签。
 */
function ComboboxChip({
  className,
  children,
  showRemove = true,
  ...props
}: ComboboxPrimitive.Chip.Props & {
  showRemove?: boolean
}): React.JSX.Element {
  return (
    <ComboboxPrimitive.Chip
      data-slot="combobox-chip"
      className={cn(
        'flex h-[calc(--spacing(5.25))] w-fit items-center justify-center gap-1 rounded-sm bg-white/10 px-1.5 text-xs font-medium whitespace-nowrap text-white/80 has-disabled:pointer-events-none has-disabled:cursor-not-allowed has-disabled:opacity-50 has-data-[slot=combobox-chip-remove]:pr-0',
        className
      )}
      {...props}
    >
      {children}
      {showRemove && (
        <ComboboxPrimitive.ChipRemove
          className="-ml-1 opacity-50 hover:opacity-100"
          data-slot="combobox-chip-remove"
          render={
            <Button variant="ghost" size="icon-xs">
              <XIcon className="pointer-events-none" />
            </Button>
          }
        />
      )}
    </ComboboxPrimitive.Chip>
  )
}

/**
 * @description 渲染多选 Combobox 的 Chips 内输入框。
 * @param props 透传给 Base UI Combobox Input 的属性。
 * @returns Chips 内输入框。
 */
function ComboboxChipsInput({
  className,
  ...props
}: ComboboxPrimitive.Input.Props): React.JSX.Element {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-chip-input"
      className={cn('min-w-16 flex-1 outline-none', className)}
      {...props}
    />
  )
}

export {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxGroup,
  ComboboxLabel,
  ComboboxCollection,
  ComboboxEmpty,
  ComboboxSeparator,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipsInput,
  ComboboxTrigger,
  ComboboxValue
}
