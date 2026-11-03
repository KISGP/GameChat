import {
  AssetManager,
  ManagedWebGLRenderingContext,
  SceneRenderer
} from '@esotericsoftware/spine-webgl'
import { trackError } from '@renderer/app/telemetry'
import {
  CANVAS_MARGIN_PX,
  type SpineBubbleFrameLayer,
  type SpineBubbleFrameRig,
  type SpineBubbleFrameRigLoader
} from './spine-bubble-shared'
import { loadBozaiBubbleFrameRig } from './spine-parts-bozai'
import { loadDaweiBubbleFrameRig } from './spine-parts-dawei'
import { loadXinyuehuBubbleFrameRig } from './spine-parts-xinyuehu'

/** 渲染循环单帧步长的上限，防止切后台恢复后的大步进跳变。 */
const MAX_DELTA_SECONDS = 0.1

/** 上下文丢失批次合并窗口（毫秒）：窗口内的后续丢失只累计次数，由批首那次恢复统一处理。 */
const CONTEXT_LOSS_BATCH_WINDOW_MS = 1000

/**
 * @description 支持的气泡样式部件集合标识。
 */
export type SpineBubbleRigKey = 'xinyuehu' | 'dawei' | 'bozai'

/** 各样式部件集合的加载器清单；键与 SpineBubbleRigKey 一一对应。 */
const RIG_LOADERS: Record<SpineBubbleRigKey, SpineBubbleFrameRigLoader> = {
  xinyuehu: loadXinyuehuBubbleFrameRig,
  dawei: loadDaweiBubbleFrameRig,
  bozai: loadBozaiBubbleFrameRig
}

/**
 * @description 注册一个气泡帧渲染目标的参数。
 */
export type SpineBubbleTargetOptions = {
  // 目标使用的样式部件集合
  rigKey: SpineBubbleRigKey
  // 目标画布对应的渲染层；波仔阴影剪影为 back，其余为 main
  layer: SpineBubbleFrameLayer
  // 承接转印结果的 2D 画布；css 尺寸须为盒尺寸加四周 CANVAS_MARGIN_PX 外扩
  canvas: HTMLCanvasElement
  // 气泡可视盒元素，尺寸变化时触发重绘
  box: HTMLElement
  // 是否播放动画；false 时仅在注册与盒尺寸变化时绘制静帧
  animated: boolean
  // 部件集合加载失败时的回调；同集合的全部目标都会收到同一错误
  onError: (error: unknown) => void
}

/**
 * @description 气泡帧渲染目标句柄。
 */
export type SpineBubbleTarget = {
  /**
   * @description 设置该目标是否播放动画。
   * @param animated true 为跟随渲染循环播放，false 为停帧静绘。
   * @remarks 切到静绘时立即绘制一帧当前姿态；切回动画时由渲染循环接管。
   */
  setAnimated(animated: boolean): void
  /**
   * @description 注销目标并停止观察其盒尺寸；目标画布不再被写入。
   */
  release(): void
}

/** 服务内登记的单个渲染目标。 */
type TargetEntry = {
  // 目标使用的样式部件集合
  rigKey: SpineBubbleRigKey
  // 目标画布对应的渲染层
  layer: SpineBubbleFrameLayer
  // 承接转印结果的 2D 画布
  canvas: HTMLCanvasElement
  // 气泡可视盒元素
  box: HTMLElement
  // 是否播放动画
  animated: boolean
  // 部件集合加载失败回调
  onError: (error: unknown) => void
  // 盒尺寸观察器
  observer: ResizeObserver | null
  // 目标画布的 2D 上下文缓存；获取失败时保持 null
  ctx2d: CanvasRenderingContext2D | null
  // 已就绪的部件集合；加载中或加载失败时为 null
  rig: SpineBubbleFrameRig | null
  // 气泡可视盒的 css 宽度
  boxWidth: number
  // 气泡可视盒的 css 高度
  boxHeight: number
}

/**
 * @description 气泡帧的共享 WebGL 渲染服务：全局唯一 GL 上下文，按注册目标逐个在共享画布的
 *              子视口内绘制并转印到各自画布，消除每条消息独占上下文的资源粒度。
 * @remarks 目标画布的位图尺寸由服务按盒尺寸加外扩逐帧对齐；共享画布尺寸取全部已就绪
 *          目标的最大值，子视口固定画布左下角原点，与部件的世界坐标系（css 像素、y 取负向上）
 *          一致。WebGL 上下文被浏览器丢弃时按批合并恢复：批首丢失立即重建，窗口内后续丢失
 *          只累计次数，批末写一条带次数的日志。服务随首个目标惰性创建，末个目标注销后保持
 *          常驻以避免滚动时的资产反复加载。本服务是渲染层唯一的 WebGL 上下文入口，其余代码
 *          不得自行获取 GL 上下文，新增 GPU 绘制需求一律扩展本服务。
 */
class SpineBubbleRenderService {
  // 共享绘制画布（脱离 DOM）；上下文丢失后整块重建
  private canvas: HTMLCanvasElement | null = null
  // 受管 WebGL 上下文
  private context: ManagedWebGLRenderingContext | null = null
  // 场景渲染器
  private renderer: SceneRenderer | null = null
  // 资产管理器
  private assetManager: AssetManager | null = null
  // 按样式缓存的部件集合 Promise；失败的条目自动清除以便下次重试
  private readonly rigCache = new Map<SpineBubbleRigKey, Promise<SpineBubbleFrameRig>>()
  // 全部已注册目标
  private readonly targets = new Set<TargetEntry>()
  // 渲染循环句柄
  private raf: number | null = null
  // 上一帧时间戳
  private lastTime = 0
  // 进行中的上下文丢失批次；null 为空闲。窗口内后续丢失只累计次数，不重复恢复
  private contextLossBatch: { losses: number } | null = null

  /**
   * @description 创建服务并建立共享绘制画布与渲染设施。
   */
  constructor() {
    this.buildGraphics()
  }

  /**
   * @description 注册一个渲染目标并开始观察其盒尺寸。
   * @param options 目标参数。
   * @returns 目标句柄。
   * @remarks 部件集合加载完成前目标不绘制；减少动效偏好下加载完成即绘制一帧静帧。
   */
  register(options: SpineBubbleTargetOptions): SpineBubbleTarget {
    const entry: TargetEntry = {
      rigKey: options.rigKey,
      layer: options.layer,
      canvas: options.canvas,
      box: options.box,
      animated: options.animated,
      onError: options.onError,
      observer: null,
      ctx2d: null,
      rig: null,
      boxWidth: 0,
      boxHeight: 0
    }
    this.targets.add(entry)
    entry.observer = new ResizeObserver(() => {
      this.syncBoxSize(entry)
      if (entry.rig && !entry.animated) {
        this.renderTarget(entry, 0)
      }
    })
    entry.observer.observe(options.box)
    this.syncBoxSize(entry)
    void this.ensureTargetRig(entry)
    return {
      setAnimated: (animated) => this.setTargetAnimated(entry, animated),
      release: () => this.releaseTarget(entry)
    }
  }

  /**
   * @description 建立共享绘制画布、GL 上下文、场景渲染器与资产管理器，并挂接上下文丢失监听。
   * @remarks 画布脱离 DOM，仅作为转印源使用；上下文丢失后由 rebuildGraphics 整体重建。
   */
  private buildGraphics(): void {
    const canvas = document.createElement('canvas')
    canvas.addEventListener('webglcontextlost', this.handleContextLost)
    this.canvas = canvas
    this.context = new ManagedWebGLRenderingContext(canvas, {
      alpha: true,
      premultipliedAlpha: false,
      antialias: true
    })
    this.renderer = new SceneRenderer(canvas, this.context)
    this.assetManager = new AssetManager(this.context)
  }

  /**
   * @description 响应共享上下文丢失：按批合并——批首丢失立即整体重建，窗口内后续丢失只累计次数。
   * @param event 上下文丢失事件。
   * @remarks 事件必须 preventDefault 以保留恢复资格。批次窗口（CONTEXT_LOSS_BATCH_WINDOW_MS）
   *          结束时经 trackError 写一条带累计次数的日志并关闭批次；若上下文在窗口关闭后仍丢失，
   *          新批次会再次恢复，恢复频率由此被限到至多每窗口一次，丢失风暴不再放大为逐条日志
   *          与逐次全量重载。
   */
  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault()
    if (this.contextLossBatch) {
      this.contextLossBatch.losses += 1
      return
    }
    this.contextLossBatch = { losses: 1 }
    this.rebuildGraphics()
    setTimeout(() => {
      const batch = this.contextLossBatch
      this.contextLossBatch = null
      if (!batch) return
      trackError(
        'spine-bubble-render-context-lost',
        `Shared bubble renderer WebGL context lost ${batch.losses} time(s) within the batch window and rebuilt`,
        new Error('webglcontextlost')
      )
    }, CONTEXT_LOSS_BATCH_WINDOW_MS)
  }

  /**
   * @description 丢弃旧画布与渲染设施并整体重建，随后让全部目标重新加载部件集合。
   * @remarks 旧上下文已被浏览器整体回收，纹理与着色器随之释放，无需逐项清理；
   *          目标句柄保持有效，重新加载完成后按各自模式恢复绘制。
   */
  private rebuildGraphics(): void {
    this.renderer = null
    this.context = null
    this.assetManager = null
    this.rigCache.clear()
    this.targets.forEach((entry) => {
      entry.rig = null
    })
    this.buildGraphics()
    this.targets.forEach((entry) => {
      void this.ensureTargetRig(entry)
    })
  }

  /**
   * @description 获取指定样式的部件集合，缺失时经资产管理器加载并缓存。
   * @param key 样式部件集合标识。
   * @returns 部件集合 Promise；加载失败时不缓存，下一次获取自动重试。
   */
  private getRig(key: SpineBubbleRigKey): Promise<SpineBubbleFrameRig> {
    const cached = this.rigCache.get(key)
    if (cached) return cached
    const manager = this.assetManager
    if (!manager) return Promise.reject(new Error('气泡渲染服务资产管理器未就绪'))
    const pending = RIG_LOADERS[key](manager).catch((error: unknown) => {
      if (this.rigCache.get(key) === pending) this.rigCache.delete(key)
      throw error
    })
    this.rigCache.set(key, pending)
    return pending
  }

  /**
   * @description 确保目标对应的部件集合就绪，就绪后按目标模式恢复绘制。
   * @param entry 目标条目。
   * @remarks 加载失败时回调目标 onError，由调用方决定回退外观；目标已注销则忽略结果。
   */
  private async ensureTargetRig(entry: TargetEntry): Promise<void> {
    try {
      const rig = await this.getRig(entry.rigKey)
      if (!this.targets.has(entry)) return
      entry.rig = rig
      if (entry.animated) {
        this.ensureLoop()
      } else {
        this.renderTarget(entry, 0)
      }
    } catch (error) {
      if (!this.targets.has(entry)) return
      entry.onError(error)
    }
  }

  /**
   * @description 读取并缓存目标的盒尺寸。
   * @param entry 目标条目。
   */
  private syncBoxSize(entry: TargetEntry): void {
    entry.boxWidth = entry.box.offsetWidth
    entry.boxHeight = entry.box.offsetHeight
  }

  /**
   * @description 判断是否存在已就绪且在播放动画的目标。
   * @returns 存在返回 true。
   */
  private hasAnimatedReadyTarget(): boolean {
    for (const entry of this.targets) {
      if (entry.animated && entry.rig) return true
    }
    return false
  }

  /**
   * @description 更新目标的动画模式。
   * @param entry 目标条目。
   * @param animated true 为跟随渲染循环播放，false 为停帧静绘。
   */
  private setTargetAnimated(entry: TargetEntry, animated: boolean): void {
    if (entry.animated === animated) return
    entry.animated = animated
    if (!animated) {
      if (this.raf !== null && !this.hasAnimatedReadyTarget()) {
        cancelAnimationFrame(this.raf)
        this.raf = null
      }
      if (entry.rig) this.renderTarget(entry, 0)
      return
    }
    this.ensureLoop()
  }

  /**
   * @description 注销目标并停止观察；末个目标注销后停止渲染循环。
   * @param entry 目标条目。
   */
  private releaseTarget(entry: TargetEntry): void {
    entry.observer?.disconnect()
    entry.observer = null
    entry.rig = null
    this.targets.delete(entry)
    if (this.raf !== null && !this.hasAnimatedReadyTarget()) {
      cancelAnimationFrame(this.raf)
      this.raf = null
    }
  }

  /**
   * @description 确保存在动画目标时渲染循环在跑。
   */
  private ensureLoop(): void {
    if (this.raf !== null) return
    if (!this.hasAnimatedReadyTarget()) return
    this.lastTime = performance.now()
    this.raf = requestAnimationFrame(this.loop)
  }

  /**
   * @description 渲染循环：推进共享时间步长并逐个重绘动画目标。
   * @param now 当前帧时间戳。
   */
  private readonly loop = (now: number): void => {
    if (!this.hasAnimatedReadyTarget()) {
      this.raf = null
      return
    }
    this.raf = requestAnimationFrame(this.loop)
    const delta = Math.min((now - this.lastTime) / 1000, MAX_DELTA_SECONDS)
    this.lastTime = now
    this.targets.forEach((entry) => {
      if (entry.animated && entry.rig) {
        this.renderTarget(entry, delta)
      }
    })
  }

  /**
   * @description 将共享画布尺寸对齐为全部已就绪目标的最大设备像素需求。
   * @param width 当前目标的设备像素宽度。
   * @param height 当前目标的设备像素高度。
   * @remarks 尺寸变化会清空画布位图，转印前每个目标都会重绘自己的子视口，因此无残留影响。
   */
  private syncSharedCanvasSize(width: number, height: number): void {
    const canvas = this.canvas
    if (!canvas) return
    let maxWidth = width
    let maxHeight = height
    this.targets.forEach((entry) => {
      if (!entry.rig) return
      const dpr = window.devicePixelRatio || 1
      maxWidth = Math.max(maxWidth, Math.round((entry.boxWidth + CANVAS_MARGIN_PX * 2) * dpr))
      maxHeight = Math.max(maxHeight, Math.round((entry.boxHeight + CANVAS_MARGIN_PX * 2) * dpr))
    })
    if (canvas.width !== maxWidth) canvas.width = Math.max(1, maxWidth)
    if (canvas.height !== maxHeight) canvas.height = Math.max(1, maxHeight)
  }

  /**
   * @description 在共享画布的子视口内绘制目标内容并转印到目标画布。
   * @param entry 目标条目。
   * @param deltaSeconds 距上一帧的秒数；静帧渲染时为 0。
   * @remarks 子视口固定在画布左下角原点，相机与部件锚点的世界坐标系（css 像素、y 取负向上）
   *          与盒坐标换算保持一致；清除限定在子视口内，避免残留上一目标像素混入透明区。
   *          转印用 copy 合成整面覆盖目标画布，绘制缓冲在同一任务内读取，不经合成器回读。
   */
  private renderTarget(entry: TargetEntry, deltaSeconds: number): void {
    const rig = entry.rig
    const renderer = this.renderer
    const context = this.context
    const shared = this.canvas
    if (!rig || !renderer || !context || !shared) return
    const boxWidth = entry.boxWidth
    const boxHeight = entry.boxHeight
    if (boxWidth <= 0 || boxHeight <= 0) return
    const dpr = window.devicePixelRatio || 1
    const width = Math.max(1, Math.round((boxWidth + CANVAS_MARGIN_PX * 2) * dpr))
    const height = Math.max(1, Math.round((boxHeight + CANVAS_MARGIN_PX * 2) * dpr))
    this.syncSharedCanvasSize(width, height)
    const gl = context.gl
    // 清除限定在子视口：上一目标残留像素不得混入本目标的透明区
    gl.enable(gl.SCISSOR_TEST)
    gl.scissor(0, 0, width, height)
    gl.viewport(0, 0, width, height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.disable(gl.SCISSOR_TEST)
    renderer.camera.setViewport(width, height)
    // 正交窗口 = 子视口 css 尺寸：1 世界单位 = 1 css 像素，部件大小恒定
    renderer.camera.zoom = 1 / dpr
    renderer.camera.position.x = width / dpr / 2
    renderer.camera.position.y = -(height / dpr / 2)
    renderer.camera.update()
    renderer.begin()
    rig.draw(renderer, entry.layer, boxWidth, boxHeight, deltaSeconds)
    renderer.end()
    if (entry.canvas.width !== width) entry.canvas.width = width
    if (entry.canvas.height !== height) entry.canvas.height = height
    if (!entry.ctx2d) entry.ctx2d = entry.canvas.getContext('2d')
    const ctx = entry.ctx2d
    if (!ctx) return
    // GL 的 y=0 在画布底行，子视口位于左下角，故源矩形取呈现坐标系的底部区域
    ctx.globalCompositeOperation = 'copy'
    ctx.drawImage(shared, 0, shared.height - height, width, height, 0, 0, width, height)
    ctx.globalCompositeOperation = 'source-over'
  }
}

/** 惰性单例；模块 import 无副作用，首个目标注册时才建立 GL 设施。 */
let service: SpineBubbleRenderService | null = null

/**
 * @description 注册一个气泡帧渲染目标，首次调用时创建共享渲染服务单例。
 * @param options 目标参数。
 * @returns 目标句柄。
 * @remarks 服务常驻复用同一 GL 上下文与资产；目标画布的 css 尺寸须为盒尺寸加四周
 *          CANVAS_MARGIN_PX 外扩，与转印坐标一致。
 */
export function registerSpineBubbleFrameTarget(
  options: SpineBubbleTargetOptions
): SpineBubbleTarget {
  if (!service) {
    service = new SpineBubbleRenderService()
  }
  return service.register(options)
}
