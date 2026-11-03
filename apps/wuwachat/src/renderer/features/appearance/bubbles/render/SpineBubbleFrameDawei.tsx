import { useEffect, useRef, type ReactElement, type RefObject } from 'react'
import {
  DAWEI_CLOUD_NATIVE_WIDTH,
  DAWEI_CLOUD_OFFSET,
  DAWEI_CLOUD_SRC,
  DAWEI_FRAME_SCALE,
  DAWEI_FRAME_SLICE,
  DAWEI_FRAME_SRC,
  DAWEI_LIGHT_OPACITY,
  DAWEI_LIGHT_SRC
} from '../catalog'
import { drawPanelNineSlice } from './draw-nine-slice'
import { CANVAS_MARGIN_PX } from './spine-bubble-shared'
import { useSpineBubbleFrame } from './use-spine-bubble-frame'

type SpineBubbleFrameDaweiProps = {
  // 气泡可视盒元素引用；面板九宫格按该盒尺寸绘制，部件画布的 css 尺寸随盒外扩
  boxRef: RefObject<HTMLElement | null>
}

/**
 * @description 大卫·马丁内斯气泡帧：底板九宫格与星空云带合成的 2D 画布，加共享渲染服务的部件画布。
 * @remarks 星空与云带经 source-atop 合成进底板画布，只在底板面板有像素的区域显示，
 *          斜切角缺口处保持透明。底板为静态绘制，横向用 DAWEI_FRAME_SCALE，
 *          纵向在盒高装不下上下切片之和时钳制缩放，任何盒高下右下切角均完整可见；
 *          部件画布由共享渲染服务转印，减少动效偏好下仅绘制一帧静像。
 *          加载失败经 trackError 上报后仅保留纯色底板回退外观。
 */
export function SpineBubbleFrameDawei({ boxRef }: SpineBubbleFrameDaweiProps): ReactElement {
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const failed = useSpineBubbleFrame({
    rigKey: 'dawei',
    canvasRef,
    boxRef,
    errorEvent: 'spine-bubble-frame-dawei-load',
    errorMessage: 'Failed to load dawei bubble spine frame'
  })

  // 底板合成：盒尺寸变化即重绘，静态绘制不依赖渲染循环
  useEffect(() => {
    const canvas = frameCanvasRef.current
    const box = boxRef.current
    if (!canvas || !box) return undefined
    const frame = new Image()
    const light = new Image()
    const cloud = new Image()
    let observer: ResizeObserver | null = null
    /** 三张贴图是否均已就绪。 */
    const ready = (): boolean =>
      [frame, light, cloud].every((image) => image.complete && image.naturalWidth > 0)
    /** 绘制底板九宫格，并经 source-atop 把星空平铺与云带限制在面板像素内 */
    const draw = (): void => {
      if (!ready()) return
      const surface = drawPanelNineSlice(canvas, box, frame, DAWEI_FRAME_SLICE, DAWEI_FRAME_SCALE)
      if (!surface) return
      const { ctx, bufferWidth, bufferHeight, boxWidth, boxHeight, dpr } = surface
      // 九宫格之后恢复 css 坐标系：星空块自管恒等变换，云块按 css 坐标绘制。
      // 星空按设备像素取整的离屏 tile 平铺（恒等变换下绘制），tile 间距恒为整数设备像素，
      // 避免 DPR 非整数时接缝落在半像素上产生重采样细线
      const tile = document.createElement('canvas')
      tile.width = Math.max(1, Math.round(light.naturalWidth * dpr))
      tile.height = Math.max(1, Math.round(light.naturalHeight * dpr))
      const tileCtx = tile.getContext('2d')
      if (!tileCtx) return
      tileCtx.drawImage(light, 0, 0, tile.width, tile.height)
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.globalCompositeOperation = 'source-atop'
      ctx.globalAlpha = DAWEI_LIGHT_OPACITY
      const pattern = ctx.createPattern(tile, 'repeat')
      if (pattern) {
        ctx.fillStyle = pattern
        ctx.fillRect(0, 0, bufferWidth, bufferHeight)
      }
      ctx.restore()
      ctx.globalCompositeOperation = 'source-atop'
      const cloudWidth = DAWEI_CLOUD_NATIVE_WIDTH * DAWEI_FRAME_SCALE
      const cloudHeight = cloudWidth * (cloud.naturalHeight / cloud.naturalWidth)
      ctx.drawImage(
        cloud,
        boxWidth + DAWEI_CLOUD_OFFSET.x - cloudWidth,
        boxHeight + DAWEI_CLOUD_OFFSET.y - cloudHeight,
        cloudWidth,
        cloudHeight
      )
      ctx.globalCompositeOperation = 'source-over'
    }
    for (const image of [frame, light, cloud]) {
      image.addEventListener('load', draw)
    }
    frame.src = DAWEI_FRAME_SRC
    light.src = DAWEI_LIGHT_SRC
    cloud.src = DAWEI_CLOUD_SRC
    draw()
    observer = new ResizeObserver(draw)
    observer.observe(box)
    return () => {
      observer?.disconnect()
      for (const image of [frame, light, cloud]) {
        image.removeEventListener('load', draw)
      }
    }
  }, [boxRef])

  if (failed) {
    return (
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-1 rounded bg-[#132a52]"
      />
    )
  }

  return (
    <>
      <canvas
        ref={frameCanvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[1] block h-full w-full"
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
