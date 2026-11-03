import * as React from 'react'

import { cn } from '@renderer/common/lib/cn'

/**
 * @description 渲染设置页通用卡片容器，并提供统一的品牌表面样式。
 * @param props 卡片尺寸、样式和容器属性。
 * @returns 卡片容器元素。
 */
function Card({
  className,
  size = 'default',
  ...props
}: React.ComponentProps<'div'> & { size?: 'default' | 'sm' }): React.ReactElement {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        'group/card flex flex-col overflow-hidden rounded border border-white/10 bg-black/25 text-sm text-white/85 shadow-none has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 *:[img:first-child]:rounded-t *:[img:last-child]:rounded-b',
        className
      )}
      {...props}
    />
  )
}

/**
 * @description 渲染卡片标题区域。
 * @param props 标题区域的容器属性。
 * @returns 卡片标题区域元素。
 */
function CardHeader({ className, ...props }: React.ComponentProps<'div'>): React.ReactElement {
  return (
    <div
      data-slot="card-header"
      className={cn(
        'group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t px-4 py-3 group-data-[size=sm]/card:px-3 group-data-[size=sm]/card:py-2 has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto]',
        className
      )}
      {...props}
    />
  )
}

/**
 * @description 渲染卡片标题文本容器。
 * @param props 标题文本的容器属性。
 * @returns 卡片标题元素。
 */
function CardTitle({ className, ...props }: React.ComponentProps<'div'>): React.ReactElement {
  return (
    <div
      data-slot="card-title"
      className={cn(
        'text-base leading-snug font-medium text-white/90 group-data-[size=sm]/card:text-sm',
        className
      )}
      {...props}
    />
  )
}

/**
 * @description 渲染卡片描述文本容器。
 * @param props 描述文本的容器属性。
 * @returns 卡片描述元素。
 */
function CardDescription({ className, ...props }: React.ComponentProps<'div'>): React.ReactElement {
  return (
    <div
      data-slot="card-description"
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  )
}

/**
 * @description 渲染卡片标题区域中的操作容器。
 * @param props 操作容器的容器属性。
 * @returns 卡片操作元素。
 */
function CardAction({ className, ...props }: React.ComponentProps<'div'>): React.ReactElement {
  return (
    <div
      data-slot="card-action"
      className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)}
      {...props}
    />
  )
}

/**
 * @description 渲染卡片主要内容区域，并提供统一内边距。
 * @param props 内容区域的容器属性。
 * @returns 卡片内容元素。
 */
function CardContent({ className, ...props }: React.ComponentProps<'div'>): React.ReactElement {
  return (
    <div
      data-slot="card-content"
      className={cn('p-4 group-data-[size=sm]/card:p-3', className)}
      {...props}
    />
  )
}

/**
 * @description 渲染卡片底部操作区域。
 * @param props 底部区域的容器属性。
 * @returns 卡片底部元素。
 */
function CardFooter({ className, ...props }: React.ComponentProps<'div'>): React.ReactElement {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        'flex items-center rounded-b border-t border-white/10 bg-white/5 px-4 py-3 group-data-[size=sm]/card:px-3 group-data-[size=sm]/card:py-2',
        className
      )}
      {...props}
    />
  )
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent }
