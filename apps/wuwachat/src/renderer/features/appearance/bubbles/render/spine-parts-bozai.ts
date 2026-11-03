import {
  AtlasAttachmentLoader,
  AnimationState,
  AnimationStateData,
  Skeleton,
  SkeletonBinary
} from '@esotericsoftware/spine-webgl'
import type {
  AssetManager,
  SceneRenderer,
  SkeletonData,
  TextureAtlas
} from '@esotericsoftware/spine-webgl'
import { SPINE_ASSETS } from '@renderer/common/lib/spine-assets'
import {
  CANVAS_MARGIN_PX,
  type SpineBubbleFrameLayer,
  type SpineBubbleFrameRig
} from './spine-bubble-shared'

/**
 * @description 波仔气泡部件声明：渲染层、槽位集、钉边偏移与同画布内的绘制层级。
 */
type BozaiPartSpec = {
  // 部件循环动画名
  animation: string
  // 渲染层：back 画在面板之下的阴影画布，main 画在面板之上的主画布
  layer: SpineBubbleFrameLayer
  // 该部件保留的槽位名集合，其余槽位附件全部剔除
  slots: readonly string[]
  // 锚点在盒宽上的比例位置：0 为左缘（缺省），1 为右缘；屁股部件用 1 使尾部始终贴在气泡右上角
  ax?: number
  // 锚点在盒高上的比例位置：0 为顶缘（缺省），1 为底缘；脚部部件用 1 使双脚始终贴在气泡底缘
  ay?: number
  // 骨架原点相对锚点的水平偏移（css 像素）；锚点为左缘或右缘由 ax 决定
  offsetX: number
  // 骨架原点相对锚点的垂直偏移（css 像素）；锚点为顶缘或底缘由 ay 决定
  offsetY: number
  // 部件显示缩放，1 为骨架原生大小；缺省按 1 处理。缩放围绕骨架原点进行，缩放后的座位微调由 offset 承担
  scale?: number
  // 同画布内的绘制层级，小者先画
  z: number
}

/**
 * @description 波仔气泡部件表：头钉左上、屁股钉右上、双脚锚定底缘，各部件贴住所属角/缘，宽窄与折叠展开变化时构图不变。
 */
const BOZAI_PARTS: readonly BozaiPartSpec[] = [
  {
    animation: 'idle_head',
    slots: ['头y'],
    layer: 'back',
    offsetX: 38,
    offsetY: 12,
    scale: 0.6,
    z: 1
  },
  {
    animation: 'idle_head',
    slots: ['头', '左耳', '左耳y', '右耳', '右耳y', '呆毛', '呆毛y', '鬃毛', 'z', 'z2'],
    layer: 'main',
    offsetX: 38,
    offsetY: 12,
    scale: 0.6,
    z: 6
  },
  // {
  //   animation: 'idle_foot2',
  //   slots: ['后脚', '后脚y'],
  //   layer: 'main',
  //   ay: 1,
  //   offsetX: 211,
  //   offsetY: -134,
  //   scale: 0.5,
  //   z: 1
  // },
  // {
  //   animation: 'idle_foot1',
  //   slots: ['前脚', '前脚y'],
  //   layer: 'main',
  //   ay: 1,
  //   offsetX: 169,
  //   offsetY: -100,
  //   scale: 0.5,
  //   z: 2
  // },
  {
    animation: 'idle_hip',
    slots: ['屁股', '屁股y', '背毛1', '背毛1y', '背毛2', '背毛2y'],
    layer: 'main',
    ax: 1,
    offsetX: -41,
    offsetY: 18,
    scale: 0.5,
    z: 1
  }
]

/**
 * @description 按槽位名单裁剪骨架数据的默认皮肤附件。
 * @param data 待裁剪的骨架数据。
 * @param slots 保留附件的槽位名集合，集合外槽位的附件全部移除。
 * @remarks 必须在构造 Skeleton 实例之前调用；槽位附件从默认皮肤解析于 Skeleton 构造期，
 *          先裁剪再建实例即可让缺失附件的槽位保持空置。
 */
function stripSkinAttachments(data: SkeletonData, slots: readonly string[]): void {
  const skin = data.defaultSkin
  if (!skin) return
  data.slots.forEach((slot, index) => {
    const bucket = (skin.attachments as Record<number, Record<string, unknown>>)[index]
    if (!bucket || slots.includes(slot.name)) return
    for (const name of Object.keys(bucket)) {
      delete bucket[name]
    }
  })
}

/** 单个已构建部件：骨架实例与动画状态。 */
type BozaiPart = {
  // 部件骨架实例
  skeleton: Skeleton
  // 部件动画状态
  state: AnimationState
}

/** 待绘制行：部件声明与已构建实例的配对。 */
type BozaiDrawRow = {
  // 部件声明
  spec: BozaiPartSpec
  // 已构建部件实例
  part: BozaiPart
}

/**
 * @description 按部件声明构建骨架实例：解析独立的骨架数据副本、裁剪槽位并启动循环动画。
 * @param atlas 图集。
 * @param skelBytes 骨架二进制字节。
 * @param spec 部件声明。
 * @returns 就绪的部件实例。
 * @remarks 每个部件各自解析一份骨架数据并按声明槽位裁剪，使同一动画可按部件拆分渲染。
 */
function buildPart(atlas: TextureAtlas, skelBytes: Uint8Array, spec: BozaiPartSpec): BozaiPart {
  const data = new SkeletonBinary(new AtlasAttachmentLoader(atlas)).readSkeletonData(skelBytes)
  stripSkinAttachments(data, spec.slots)
  const skeleton = new Skeleton(data)
  skeleton.setToSetupPose()
  const state = new AnimationState(new AnimationStateData(data))
  state.setAnimation(0, spec.animation, true)
  return { skeleton, state }
}

/**
 * @description 加载波仔气泡的图集与骨架，构建可复用的部件绘制器。
 * @param manager 共享渲染服务的资产管理器。
 * @returns 就绪的部件集合；加载或骨架解析失败时 reject。
 * @remarks 图集与骨架字节只加载一次，各部件各自解析一份骨架数据并按声明槽位裁剪。
 */
export async function loadBozaiBubbleFrameRig(manager: AssetManager): Promise<SpineBubbleFrameRig> {
  const asset = SPINE_ASSETS.PhoneSystemChatRight
  const atlas = await new Promise<TextureAtlas>((resolve, reject) => {
    manager.loadTextureAtlas(
      asset.atlasUrl,
      (_path, value) => resolve(value),
      (_path, message) => reject(new Error(`波仔气泡 atlas 加载失败：${message}`))
    )
  })
  const skelBytes = await new Promise<Uint8Array>((resolve, reject) => {
    manager.loadBinary(
      asset.skelUrl,
      (_path, bytes) => resolve(bytes),
      (_path, message) => reject(new Error(`波仔气泡骨架加载失败：${message}`))
    )
  })
  const parts = BOZAI_PARTS.map((spec) => buildPart(atlas, skelBytes, spec))

  /**
   * @description 绘制单个渲染层的一帧，部件按声明 z 升序摆放后提交渲染器。
   * @param rows 目标层的待绘制行。
   * @param boxWidth 气泡可视盒的 css 宽度，供右缘锚定部件换算横向位置。
   * @param boxHeight 气泡可视盒的 css 高度，供底缘锚定部件换算纵向位置。
   */
  const drawLayer = (
    renderer: SceneRenderer,
    rows: readonly BozaiDrawRow[],
    boxWidth: number,
    boxHeight: number
  ): void => {
    const ordered = rows.slice().sort((a, b) => a.spec.z - b.spec.z)
    ordered.forEach(({ spec, part }) => {
      const scale = spec.scale ?? 1
      part.skeleton.scaleX = scale
      part.skeleton.scaleY = scale
      part.skeleton.x = CANVAS_MARGIN_PX + (spec.ax ?? 0) * boxWidth + spec.offsetX
      part.skeleton.y = -(CANVAS_MARGIN_PX + (spec.ay ?? 0) * boxHeight + spec.offsetY)
      part.skeleton.updateWorldTransform()
      renderer.drawSkeleton(part.skeleton, false)
    })
  }

  return {
    /**
     * @description 绘制波仔气泡帧的单层：back（头y 剪影，垫在面板之下）或 main
     *              （面板之上的脚/屁股/头）。
     */
    draw: (renderer, layer, boxWidth, boxHeight, deltaSeconds) => {
      const rows = BOZAI_PARTS.map((spec, index) => ({ spec, part: parts[index] })).filter(
        (row) => row.spec.layer === layer
      )
      if (rows.length === 0) return
      rows.forEach(({ part }) => {
        part.state.update(deltaSeconds)
        part.state.apply(part.skeleton)
      })
      drawLayer(renderer, rows, boxWidth, boxHeight)
    }
  }
}
