/**
 * @description 画布右上角的调试运行托盘：运行/停止控制、前置校验原因与 token 成本常驻提示。
 * @remarks 调试运行会真实调用模型并执行工具；提示文案与调试隔离策略同步——不写入真实聊天记录、记忆与状态卡。
 */
import type { ReactElement } from 'react'
import { Button } from '@renderer/common/components/button'

/**
 * @description 渲染调试运行托盘。
 * @param props 运行状态与控制回调。
 * @param props.running 是否存在在途调试运行。
 * @param props.ready 画布是否满足运行前置条件。
 * @param props.reason 运行被挡住的具体原因；可运行时为 null。
 * @param props.error 最近一次运行的错误文本；空串表示无错误。
 * @param props.onLocateError 点击错误文本时定位失败节点；未定位到失败节点时缺省，错误文本不可点击。
 * @param props.onRun 启动调试运行。
 * @param props.onStop 停止在途调试运行。
 * @returns 运行托盘。
 */
export function RunTray(props: {
  running: boolean
  ready: boolean
  reason: string | null
  error: string
  onLocateError?: () => void
  onRun: () => void
  onStop: () => void
}): ReactElement {
  const { running, ready, reason, error, onLocateError, onRun, onStop } = props
  return (
    <div className="absolute right-4 top-4 z-10 flex max-w-sm flex-col items-end gap-1">
      <div className="border-border bg-card/95 flex items-center gap-2 rounded-xl border px-3 py-1.5 shadow-xl backdrop-blur">
        <span className="text-muted-foreground text-xs">
          {running ? '运行中' : ready ? '就绪' : '画布不完整'}
        </span>
        <Button
          variant="primary"
          size="xs"
          title="用当前画布跑一次临时会话：工具会真实执行并消耗模型 token"
          disabled={running || !ready}
          onClick={onRun}
        >
          运行
        </Button>
        <Button variant="ghost" size="xs" disabled={!running} onClick={onStop}>
          停止
        </Button>
      </div>
      {reason && !running && (
        <p className="border-border bg-card/95 max-h-32 overflow-y-auto rounded-lg border px-2 py-1 text-xs text-amber-500 shadow-lg backdrop-blur">
          {reason}
        </p>
      )}
      {error &&
        (onLocateError ? (
          <button
            type="button"
            className="border-border bg-card/95 max-h-32 cursor-pointer overflow-y-auto rounded-lg border px-2 py-1 text-left text-xs text-red-500 shadow-lg backdrop-blur transition-colors hover:border-red-500/50"
            title="点击定位到失败的节点"
            onClick={onLocateError}
          >
            {error}
          </button>
        ) : (
          <p className="border-border bg-card/95 max-h-32 overflow-y-auto rounded-lg border px-2 py-1 text-xs text-red-500 shadow-lg backdrop-blur">
            {error}
          </p>
        ))}
    </div>
  )
}
