import { XIcon } from 'lucide-react'
import * as React from 'react'
import {
  Dialog as DialogPrimitive,
  DialogClose as DialogClosePrimitive,
  DialogContent as DialogContentPrimitive,
  DialogDescription as DialogDescriptionPrimitive,
  DialogOverlay as DialogOverlayPrimitive,
  DialogPortal as DialogPortalPrimitive,
  DialogTitle as DialogTitlePrimitive
} from '@radix-ui/react-dialog'

import { cn } from '@renderer/common/lib/cn'

/**
 * @description 渲染受控的 Dialog 根节点。
 * @param props 透传给 Radix Dialog Root 的属性。
 * @returns Dialog 根节点。
 */
function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive>): React.JSX.Element {
  return <DialogPrimitive data-slot="dialog" {...props} />
}

/**
 * @description 渲染 Dialog 遮罩层。
 * @param props 透传给遮罩节点的属性。
 * @returns Dialog 遮罩。
 */
function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogOverlayPrimitive>): React.JSX.Element {
  return (
    <DialogOverlayPrimitive
      data-slot="dialog-overlay"
      className={cn(
        'data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 fixed inset-0 z-200 bg-black/60 backdrop-blur-[2px] duration-150',
        className
      )}
      {...props}
    />
  )
}

/**
 * @description 渲染居中的 Dialog 内容面板，含遮罩与右上角关闭按钮。
 * @param props 透传给内容节点的属性。
 * @returns Dialog 内容面板。
 */
function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogContentPrimitive>): React.JSX.Element {
  return (
    <DialogPortalPrimitive>
      <DialogOverlay />
      <DialogContentPrimitive
        data-slot="dialog-content"
        className={cn(
          'data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 fixed top-1/2 left-1/2 z-200 flex max-h-[calc(100vh-4rem)] w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border-2 border-[rgb(51,51,51)] bg-[rgba(8,8,8,0.96)] text-white shadow-[0_14px_32px_rgba(0,0,0,0.45)] ring-1 ring-white/5 duration-150',
          className
        )}
        {...props}
      >
        {children}
        <DialogClosePrimitive
          data-slot="dialog-close"
          className="absolute top-3 right-3 flex size-7 items-center justify-center rounded text-white/45 transition-colors hover:bg-white/10 hover:text-white/85"
          title="关闭"
          aria-label="关闭"
        >
          <XIcon className="size-4" />
        </DialogClosePrimitive>
      </DialogContentPrimitive>
    </DialogPortalPrimitive>
  )
}

/**
 * @description 渲染 Dialog 标题。
 * @param props 透传给标题节点的属性。
 * @returns Dialog 标题。
 */
function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogTitlePrimitive>): React.JSX.Element {
  return (
    <DialogTitlePrimitive
      data-slot="dialog-title"
      className={cn('text-sm font-medium text-white/90', className)}
      {...props}
    />
  )
}

/**
 * @description 渲染 Dialog 描述文本。
 * @param props 透传给描述节点的属性。
 * @returns Dialog 描述。
 */
function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogDescriptionPrimitive>): React.JSX.Element {
  return (
    <DialogDescriptionPrimitive
      data-slot="dialog-description"
      className={cn('text-xs text-white/45', className)}
      {...props}
    />
  )
}

export { Dialog, DialogContent, DialogDescription, DialogTitle }
