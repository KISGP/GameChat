/**
 * @description 原始请求响应弹窗：展示预览节点上游节点与模型之间的未加工交换内容。
 * @remarks 弹层经 createPortal 挂到 body（节点内 fixed 定位退化的规避方式与工具轨迹弹窗一致）；
 *   点击遮罩、关闭按钮或按 Esc 关闭。每次请求一个可折叠分节（默认收起，节头带首行摘要），
 *   展开后请求消息按角色排列，响应含文本与工具调用清单的原始 JSON。
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, X } from 'lucide-react'
import type { FlowNodeRawExchange } from '@gamechat/type'
import { Button } from '@renderer/common/components/button'

/**
 * @description 渲染单次请求的可折叠分节。
 * @param props 请求序号（0 起）与原始交换。
 * @param props.index 请求序号，标题展示用。
 * @param props.exchange 原始模型交换。
 * @returns 可折叠分节。
 * @remarks 默认收起：标题右侧带 SYSTEM 首行截断摘要，展开后才渲染消息正文，长交换不撑高弹窗。
 */
function ExchangeSection(props: { index: number; exchange: FlowNodeRawExchange }): ReactElement {
  const { index, exchange } = props
  const [open, setOpen] = useState(false)
  /** 节头摘要：首条消息按单行截断，帮助在收起状态下区分各次请求。 */
  const summary = (exchange.messages[0]?.content ?? '')
    .split('\n')[0]
    .trim()
    .slice(0, 60)

  return (
    <section className="space-y-2">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-foreground/5"
        onClick={() => setOpen((previous) => !previous)}
      >
        <ChevronRight
          size={12}
          className={`text-muted-foreground shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <span className="text-muted-foreground shrink-0 text-xs font-semibold">
          第 {index + 1} 次请求
        </span>
        {summary && (
          <span className="text-muted-foreground/70 min-w-0 truncate font-mono text-[11px]">
            {summary}
          </span>
        )}
      </button>
      {open && (
        <>
          {exchange.messages.map((message, messageIndex) => (
            <div key={messageIndex}>
              <p className="text-muted-foreground/80 font-mono text-[10px] uppercase">
                {message.role}
              </p>
              <pre className="border-border bg-muted/30 whitespace-pre-wrap break-all rounded-lg border p-2 font-mono text-[11px] leading-relaxed">
                {message.content || '（空）'}
              </pre>
            </div>
          ))}
          <p className="text-muted-foreground text-xs font-semibold">响应</p>
          <pre className="border-border bg-muted/30 whitespace-pre-wrap break-all rounded-lg border p-2 font-mono text-[11px] leading-relaxed">
            {exchange.content || '（无文本）'}
          </pre>
          {exchange.toolCalls.length > 0 && (
            <>
              <p className="text-muted-foreground text-xs font-semibold">工具调用</p>
              <pre className="border-border bg-muted/30 overflow-x-auto rounded-lg border p-2 font-mono text-[11px] leading-snug">
                {JSON.stringify(exchange.toolCalls, null, 2)}
              </pre>
            </>
          )}
        </>
      )}
    </section>
  )
}

/**
 * @description 渲染原始请求响应弹窗。
 * @param props 上游节点的原始交换序列与关闭回调。
 * @param props.exchanges 本次运行内按执行顺序排列的原始模型交换。
 * @param props.onClose 关闭弹窗。
 * @returns 全屏弹窗。
 */
export function RawExchangeDialog(props: {
  exchanges: ReadonlyArray<FlowNodeRawExchange>
  onClose: () => void
}): ReactElement {
  const { exchanges, onClose } = props
  const panelRef = useRef<HTMLDivElement | null>(null)

  // Esc 关闭；捕获阶段处理，优先于其他 window 级 Esc 监听。
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
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
        className="border-border bg-card flex max-h-[80vh] w-[720px] max-w-full flex-col rounded-xl border shadow-2xl"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="border-border flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
          <span className="text-sm font-semibold">原始请求与响应</span>
          <span className="text-muted-foreground text-[11px]">
            共 {exchanges.length} 次模型请求
          </span>
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
          {exchanges.map((exchange, index) => (
            <ExchangeSection key={index} index={index} exchange={exchange} />
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}
