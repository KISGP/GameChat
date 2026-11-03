/**
 * @description 工具调用详情弹窗：完整展示一次工具调用的状态、入参与输出全文。
 * @remarks 弹层经 createPortal 挂到 body：React Flow 节点容器带 transform，节点内的
 *   fixed 定位会退化为相对节点定位，只有脱离节点层级才能全屏居中。点击遮罩、关闭按钮
 *   或按 Esc 关闭；弹层内 pointerdown 原生阻断冒泡，避免误关条件卡片等 window 级监听。
 */
import { useEffect, useLayoutEffect, useRef, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { FlowDebugToolTrace } from '@gamechat/type'
import { Button } from '@renderer/common/components/button'

/** 工具轨迹状态到徽标文案与配色的映射；节点内摘要与弹窗共用。 */
export const TRACE_STATUS_META: Record<
  FlowDebugToolTrace['status'],
  { label: string; className: string }
> = {
  completed: {
    label: '完成',
    className: 'bg-emerald-600/10 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300'
  },
  failed: {
    label: '失败',
    className: 'bg-red-600/10 text-red-700 dark:bg-red-400/15 dark:text-red-300'
  },
  rejected: {
    label: '拒绝',
    className: 'bg-amber-600/10 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300'
  }
}

/**
 * @description 渲染工具调用详情弹窗。
 * @param props 目标轨迹与关闭回调。
 * @param props.trace 要展示的工具调用轨迹。
 * @param props.onClose 关闭弹窗。
 * @returns 全屏弹窗。
 */
export function ToolTraceDialog(props: {
  trace: FlowDebugToolTrace
  onClose: () => void
}): ReactElement {
  const { trace, onClose } = props
  const panelRef = useRef<HTMLDivElement | null>(null)
  const status = TRACE_STATUS_META[trace.status]
  const hasInput = Object.keys(trace.input).length > 0

  // Esc 关闭；捕获阶段处理，优先于其他 window 级 Esc 监听。
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
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
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/60 p-6"
      onPointerDown={onClose}
    >
      <div
        ref={panelRef}
        className="border-border bg-card flex max-h-[80vh] w-[640px] max-w-full flex-col rounded-xl border shadow-2xl"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="border-border flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
          <span className={`rounded px-1.5 py-0.5 text-[10px] ${status.className}`}>
            {status.label}
          </span>
          <span className="truncate font-mono text-sm" title={trace.toolName}>
            {trace.toolName}
          </span>
          <span className="text-muted-foreground shrink-0 text-[11px]">第 {trace.round} 轮</span>
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
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {hasInput && (
            <section>
              <p className="text-muted-foreground mb-1 text-xs font-semibold">入参</p>
              <pre className="border-border bg-muted/30 overflow-x-auto rounded-lg border p-2 font-mono text-[11px] leading-snug">
                {JSON.stringify(trace.input, null, 2)}
              </pre>
            </section>
          )}
          <section>
            <p className="text-muted-foreground mb-1 text-xs font-semibold">输出</p>
            <pre className="border-border bg-muted/30 whitespace-pre-wrap break-all rounded-lg border p-2 font-mono text-[11px] leading-relaxed">
              {trace.output !== undefined
                ? JSON.stringify(trace.output, null, 2)
                : trace.outputSummary || '（无输出）'}
            </pre>
          </section>
        </div>
      </div>
    </div>,
    document.body
  )
}
