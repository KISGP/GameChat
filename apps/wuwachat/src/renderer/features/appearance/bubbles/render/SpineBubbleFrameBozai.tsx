import { useEffect, useRef, type ReactElement, type RefObject } from 'react'
import { BOZAI_FRAME_SCALE, BOZAI_FRAME_SLICE, BOZAI_FRAME_SRC } from '../catalog'
import { drawPanelNineSlice } from './draw-nine-slice'
import { CANVAS_MARGIN_PX } from './spine-bubble-shared'
import { useSpineBubbleFrame } from './use-spine-bubble-frame'

type SpineBubbleFrameBozaiProps = {
  // 气泡可视盒元素引用；面板九宫格按该盒尺寸绘制，两块部件画布的 css 尺寸随盒外扩
  boxRef: RefObject<HTMLElement | null>
}

/**
 * @description 波仔气泡帧：阴影剪影画布、面板九宫格画布与部件播放器画布三明治叠放，
 *              阴影与部件两层均由共享渲染服务转印。
 * @remarks 头部阴影剪影（头y）单独渲染在面板之下、头本体等部件渲染在面板之上，
 *          面板恰好把阴影层伸入盒内的部分遮住，只露出天然边缘；文字层由调用方保持 z-30。
 *          阴影画布与部件画布同为盒尺寸加四周 CANVAS_MARGIN_PX 外扩、共用同一画布坐标系。
 *          面板为静态九宫格绘制，横向用 BOZAI_FRAME_SCALE，纵向在盒高装不下上下切片
 *          之和时钳制缩放；加载失败经 trackError 上报后仅保留纯色底板回退外观；
 *          减少动效偏好下部件仅绘制一帧静像。
 */
export function SpineBubbleFrameBozai({ boxRef }: SpineBubbleFrameBozaiProps): ReactElement {
  const shadowCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const shadowFailed = useSpineBubbleFrame({
    rigKey: 'bozai',
    layer: 'back',
    canvasRef: shadowCanvasRef,
    boxRef,
    errorEvent: 'spine-bubble-frame-bozai-load',
    errorMessage: 'Failed to load bozai bubble spine frame'
  })
  const frontFailed = useSpineBubbleFrame({
    rigKey: 'bozai',
    canvasRef,
    boxRef,
    errorEvent: 'spine-bubble-frame-bozai-load',
    errorMessage: 'Failed to load bozai bubble spine frame'
  })
  const failed = shadowFailed || frontFailed

  // 面板九宫格：盒尺寸变化即重绘，静态绘制不依赖渲染循环
  useEffect(() => {
    const canvas = frameCanvasRef.current
    const box = boxRef.current
    if (!canvas || !box) return undefined
    const image = new Image()
    let observer: ResizeObserver | null = null
    /** 按九宫格把面板画进盒体：横向固定缩放，纵向在盒高不足时钳制 */
    const draw = (): void => {
      if (!image.complete || !image.naturalWidth) return
      drawPanelNineSlice(canvas, box, image, BOZAI_FRAME_SLICE, BOZAI_FRAME_SCALE)
    }
    image.addEventListener('load', draw)
    image.src = BOZAI_FRAME_SRC
    draw()
    observer = new ResizeObserver(draw)
    observer.observe(box)
    return () => {
      observer?.disconnect()
      image.removeEventListener('load', draw)
    }
  }, [boxRef])

  if (failed) {
    return (
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-1 rounded bg-[#f2dcab]"
      />
    )
  }

  return (
    <>
      <canvas
        ref={shadowCanvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute z-[1] block"
        style={{
          left: -CANVAS_MARGIN_PX,
          top: -CANVAS_MARGIN_PX,
          width: `calc(100% + ${CANVAS_MARGIN_PX * 2}px)`,
          height: `calc(100% + ${CANVAS_MARGIN_PX * 2}px)`
        }}
      />
      <canvas
        ref={frameCanvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[2] block h-full w-full"
      />
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
    </>
  )
}
