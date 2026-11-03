/**
 * @description 全屏文本编辑弹窗壳：大面板内编辑一段多行文本，编辑区由调用方注入，可选预览切换。
 * @remarks 弹层经 createPortal 挂到 body（节点内 fixed 定位退化的规避方式与 raw 弹窗一致）；
 *   点击遮罩、关闭按钮或按 Esc 关闭，Esc 走冒泡阶段——输入区内的变量补全弹层在捕获阶段
 *   拦截 Esc 时优先关闭补全。编辑由调用方受控实时生效，本组件不持确认/取消两态。
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Eye, Maximize2, Pencil, X } from 'lucide-react'
import { Button } from '@renderer/common/components/button'

/**
 * @description 渲染全屏文本编辑弹窗。
 * @param props 弹窗标题、编辑区内容、可选预览内容与关闭回调。
 * @param props.title 标题行展示的字段名。
 * @param props.children 编辑区内容：铺满面板主体的受控输入组件。
 * @param props.preview 预览内容：提供时标题行出现「预览/编辑」切换，预览态替换编辑区显示。
 * @param props.onClose 关闭弹窗。
 * @returns 全屏弹窗。
 */
export function FullscreenTextareaDialog(props: {
  title: string
  children: ReactNode
  preview?: ReactNode
  onClose: () => void
}): ReactElement {
  const { title, children, preview, onClose } = props
  const panelRef = useRef<HTMLDivElement | null>(null)
  /** 预览态开关：仅提供预览内容时可用。 */
  const [previewing, setPreviewing] = useState(false)

  // Esc 关闭走冒泡阶段：变量补全等捕获级 Esc 监听 stopPropagation 后优先处理自身语义。
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // 弹层内 pointerdown 原生阻断冒泡：避免误关条件卡片等 window 级监听。
  useLayoutEffect(() => {
    const element = panelRef.current
    if (!element) {
      return
    }
    const stop = (event: PointerEvent): void => {
      event.stopPropagation()
    }
    element.addEventListener('pointerdown', stop)
    return () => element.removeEventListener('pointerdown', stop)
  }, [])

  return createPortal(
    <div
      className="fixed inset-0 z-[1200] flex bg-black/60 p-4 sm:p-6"
      onPointerDown={onClose}
    >
      <div
        ref={panelRef}
        className="border-border bg-card flex w-full flex-col rounded-xl border shadow-2xl"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="border-border flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
          <span className="text-sm font-semibold">{title}</span>
          <span className="text-muted-foreground text-[11px]">Esc 退出</span>
          {preview && (
            <Button
              variant="ghost"
              size="xs"
              title={previewing ? '回到编辑' : '查看变量占位的拼接效果'}
              onClick={() => setPreviewing((previous) => !previous)}
            >
              {previewing ? <Pencil size={12} /> : <Eye size={12} />}
              {previewing ? '编辑' : '预览'}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            title="关闭"
            onClick={onClose}
          >
            <X size={14} />
          </Button>
        </div>
        <div className="min-h-0 flex-1 p-4">
          {preview && previewing ? preview : children}
        </div>
      </div>
    </div>,
    document.body
  )
}

/**
 * @description 渲染展开全屏编辑的角标按钮。
 * @param props 点击回调：展开全屏编辑弹窗。
 * @returns 带底色的小图标按钮；不带定位，摆放由调用方容器决定。
 */
export function FullscreenTextareaButton(props: { onExpand: () => void }): ReactElement {
  return (
    <button
      type="button"
      className="border-border/60 bg-background/60 text-muted-foreground hover:text-primary flex h-5 w-5 cursor-pointer items-center justify-center rounded-md border hover:bg-foreground/10"
      title="全屏编辑"
      onClick={props.onExpand}
    >
      <Maximize2 size={13} />
    </button>
  )
}
