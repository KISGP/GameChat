import {
  AssetManager,
  AtlasAttachmentLoader,
  AnimationState,
  AnimationStateData,
  ManagedWebGLRenderingContext,
  SceneRenderer,
  Skeleton,
  SkeletonBinary
} from '@esotericsoftware/spine-webgl'
import type { TextureAtlas } from '@esotericsoftware/spine-webgl'
import { trackError } from '@renderer/app/telemetry'
import type { SpineAssetEntry } from './spine-assets'

/** 取景时在编辑器授权视口四周保留的留白比例。 */
const FIT_PADDING = 1.1
/** 采样动画姿态判断可见性时前进的秒数，用于跳过首帧未挂载附件的空姿态。 */
const SAMPLE_ADVANCE_SECONDS = 0.5
/** 渲染循环单帧步长的上限，防止切后台恢复后的大步进跳变。 */
const MAX_DELTA_SECONDS = 0.1
/** 点击命中的最小像素 alpha，低于该值视为点中透明区域。 */
const ALPHA_HIT_THRESHOLD = 8

/**
 * @description 骨架编辑器授权视口尺寸（模型单位），用于父级按模型宽高比适配容器。
 */
export type SpineFitBounds = {
  // 视口宽度（模型单位）
  width: number
  // 视口高度（模型单位）
  height: number
}

/**
 * @description Spine 播放器的可选项。
 */
export type SpineViewerOptions = {
  // 初始循环动画名，缺省时自动挑选首个非空姿态动画
  defaultAnimation?: string
  // 是否自动开始播放
  autoplay?: boolean
  // 播放速度倍率
  speed?: number
  // 模型显示缩放倍率；1 为按授权视口 contain 贴满，大于 1 放大、小于 1 缩小
  scale?: number
  // 点击命中不透明像素时的回调；透明区域点击不触发
  onTap?: () => void
}

/**
 * @description 基于 spine-webgl 的单画布 Spine 播放器，负责资源加载、固定取景与渲染循环。
 * @remarks 一个实例独占一个 WebGL 上下文；卸载必须调用 dispose 释放纹理、着色器与上下文。
 *          取景使用编辑器授权视口（SkeletonData.x/y/width/height）在加载时一次性固定，
 *          动画期间相机不变，模型大小与位置保持恒定，与游戏内表现一致。
 */
export class SpineViewer {
  // 播放器绑定的画布元素
  private readonly canvas: HTMLCanvasElement
  // 待加载的 Spine 三件套资源
  private readonly asset: SpineAssetEntry
  // 播放器可选项
  private readonly options: SpineViewerOptions
  // 受管 WebGL 上下文
  private context: ManagedWebGLRenderingContext | null = null
  // 场景渲染器
  private renderer: SceneRenderer | null = null
  // 资源管理器
  private assetManager: AssetManager | null = null
  // 骨架实例
  private skeleton: Skeleton | null = null
  // 动画状态
  private state: AnimationState | null = null
  // 固定取景中心与尺寸（编辑器授权视口），加载时一次性确定
  private view = { cx: 0, cy: 0, sx: 100, sy: 100 }
  // 渲染循环句柄
  private raf: number | null = null
  // 上一帧时间戳
  private lastTime = 0
  // 是否处于播放状态
  private playing: boolean
  // 是否被宿主挂起：挂起期间取消渲染循环，不推进动画也不绘制
  private suspended = false
  // 当前播放速度
  private speed: number
  // 当前模型显示缩放倍率
  private scale: number
  // 当前循环动画名
  private currentAnimation: string | null = null
  // 序列轮换模式的动画名清单；null 表示非序列模式
  private sequenceNames: readonly string[] | null = null
  // 是否已完成 dispose
  private disposed = false

  /**
   * @description 创建播放器实例；资源加载与渲染由 load 启动。
   * @param canvas 承载动画的画布元素。
   * @param asset 三件套资源描述。
   * @param options 播放选项。
   */
  constructor(canvas: HTMLCanvasElement, asset: SpineAssetEntry, options: SpineViewerOptions = {}) {
    this.canvas = canvas
    this.asset = asset
    this.options = options
    this.playing = options.autoplay ?? true
    this.speed = options.speed ?? 1
    this.scale = options.scale ?? 1
  }

  /**
   * @description 加载资源并启动渲染循环。
   * @returns 资源就绪后 resolve；加载或骨架解析失败时 reject。
   * @remarks dispose 之后调用会直接返回，不会产生新的渲染循环。
   */
  async load(): Promise<void> {
    if (this.disposed) return
    // preserveDrawingBuffer 供点击时回读像素 alpha 做命中判定
    this.context = new ManagedWebGLRenderingContext(this.canvas, {
      alpha: true,
      premultipliedAlpha: false,
      antialias: true,
      preserveDrawingBuffer: true
    })
    this.renderer = new SceneRenderer(this.canvas, this.context)
    this.assetManager = new AssetManager(this.context)
    const atlas = await this.loadAtlas()
    const skelBytes = await this.loadSkeletonBytes()
    if (this.disposed) return
    const skeletonData = new SkeletonBinary(new AtlasAttachmentLoader(atlas)).readSkeletonData(
      skelBytes
    )
    this.skeleton = new Skeleton(skeletonData)
    this.state = new AnimationState(new AnimationStateData(skeletonData))
    // 取景采用编辑器授权视口，加载时一次性固定；动画期间相机不再变化
    this.view = {
      cx: skeletonData.x + skeletonData.width / 2,
      cy: skeletonData.y + skeletonData.height / 2,
      sx: skeletonData.width,
      sy: skeletonData.height
    }
    this.canvas.addEventListener('click', this.handleTap)
    this.canvas.addEventListener('mousemove', this.handleMove)
    this.setAnimation(this.resolveDefaultAnimation(), true)
    // 挂起状态下不启动渲染循环：宿主恢复时经 resume 统一启动
    if (this.suspended) {
      return
    }
    this.lastTime = performance.now()
    this.raf = requestAnimationFrame(this.loop)
  }

  /**
   * @description 加载 atlas 并按 fileAlias 关联带 hash 的页面纹理。
   * @returns 解析完成的纹理图集。
   */
  private loadAtlas(): Promise<TextureAtlas> {
    return new Promise((resolve, reject) => {
      this.assetManager?.loadTextureAtlas(
        this.asset.atlasUrl,
        (_path, atlas) => {
          if (this.disposed) {
            reject(new Error('SpineViewer 已在加载完成前释放'))
            return
          }
          resolve(atlas)
        },
        (_path, message) => reject(new Error(`Spine atlas 加载失败：${message}`)),
        { [this.asset.pageName]: this.asset.pngUrl }
      )
    })
  }

  /**
   * @description 加载骨架二进制。
   * @returns 骨架二进制字节。
   * @throws 实例在加载途中被 dispose 时抛出，保证返回的 Promise 必然落定。
   */
  private loadSkeletonBytes(): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      this.assetManager?.loadBinary(
        this.asset.skelUrl,
        (_path, bytes) => {
          if (this.disposed) {
            reject(new Error('SpineViewer 已在加载完成前释放'))
            return
          }
          resolve(bytes)
        },
        (_path, message) => reject(new Error(`Spine 骨架加载失败：${message}`))
      )
    })
  }

  /**
   * @description 解析初始动画：优先采用可选项指定的名称，否则挑选首个非空姿态动画。
   * @returns 动画名；骨架没有任何动画时返回 null。
   */
  private resolveDefaultAnimation(): string | null {
    const animations = this.skeleton?.data.animations ?? []
    if (animations.length === 0) return null
    const requested = this.options.defaultAnimation
    if (requested && animations.some((a) => a.name === requested)) return requested
    const first = animations[0].name
    if (this.countVisibleAttachments(first) > 0) return first
    return animations.find((a) => this.countVisibleAttachments(a.name) > 0)?.name ?? first
  }

  /**
   * @description 采样指定动画前进半秒后的可见附件数，用于识别空姿态动画。
   * @param name 动画名。
   * @returns 应用该动画姿态后挂有附件的槽位数量。
   */
  private countVisibleAttachments(name: string): number {
    if (!this.state || !this.skeleton) return 0
    this.state.setAnimation(0, name, true)
    this.state.update(SAMPLE_ADVANCE_SECONDS)
    this.state.apply(this.skeleton)
    this.skeleton.updateWorldTransform()
    let visible = 0
    for (const slot of this.skeleton.slots) {
      if (slot.attachment) visible += 1
    }
    this.state.clearTracks()
    return visible
  }

  /**
   * @description 校验动画名存在于骨架数据，缺失时记录错误日志。
   * @param name 待校验的动画名。
   * @returns 动画名存在时为 true。
   */
  private ensureAnimationExists(name: string): boolean {
    if (this.skeleton?.data.findAnimation(name)) return true
    trackError(
      'spine-viewer-animation-missing',
      `Spine 骨架不包含动画「${name}」，已忽略本次请求`,
      `Animation not found: ${name}`
    )
    return false
  }

  /**
   * @description 切换循环播放的动画，并退出序列轮换模式。
   * @param name 动画名；为 null 或骨架不包含该动画时不做任何事。
   * @param loop 是否循环播放。
   * @remarks 骨架不包含该动画时记日志后整体忽略，当前播放状态保持不变。
   */
  setAnimation(name: string | null, loop = true): void {
    if (!this.state || !name || !this.skeleton) return
    if (!this.ensureAnimationExists(name)) return
    this.sequenceNames = null
    this.currentAnimation = name
    this.state.clearTracks()
    // 被打断动画的时间轴不会自动回填，先重置 setup pose 清除属性残留
    this.skeleton.setToSetupPose()
    this.state.setAnimation(0, name, loop)
    this.applyPose()
  }

  /**
   * @description 进入序列轮换模式：按声明顺序依次各播一遍每个动画，
   *   播完最后一个后从头无限轮换。
   * @param names 依次轮换的动画名清单。
   */
  setAnimationSequence(names: readonly string[]): void {
    if (!this.state || !this.skeleton || names.length === 0) return
    this.sequenceNames = names
    this.state.clearTracks()
    this.skeleton.setToSetupPose()
    this.playSequenceAt(0)
    this.applyPose()
  }

  /**
   * @description 播放序列中指定索引的动画，并在其完成时链入下一个。
   * @param index 序列索引。
   */
  private playSequenceAt(index: number): void {
    if (!this.state || !this.sequenceNames) return
    const name = this.sequenceNames[index]
    this.currentAnimation = name
    const entry = this.state.setAnimation(0, name, false)
    // 条目级监听器随条目存活：单条目播完即链入下一个，被打断时随条目一并失效
    entry.listener = {
      complete: () => {
        const names = this.sequenceNames
        if (!names || !this.state) return
        this.playSequenceAt((index + 1) % names.length)
      }
    }
  }

  /**
   * @description 单次播放指定动画，播完自动回到指定循环动画或恢复序列轮换。
   * @param name 单次动画名；骨架不包含该动画时整体忽略。
   * @param returnTo 播完后回到的循环动画名；缺省时回到当前循环动画或序列。
   * @remarks 骨架不包含该动画时记日志后整体忽略，当前播放状态保持不变。
   */
  playOnce(name: string, returnTo?: string): void {
    if (!this.state || !this.skeleton) return
    if (!this.ensureAnimationExists(name)) return
    const back = returnTo ?? this.currentAnimation
    this.state.clearTracks()
    this.skeleton.setToSetupPose()
    const entry = this.state.setAnimation(0, name, false)
    // 条目级监听器随条目存活：条目被下一次点击打断时监听器一并失效，不会残留重入
    if (this.sequenceNames && this.sequenceNames.length > 0) {
      entry.listener = {
        complete: () => this.playSequenceAt(0)
      }
    } else if (back) {
      entry.listener = {
        complete: () => this.setAnimation(back, true)
      }
    }
    this.applyPose()
  }

  /**
   * @description 设置播放或暂停。
   * @param playing true 为播放，false 为暂停。
   */
  setPlaying(playing: boolean): void {
    this.playing = playing
  }

  /**
   * @description 挂起播放器：取消渲染循环，动画推进与画布绘制一并停止，画布保留最后一帧。
   * @remarks 供宿主不再可见时调用（例如被全屏覆盖层遮蔽）。与 setPlaying 的暂停不同：
   *   暂停只停动画推进、每帧绘制照常执行，挂起连绘制与画布尺寸同步一起停掉。
   *   重复挂起与 dispose 之后的调用为无操作。
   */
  suspend(): void {
    if (this.disposed || this.suspended) return
    this.suspended = true
    if (this.raf !== null) {
      cancelAnimationFrame(this.raf)
      this.raf = null
    }
  }

  /**
   * @description 恢复被挂起的播放器，重新启动渲染循环。
   * @remarks 未挂起或已 dispose 时为无操作；恢复帧从当前时刻重新计步，不补挂起期间的动画时间。
   */
  resume(): void {
    if (this.disposed || !this.suspended) return
    this.suspended = false
    this.lastTime = performance.now()
    if (this.raf === null) {
      this.raf = requestAnimationFrame(this.loop)
    }
  }

  /**
   * @description 设置播放速度倍率。
   * @param speed 速度倍率。
   */
  setSpeed(speed: number): void {
    this.speed = speed
  }

  /**
   * @description 设置模型显示缩放倍率；相对授权视口 contain 尺寸的倍数。
   * @param scale 缩放倍率，大于 1 放大、小于 1 缩小。
   */
  setScale(scale: number): void {
    this.scale = scale
  }

  /**
   * @description 返回骨架提供的全部动画名。
   * @returns 动画名数组；骨架未就绪时为空数组。
   */
  getAnimationNames(): string[] {
    return this.skeleton?.data.animations.map((animation) => animation.name) ?? []
  }

  /**
   * @description 返回当前循环播放的动画名。
   * @returns 动画名；尚未设置时为 null。
   */
  getCurrentAnimation(): string | null {
    return this.currentAnimation
  }

  /**
   * @description 释放渲染循环、纹理、着色器与 WebGL 上下文；实例不可复用。
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.raf !== null) {
      cancelAnimationFrame(this.raf)
      this.raf = null
    }
    this.canvas.removeEventListener('click', this.handleTap)
    this.canvas.removeEventListener('mousemove', this.handleMove)
    this.assetManager?.dispose()
    this.assetManager = null
    this.renderer?.dispose()
    this.renderer = null
    const gl = this.context?.gl
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    this.context = null
    this.skeleton = null
    this.state = null
  }

  /**
   * @description 返回编辑器授权视口尺寸。
   * @returns 视口宽高（模型单位）；骨架未就绪或视口无效时返回 null。
   */
  getFitBounds(): SpineFitBounds | null {
    if (
      !isFinite(this.view.sx) ||
      !isFinite(this.view.sy) ||
      this.view.sx <= 0 ||
      this.view.sy <= 0
    ) {
      return null
    }
    return { width: this.view.sx, height: this.view.sy }
  }

  /**
   * @description 画布点击回调：指针下像素透明时不触发 onTap。
   * @param event 点击事件。
   */
  private handleTap = (event: MouseEvent): void => {
    if (this.alphaAt(event.clientX, event.clientY) < ALPHA_HIT_THRESHOLD) return
    this.options.onTap?.()
  }

  /**
   * @description 画布悬停回调：指针位于模型不透明像素上时显示手型光标，透明区域恢复默认。
   * @param event 移动事件。
   */
  private handleMove = (event: MouseEvent): void => {
    this.canvas.style.cursor =
      this.alphaAt(event.clientX, event.clientY) >= ALPHA_HIT_THRESHOLD ? 'pointer' : 'default'
  }

  /**
   * @description 读取画布上指定客户端坐标处像素的 alpha 值。
   * @param clientX 客户端 X 坐标。
   * @param clientY 客户端 Y 坐标。
   * @returns 像素 alpha（0-255）；坐标越界或上下文缺失时返回 0。
   */
  private alphaAt(clientX: number, clientY: number): number {
    const context = this.context
    if (!context) return 0
    const rect = this.canvas.getBoundingClientRect()
    const x = Math.floor(((clientX - rect.left) / rect.width) * this.canvas.width)
    const y = Math.floor((1 - (clientY - rect.top) / rect.height) * this.canvas.height)
    if (x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height) return 0
    const gl = context.gl
    const pixel = new Uint8Array(4)
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
    return pixel[3]
  }

  /**
   * @description 应用当前轨道姿态到骨架。
   */
  private applyPose(): void {
    if (!this.state || !this.skeleton) return
    this.state.apply(this.skeleton)
    this.skeleton.updateWorldTransform()
  }

  /**
   * @description 渲染循环：推进动画、同步画布尺寸并绘制骨架。
   * @param now 当前帧时间戳。
   */
  private loop = (now: number): void => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.loop)
    const renderer = this.renderer
    const context = this.context
    if (!renderer || !context || !this.skeleton || !this.state) return
    const delta = Math.min((now - this.lastTime) / 1000, MAX_DELTA_SECONDS)
    this.lastTime = now
    if (this.playing) {
      this.state.update(delta * this.speed)
      this.state.apply(this.skeleton)
      this.skeleton.updateWorldTransform()
    }
    const dpr = window.devicePixelRatio || 1
    const bufferWidth = Math.max(1, Math.round(this.canvas.clientWidth * dpr))
    const bufferHeight = Math.max(1, Math.round(this.canvas.clientHeight * dpr))
    if (this.canvas.width !== bufferWidth || this.canvas.height !== bufferHeight) {
      this.canvas.width = bufferWidth
      this.canvas.height = bufferHeight
    }
    const gl = context.gl
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    renderer.camera.setViewport(this.canvas.width, this.canvas.height)
    // ortho zoom 是窗口缩放系数：zoom 越小模型越大，故显示缩放用除法叠加在 contain 基准上
    renderer.camera.zoom =
      Math.max(
        (this.view.sx * FIT_PADDING) / this.canvas.width,
        (this.view.sy * FIT_PADDING) / this.canvas.height
      ) / this.scale
    renderer.camera.position.x = this.view.cx
    renderer.camera.position.y = this.view.cy
    renderer.camera.update()
    renderer.begin()
    renderer.drawSkeleton(this.skeleton, false)
    renderer.end()
  }
}
