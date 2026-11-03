import { useEffect, useRef, useState, type RefObject } from 'react'
import { trackError } from '@renderer/app/telemetry'
import { useMotionPreference } from '@renderer/app/hooks/useMotionPreference'
import type { SpineBubbleFrameLayer } from './spine-bubble-shared'
import {
  registerSpineBubbleFrameTarget,
  type SpineBubbleRigKey,
  type SpineBubbleTarget
} from './spine-bubble-render-service'

/** 注册气泡帧渲染目标的 hook 参数。 */
type UseSpineBubbleFrameParams = {
  // 目标使用的样式部件集合
  rigKey: SpineBubbleRigKey
  // 目标画布对应的渲染层；波仔阴影剪影为 back，其余为 main
  layer?: SpineBubbleFrameLayer
  // 承接转印结果的 2D 画布引用
  canvasRef: RefObject<HTMLCanvasElement | null>
  // 气泡可视盒元素引用
  boxRef: RefObject<HTMLElement | null>
  // 加载失败上报的事件标识
  errorEvent: string
  // 加载失败上报的消息文案
  errorMessage: string
}

/**
 * @description 把一块 2D 画布注册为气泡帧渲染目标，并跟随减少动效偏好切换播放模式。
 * @param params 注册参数。
 * @returns 部件集合是否加载失败；失败后调用方应展示回退外观。
 * @remarks 目标随组件卸载注销；画布或盒元素在挂载后不可用时不注册。加载失败经
 *          trackError 上报并置失败态，同样式其他目标由共享服务自行回调各自的 onError。
 */
export function useSpineBubbleFrame(params: UseSpineBubbleFrameParams): boolean {
  const { rigKey, layer = 'main', canvasRef, boxRef, errorEvent, errorMessage } = params
  const [failed, setFailed] = useState(false)
  const { shouldAnimate } = useMotionPreference()
  // 镜像最新动效偏好，供注册完成时采用当前值而非创建时的闭包值
  const shouldAnimateRef = useRef(shouldAnimate)
  // 已注册目标句柄，供动效偏好变化时切换播放模式
  const targetRef = useRef<SpineBubbleTarget | null>(null)

  useEffect(() => {
    shouldAnimateRef.current = shouldAnimate
    targetRef.current?.setAnimated(shouldAnimate)
  }, [shouldAnimate])

  useEffect(() => {
    const canvas = canvasRef.current
    const box = boxRef.current
    if (!canvas || !box) return undefined
    const target = registerSpineBubbleFrameTarget({
      rigKey,
      layer,
      canvas,
      box,
      animated: shouldAnimateRef.current,
      onError: (error) => {
        trackError(errorEvent, errorMessage, error)
        setFailed(true)
      }
    })
    targetRef.current = target
    return () => {
      targetRef.current = null
      target.release()
    }
  }, [rigKey, layer, canvasRef, boxRef, errorEvent, errorMessage])

  return failed
}
