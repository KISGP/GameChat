import { useRef, type ReactElement, type RefObject } from 'react'
import {
  BUBBLE_FRAME_DARK_SRC,
  BUBBLE_FRAME_GOLD_SRC,
  BUBBLE_FRAME_SCALE,
  frameLayerStyle
} from '../catalog'
import { CANVAS_MARGIN_PX } from './spine-bubble-shared'
import { useSpineBubbleFrame } from './use-spine-bubble-frame'

type SpineBubbleFrameProps = {
  // 气泡可视盒元素引用；部件钉边与画布外扩均相对该盒计算
  boxRef: RefObject<HTMLElement | null>
}

/**
 * @description 心月狐气泡帧：双层 CSS 底框兜底加共享渲染服务的金框部件画布。
 * @remarks 两层 CSS 九宫格底框常驻渲染，在部件加载期充当占位、加载失败时充当回退外观；
 *          画布不拦截指针事件，绘制内容含框下层部件、GL 底框与框上层部件。
 *          减少动效偏好下仅绘制一帧静像，不参与渲染循环。
 */
export function SpineBubbleFrame({ boxRef }: SpineBubbleFrameProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const failed = useSpineBubbleFrame({
    rigKey: 'xinyuehu',
    canvasRef,
    boxRef,
    errorEvent: 'spine-bubble-frame-load',
    errorMessage: 'Failed to load bubble spine frame'
  })

  return (
    <>
      <span style={frameLayerStyle(BUBBLE_FRAME_GOLD_SRC, BUBBLE_FRAME_SCALE)} />
      <span style={frameLayerStyle(BUBBLE_FRAME_DARK_SRC, BUBBLE_FRAME_SCALE)} />
      {failed ? null : (
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="pointer-events-none absolute z-20 block"
          style={{
            left: -CANVAS_MARGIN_PX,
            top: -CANVAS_MARGIN_PX,
            width: `calc(100% + ${CANVAS_MARGIN_PX * 2}px)`,
            height: `calc(100% + ${CANVAS_MARGIN_PX * 2}px)`
          }}
        />
      )}
    </>
  )
}
