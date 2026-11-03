import { useCallback, useEffect, useState } from 'react'

/**
 * @description 覆盖层生命周期阶段：closed 未挂载；entering 已挂载、处于入场起始态；open 常驻；exiting 退场中、结束后卸载。
 */
export type OverlayPhase = 'closed' | 'entering' | 'open' | 'exiting'

/**
 * @description 覆盖层过渡时长（毫秒），退场卸载计时依据，须与 App.tsx 覆盖层过渡类的 duration-300 保持一致。
 */
export const OVERLAY_TRANSITION_MS = 300

/**
 * @description 驱动全屏覆盖层从打开到卸载的完整生命周期：入场经一帧延迟落入常驻态以触发过渡，退场按过渡时长延后卸载。
 * @param shouldAnimate 是否播放过渡动画；为 false 时打开直接进入 open、关闭立即回到 closed。
 * @returns 当前生命周期阶段与 open、close 两个动作。
 * @remarks 退场卸载计时取自 OVERLAY_TRANSITION_MS，若与实际过渡类时长不一致会出现空白窗口或过渡被截断；退场期间再次调用 open 会取消待执行的卸载并反向过渡回常驻态。
 */
export function useOverlayLifecycle(shouldAnimate: boolean): {
  phase: OverlayPhase
  open: () => void
  close: () => void
} {
  const [phase, setPhase] = useState<OverlayPhase>('closed')

  useEffect(() => {
    if (phase !== 'entering') {
      return
    }
    const frame = window.requestAnimationFrame(() => {
      setPhase('open')
    })
    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [phase])

  useEffect(() => {
    if (phase !== 'exiting') {
      return
    }
    const timer = window.setTimeout(() => {
      setPhase('closed')
    }, OVERLAY_TRANSITION_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [phase])

  const open = useCallback(() => {
    setPhase((prev) => (prev === 'closed' && shouldAnimate ? 'entering' : 'open'))
  }, [shouldAnimate])

  const close = useCallback(() => {
    setPhase((prev) => {
      if (prev === 'closed' || prev === 'exiting') {
        return prev
      }
      return shouldAnimate ? 'exiting' : 'closed'
    })
  }, [shouldAnimate])

  return { phase, open, close }
}
