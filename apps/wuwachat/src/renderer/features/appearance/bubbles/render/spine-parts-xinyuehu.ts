import {
  AtlasAttachmentLoader,
  AnimationState,
  AnimationStateData,
  Skeleton,
  SkeletonBinary
} from '@esotericsoftware/spine-webgl'
import type {
  AssetManager,
  GLTexture,
  SceneRenderer,
  TextureAtlas
} from '@esotericsoftware/spine-webgl'
import { SPINE_ASSETS } from '@renderer/common/lib/spine-assets'
import {
  BUBBLE_FRAME_DARK_SRC,
  BUBBLE_FRAME_GOLD_SRC,
  BUBBLE_FRAME_SCALE,
  FRAME_SLICE
} from '../catalog'
import { CANVAS_MARGIN_PX, type SpineBubbleFrameRig } from './spine-bubble-shared'

/**
 * @description 气泡金框部件的钉边布局声明。
 * @remarks 锚点以文字盒为参照：ax/ay 为盒宽高上的比例位置（0 为左/顶缘，1 为右/底缘），
 *          offsetX/offsetY 为自锚点起的像素微调；中心校正是该实例可见附件在骨架坐标系
 *          （y 向上）中的包围盒中心，用于把部件中心对齐到锚点。
 */
type BubblePartSpec = {
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
  // 可见附件包围盒中心的骨架 x 坐标
  centerX: number
  // 可见附件包围盒中心的骨架 y 坐标
  centerY: number
  // 是否绘制在底框图层之下；缺省绘制在底框之上
  belowFrame?: boolean
}

/**
 * @description 气泡底框图层的绘制参数。
 */
type BubbleFrameLayerSpec = {
  // 底框纹理图片 URL
  textureUrl: string
  // 纹理原生九宫格切片（像素，图片左上原点）
  slice: { left: number; right: number; top: number; bottom: number }
  // 切片显示缩放，1 为按原生像素尺寸绘制边角
  scale: number
}

/** 狐头组锚定基准：可见附件中心钉在盒左缘 +1px、顶缘 +11px。 */
const FOX_HEAD_OFFSET = { x: 1, y: 11 }

/** 狐尾相对狐头的刚性偏移（模型原生大小下的标定值）；实际间距按 BUBBLE_MODEL_SCALE 等比缩小。 */
const FOX_TAIL_DELTA = { x: -2, y: 40 }

/** 模型整体显示缩放，1 为原生大小；缩放围绕各部件锚点进行，钉边关系与标定偏移不受影响。 */
const BUBBLE_MODEL_SCALE = 0.6

const BUBBLE_PARTS: readonly BubblePartSpec[] = [
  {
    animation: 'idle_LB2',
    ax: 0,
    ay: 0,
    offsetX: FOX_HEAD_OFFSET.x + FOX_TAIL_DELTA.x * BUBBLE_MODEL_SCALE,
    offsetY: FOX_HEAD_OFFSET.y + FOX_TAIL_DELTA.y * BUBBLE_MODEL_SCALE,
    centerX: -116,
    centerY: -13,
    belowFrame: true
  },
  { animation: 'idle_RA', ax: 1, ay: 1, offsetX: -20, offsetY: -20, centerX: 91, centerY: -2 },
  {
    animation: 'idle_LB',
    ax: 0,
    ay: 0,
    offsetX: FOX_HEAD_OFFSET.x,
    offsetY: FOX_HEAD_OFFSET.y,
    centerX: -109,
    centerY: 27
  }
]

/** 心月狐底框图层清单：金框在下、深色磨砂框在上，与游戏内气泡的双层结构一致。 */
const FRAME_LAYERS: readonly BubbleFrameLayerSpec[] = [
  { textureUrl: BUBBLE_FRAME_GOLD_SRC, slice: FRAME_SLICE, scale: BUBBLE_FRAME_SCALE },
  { textureUrl: BUBBLE_FRAME_DARK_SRC, slice: FRAME_SLICE, scale: BUBBLE_FRAME_SCALE }
]

/**
 * @description 加载心月狐气泡的图集、骨架与底框纹理，构建可复用的部件绘制器。
 * @param manager 共享渲染服务的资产管理器。
 * @returns 就绪的部件集合；加载或骨架解析失败时 reject。
 */
export async function loadXinyuehuBubbleFrameRig(
  manager: AssetManager
): Promise<SpineBubbleFrameRig> {
  const asset = SPINE_ASSETS.UiItem_PhoneChatBg003
  const atlas = await loadAtlas(manager, asset.atlasUrl, asset.pageName, asset.pngUrl)
  const skelBytes = await loadSkeletonBytes(manager, asset.skelUrl)
  const frameTextures = await Promise.all(
    FRAME_LAYERS.map((layer) => loadFrameTexture(manager, layer.textureUrl))
  )
  const skeletonData = new SkeletonBinary(new AtlasAttachmentLoader(atlas)).readSkeletonData(
    skelBytes
  )
  const parts = BUBBLE_PARTS.map((part) => {
    const skeleton = new Skeleton(skeletonData)
    const state = new AnimationState(new AnimationStateData(skeletonData))
    skeleton.setToSetupPose()
    state.setAnimation(0, part.animation, true)
    return { skeleton, state }
  })

  /**
   * @description 绘制满足过滤条件的部件，按钉边规则摆放后再提交渲染器。
   * @param include 部件声明过滤谓词。
   * @param boxWidth 气泡可视盒的 css 宽度。
   * @param boxHeight 气泡可视盒的 css 高度。
   * @remarks 锚定参照为文字盒边缘；标定的 offsetX/offsetY 语义为自参照边缘起的像素微调。
   *          缩放围绕骨架原点进行，中心校正需同步乘缩放，部件中心才能继续钉在锚点上。
   */
  const drawPartsWhere = (
    renderer: SceneRenderer,
    include: (spec: BubblePartSpec) => boolean,
    boxWidth: number,
    boxHeight: number
  ): void => {
    parts.forEach((part, index) => {
      const spec = BUBBLE_PARTS[index]
      if (!include(spec)) return
      const anchorX = CANVAS_MARGIN_PX + spec.ax * boxWidth + spec.offsetX
      const anchorY = CANVAS_MARGIN_PX + spec.ay * boxHeight + spec.offsetY
      part.skeleton.scaleX = BUBBLE_MODEL_SCALE
      part.skeleton.scaleY = BUBBLE_MODEL_SCALE
      part.skeleton.x = anchorX - spec.centerX * BUBBLE_MODEL_SCALE
      part.skeleton.y = -anchorY - spec.centerY * BUBBLE_MODEL_SCALE
      part.skeleton.updateWorldTransform()
      renderer.drawSkeleton(part.skeleton, false)
    })
  }

  /**
   * @description 按声明顺序绘制底框图层，每层以九宫格切分为 9 个 UV 四边形。
   * @param boxWidth 气泡可视盒的 css 宽度。
   * @param boxHeight 气泡可视盒的 css 高度。
   * @remarks 统一气泡几何模型：底框参照矩形 = 文字盒，包边带画在盒内、占据 padding 区，
   *          中心填充区盖住内容区，气泡总尺寸与文字盒一致。
   *          纹理无 Y 翻转，GL 的 v=0 为图片底行，css 行段与 GL v 区间按此换算。
   */
  const drawFrameLayers = (renderer: SceneRenderer, boxWidth: number, boxHeight: number): void => {
    frameTextures.forEach((frame, index) => {
      const layer = FRAME_LAYERS[index]
      const { left, right, top, bottom } = layer.slice
      const scale = layer.scale
      const tw = frame.width
      const th = frame.height
      // 底框参照矩形 = 文字盒：分段边界由盒边缘向内推包边显示厚度
      const boxX = CANVAS_MARGIN_PX
      const boxY = CANVAS_MARGIN_PX
      const xs = [boxX, boxX + left * scale, boxX + boxWidth - right * scale, boxX + boxWidth]
      const ys = [boxY, boxY + top * scale, boxY + boxHeight - bottom * scale, boxY + boxHeight]
      // 各分段对应的图片列/行段（像素）；行段按 css 自上而下顺序排列
      const colSegs = [0, left, tw - right, tw]
      const rowSegs = [0, top, th - bottom, th]
      for (let iy = 0; iy < 3; iy += 1) {
        for (let ix = 0; ix < 3; ix += 1) {
          const px0 = xs[ix]
          const px1 = xs[ix + 1]
          const py0 = ys[iy]
          const py1 = ys[iy + 1]
          if (px1 <= px0 || py1 <= py0) continue
          // css 行段换算 GL v 区间：GL v=0 为图片底行
          const vBottom = 1 - rowSegs[iy + 1] / th
          const vTop = 1 - rowSegs[iy] / th
          renderer.drawTextureUV(
            frame.texture,
            px0,
            -py1,
            px1 - px0,
            py1 - py0,
            colSegs[ix] / tw,
            vBottom,
            colSegs[ix + 1] / tw,
            vTop
          )
        }
      }
    })
  }

  return {
    /**
     * @description 绘制心月狐气泡帧的单帧。
     * @remarks 绘制顺序：框下层部件（狐尾）→ 底框图层 → 框上层部件（狐头），只响应主层目标。
     */
    draw: (renderer, layer, boxWidth, boxHeight, deltaSeconds) => {
      if (layer !== 'main') return
      parts.forEach((part) => {
        part.state.update(deltaSeconds)
        part.state.apply(part.skeleton)
      })
      drawPartsWhere(renderer, (spec) => spec.belowFrame === true, boxWidth, boxHeight)
      drawFrameLayers(renderer, boxWidth, boxHeight)
      drawPartsWhere(renderer, (spec) => spec.belowFrame !== true, boxWidth, boxHeight)
    }
  }
}

/**
 * @description 加载图集并按 fileAlias 关联带 hash 的页面纹理。
 * @param manager 共享渲染服务的资产管理器。
 * @param atlasUrl 图集文本 URL。
 * @param pageName 图集内声明的页面纹理原名。
 * @param pngUrl 实际页面纹理 URL。
 * @returns 解析完成的纹理图集；加载失败时 reject。
 */
async function loadAtlas(
  manager: AssetManager,
  atlasUrl: string,
  pageName: string,
  pngUrl: string
): Promise<TextureAtlas> {
  return new Promise((resolve, reject) => {
    manager.loadTextureAtlas(
      atlasUrl,
      (_path, atlas) => resolve(atlas),
      (_path, message) => reject(new Error(`气泡 atlas 加载失败：${message}`)),
      { [pageName]: pngUrl }
    )
  })
}

/**
 * @description 加载骨架二进制。
 * @param manager 共享渲染服务的资产管理器。
 * @param skelUrl 骨架二进制 URL。
 * @returns 骨架二进制字节；加载失败时 reject。
 */
async function loadSkeletonBytes(manager: AssetManager, skelUrl: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    manager.loadBinary(
      skelUrl,
      (_path, bytes) => resolve(bytes),
      (_path, message) => reject(new Error(`气泡骨架加载失败：${message}`))
    )
  })
}

/**
 * @description 加载底框图层纹理并解析其实际像素尺寸。
 * @param manager 共享渲染服务的资产管理器。
 * @param url 底框纹理图片 URL。
 * @returns 纹理尺寸就绪后 resolve；加载失败时 reject。
 * @remarks GLTexture 不回填纹理尺寸，需从图片元素读取（HTMLImageElement 用 natural 尺寸）。
 */
async function loadFrameTexture(
  manager: AssetManager,
  url: string
): Promise<{ texture: GLTexture; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    manager.loadTexture(
      url,
      (_path, texture) => {
        // AssetManager 在 spine-webgl 下只创建 GLTexture，签名声明的基类 Texture 可安全收窄
        const glTexture = texture as GLTexture
        const image = glTexture.getImage()
        const width = image instanceof HTMLImageElement ? image.naturalWidth : image.width
        const height = image instanceof HTMLImageElement ? image.naturalHeight : image.height
        resolve({ texture: glTexture, width, height })
      },
      (_path, message) => reject(new Error(`气泡底框纹理加载失败：${message}`))
    )
  })
}
