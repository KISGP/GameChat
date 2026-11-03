import type { AssetManager, SceneRenderer } from '@esotericsoftware/spine-webgl'

/** 气泡画布相对气泡可视盒四周的外扩像素，给伸出框外的部件留出视口。 */
export const CANVAS_MARGIN_PX = 90

/**
 * @description 气泡帧渲染层标识：波仔的阴影剪影垫在面板之下（back），其余层绘制在面板之上。
 */
export type SpineBubbleFrameLayer = 'back' | 'main'

/**
 * @description 气泡帧单层绘制的回调签名，由共享渲染服务在每帧的子视口内调用。
 * @param renderer 共享渲染服务的场景渲染器，调用发生在 begin 与 end 之间。
 * @param layer 目标画布对应的渲染层。
 * @param boxWidth 气泡可视盒的 css 宽度。
 * @param boxHeight 气泡可视盒的 css 高度。
 * @param deltaSeconds 距上一帧的秒数；静帧渲染时为 0。
 */
export type SpineBubbleFrameDraw = (
  renderer: SceneRenderer,
  layer: SpineBubbleFrameLayer,
  boxWidth: number,
  boxHeight: number,
  deltaSeconds: number
) => void

/**
 * @description 单个气泡样式的部件集合：按样式加载资产后构建的可复用绘制器。
 * @remarks 同一样式的骨架与纹理只构建一次，由全部目标共享；绘制本身无状态，
 *          依赖调用方传入的盒尺寸与层级参数。
 */
export type SpineBubbleFrameRig = {
  // 按层绘制该样式气泡帧的回调
  draw: SpineBubbleFrameDraw
}

/**
 * @description 单个气泡样式的部件集合加载器签名，接收共享渲染服务的资产管理器。
 */
export type SpineBubbleFrameRigLoader = (manager: AssetManager) => Promise<SpineBubbleFrameRig>
