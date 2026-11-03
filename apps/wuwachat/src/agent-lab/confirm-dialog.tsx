/**
 * @description 编排窗口确认对话框：以 promise 形式向调用方提供「确认/取消」决策。
 * @remarks 以应用内对话框承载确认决策：与应用深色主题一致，且在无边框窗口中不弹系统级阻塞对话框。
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { Button } from '@renderer/common/components/button'

/** 确认对话框选项。 */
export type ConfirmOptions = {
  /** 正文说明。 */
  message: string
  /** 确认按钮文案；缺省为「确认」。 */
  confirmLabel?: string
  /** 危险操作样式：确认按钮使用 danger 形态。 */
  danger?: boolean
}

/** 待展示的确认请求：选项与决策回调。 */
type PendingConfirm = {
  options: ConfirmOptions
  resolve: (confirmed: boolean) => void
}

/**
 * @description 创建确认对话框状态与渲染元素。
 * @returns confirm 决策函数与待渲染的对话框元素。
 * @remarks confirm 返回的 promise 在用户点击确认时 resolve true，取消、关闭或按 Esc 时 resolve false；
 *   同一时刻只保留最后一次请求，前一次未决请求按取消处理。
 */
export function useConfirm(): {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  dialog: ReactElement
} {
  const [pending, setPending] = useState<PendingConfirm | null>(null)

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setPending((previous) => {
        previous?.resolve(false)
        return { options, resolve }
      })
    })
  }, [])

  const settle = useCallback((confirmed: boolean): void => {
    setPending((previous) => {
      previous?.resolve(confirmed)
      return null
    })
  }, [])

  // Esc 关闭等同取消。
  useEffect(() => {
    if (!pending) {
      return
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        settle(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [pending, settle])

  const dialog = pending ? (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50"
      onPointerDown={() => settle(false)}
    >
      <div
        className="border-border bg-card w-96 max-w-[90vw] rounded-xl border p-4 shadow-2xl"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <p className="text-foreground text-sm leading-relaxed">{pending.options.message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => settle(false)}>
            取消
          </Button>
          <Button
            variant={pending.options.danger ? 'danger' : 'primary'}
            size="sm"
            onClick={() => settle(true)}
          >
            {pending.options.confirmLabel ?? '确认'}
          </Button>
        </div>
      </div>
    </div>
  ) : (
    <></>
  )

  return { confirm, dialog }
}
