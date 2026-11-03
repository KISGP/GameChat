import {
  AtlasAttachmentLoader,
  AnimationState,
  AnimationStateData,
  Skeleton,
  SkeletonBinary
} from '@esotericsoftware/spine-webgl'
import type { AssetManager, TextureAtlas } from '@esotericsoftware/spine-webgl'
import { SPINE_ASSETS } from '@renderer/common/lib/spine-assets'
import { CANVAS_MARGIN_PX, type SpineBubbleFrameRig } from './spine-bubble-shared'

/**
 * @description 大卫·马丁内斯气泡部件的钉边布局声明。
 * @remarks 锚点以文字盒为参照：ax/ay 为盒宽高上的比例位置（0 为左/顶缘，1 为右/底缘），
 *          offsetX/offsetY 为自锚点起的像素微调；centerX/centerY 为该实例可见附件在骨架
 *          坐标系（y 向上）中的包围盒中心，用于把部件中心对齐到锚点；scale 为部件独立显示缩放。
 */
type DaweiPartSpec = {
  // 部件循环动画名
  animation: string
  // 锚点在盒宽上的比例位置
  ax: number
  // 锚点在盒高上的比例位置
  ay: number
  // 锚点的水平像素偏移
  offsetX: number
  // 锚点的垂直像素偏移
  offsetY: number
  // 部件独立显示缩放
  scale: number
  // 可见附件包围盒中心的骨架 x 坐标
  centerX: number
  // 可见附件包围盒中心的骨架 y 坐标
  centerY: number
}

/**
 * @description 大卫·马丁内斯气泡两个部件的钉边规则与标定值。
 * @remarks 杯可见附件中心钉在盒左缘 +94px、底缘 -41px，月亮钉在盒右缘 -81px、顶缘 +26px，
 *          两者独立缩放 0.7；数值来自气泡原型标定（.tmp/chatbg002-bubble.html）。
 */
const DAWEI_PARTS: readonly DaweiPartSpec[] = [
  {
    animation: 'idle_LB',
    ax: 0,
    ay: 0,
    offsetX: 50,
    offsetY: 25,
    scale: 0.55,
    centerX: -119.28,
    centerY: 4.95
  },
  {
    animation: 'idle_RA',
    ax: 1,
    ay: 0,
    offsetX: -60,
    offsetY: 26,
    scale: 0.7,
    centerX: 132.21,
    centerY: 14.5
  }
]

/**
 * @description 加载大卫·马丁内斯气泡的图集与骨架，构建可复用的部件绘制器。
 * @param manager 共享渲染服务的资产管理器。
 * @returns 就绪的部件集合；加载或骨架解析失败时 reject。
 */
export async function loadDaweiBubbleFrameRig(manager: AssetManager): Promise<SpineBubbleFrameRig> {
  const asset = SPINE_ASSETS.UiItem_PhoneChatBg002
  const atlas = await new Promise<TextureAtlas>((resolve, reject) => {
    manager.loadTextureAtlas(
      asset.atlasUrl,
      (_path, value) => resolve(value),
      (_path, message) => reject(new Error(`大卫·马丁内斯气泡 atlas 加载失败：${message}`))
    )
  })
  const skelBytes = await new Promise<Uint8Array>((resolve, reject) => {
    manager.loadBinary(
      asset.skelUrl,
      (_path, bytes) => resolve(bytes),
      (_path, message) => reject(new Error(`大卫·马丁内斯气泡骨架加载失败：${message}`))
    )
  })
  const skeletonData = new SkeletonBinary(new AtlasAttachmentLoader(atlas)).readSkeletonData(
    skelBytes
  )
  const parts = DAWEI_PARTS.map((part) => {
    const skeleton = new Skeleton(skeletonData)
    const state = new AnimationState(new AnimationStateData(skeletonData))
    skeleton.setToSetupPose()
    state.setAnimation(0, part.animation, true)
    return { skeleton, state }
  })

  return {
    /**
     * @description 绘制大卫·马丁内斯气泡帧的单帧。
     * @remarks 锚定参照为文字盒边缘；缩放围绕骨架原点进行，中心校正需同步乘缩放，
     *          部件中心才能继续钉在锚点上。底板、星空平铺与云带由调用方的 DOM 图层绘制，
     *          本绘制器只负责两个 Spine 部件，只响应主层目标。
     */
    draw: (renderer, layer, boxWidth, boxHeight, deltaSeconds) => {
      if (layer !== 'main') return
      parts.forEach((part) => {
        part.state.update(deltaSeconds)
        part.state.apply(part.skeleton)
      })
      parts.forEach((part, index) => {
        const spec = DAWEI_PARTS[index]
        const anchorX = CANVAS_MARGIN_PX + spec.ax * boxWidth + spec.offsetX
        const anchorY = CANVAS_MARGIN_PX + spec.ay * boxHeight + spec.offsetY
        part.skeleton.scaleX = spec.scale
        part.skeleton.scaleY = spec.scale
        part.skeleton.x = anchorX - spec.centerX * spec.scale
        part.skeleton.y = -anchorY - spec.centerY * spec.scale
        part.skeleton.updateWorldTransform()
        renderer.drawSkeleton(part.skeleton, false)
      })
    }
  }
}
