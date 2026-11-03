import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import { SPINE_ASSETS, type SpineAssetId } from '@renderer/common/lib/spine-assets'
import { SpineViewer, type SpineFitBounds } from '@renderer/common/lib/spine-viewer'
import { trackError } from '@renderer/app/telemetry'
import { cn } from '@renderer/common/lib/cn'

/**
 * @description Spine 挂载点宿主挂起状态上下文：值为 true 时，上下文内所有 SpineCanvas 挂起渲染循环；
 *   上下文外默认不挂起。
 */
const SpineSuspensionContext = createContext(false)

/**
 * @description 声明子树内全部 SpineCanvas 的宿主挂起状态，供全屏覆盖层遮蔽背景工作区时停掉背景动画渲染。
 * @param props 组件 props。
 * @returns 提供挂起上下文的容器元素。
 */
export function SpineSuspensionProvider({
  suspended,
  children
}: {
  // true 时子树内的 SpineCanvas 挂起渲染循环
  suspended: boolean
  // 需要接收挂起状态的子树
  children: ReactNode
}): ReactElement {
  return (
    <SpineSuspensionContext.Provider value={suspended}>{children}</SpineSuspensionContext.Provider>
  )
}

type SpineCanvasProps = {
  // 要播放的资产标识
  assetId: SpineAssetId
  // 依次轮换播放的动画名清单：多个时各播一遍后从头循环，单个时无限循环；
  // 变更该值会重新加载资产
  animations: readonly string[]
  // 初始是否自动播放
  autoplay?: boolean
  // 初始播放速度倍率
  speed?: number
  // 模型显示缩放倍率；后续变更即时生效
  scale?: number
  // 点击画布时轮流单次播放的互动动画清单；播完回到循环动画；仅命中不透明像素时触发
  tapAnimations?: readonly string[]
  // 资产加载完成后回报骨架包围盒尺寸（模型单位），供父级按宽高比适配容器
  onBounds?: (bounds: SpineFitBounds) => void
  // 悬停画布时浮现控制条（动画切换 / 播放暂停 / 速度）；开启后组件渲染为带定位上下文的容器
  controls?: boolean
  // 透传给画布（或 controls 模式下外层容器）的类名
  className?: string
}

const CONTROL_SPEEDS = [0.25, 0.5, 1, 2] as const

/**
 * 通用 Spine 动画画布：挂载后加载资产并循环播放，卸载时释放 WebGL 资源；
 * 宿主可经 SpineSuspensionProvider 声明挂起，挂起期间渲染循环整体停走。
 */
export function SpineCanvas({
  assetId,
  animations,
  autoplay,
  speed,
  scale,
  tapAnimations,
  onBounds,
  controls,
  className
}: SpineCanvasProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // 组件持有的播放器实例；同步赋值仅发生在 effect 内部
  const viewerRef = useRef<SpineViewer | null>(null)
  // 宿主挂起状态：true 时挂起渲染循环，动画与绘制一并停走
  const suspended = useContext(SpineSuspensionContext)
  const [failed, setFailed] = useState(false)
  // 互动动画轮询计数
  const tapIndexRef = useRef(0)
  // 控制条状态镜像：仅作 UI 展示，实际控制经 viewer 方法生效
  const [animationNames, setAnimationNames] = useState<string[]>([])
  const [currentAnim, setCurrentAnim] = useState('')
  const [playing, setPlayingState] = useState(autoplay ?? true)
  const [currentSpeed, setCurrentSpeed] = useState(speed ?? 1)

  /**
   * 点击时轮流播放互动动画并回到循环动画。
   */
  function handleTap(): void {
    const viewer = viewerRef.current
    if (!viewer || !tapAnimations || tapAnimations.length === 0) return
    const name = tapAnimations[tapIndexRef.current % tapAnimations.length]
    tapIndexRef.current += 1
    viewer.playOnce(name)
  }

  // 最新点击回调，避免挂载 effect 依赖业务回调导致的重载
  const onTapRef = useRef(handleTap)
  // 最新包围盒回调，避免挂载 effect 依赖业务回调导致的重载
  const onBoundsRef = useRef(onBounds)
  // 仅取挂载时的初始播放参数：autoplay/speed/scale 为初始值语义，变更不触发资产重载
  const initialOptionsRef = useRef({
    autoplay: autoplay ?? true,
    speed: speed ?? 1,
    scale: scale ?? 1
  })

  useEffect(() => {
    onTapRef.current = handleTap
    onBoundsRef.current = onBounds
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    setFailed(false)
    const viewer = new SpineViewer(canvas, SPINE_ASSETS[assetId], {
      autoplay: initialOptionsRef.current.autoplay,
      speed: initialOptionsRef.current.speed,
      scale: initialOptionsRef.current.scale,
      onTap: () => onTapRef.current?.()
    })
    viewerRef.current = viewer
    viewer
      .load()
      .then(() => {
        const bounds = viewer.getFitBounds()
        if (bounds) onBoundsRef.current?.(bounds)
        if (animations.length > 0) {
          viewer.setAnimationSequence(animations)
        }
        if (controls) {
          setAnimationNames(viewer.getAnimationNames())
          setCurrentAnim(viewer.getCurrentAnimation() ?? '')
        }
      })
      .catch((error: unknown) => {
        trackError('spine-canvas-load', `Spine 动画加载失败：${assetId}`, error)
        viewer.dispose()
        if (viewerRef.current === viewer) viewerRef.current = null
        setFailed(true)
      })
    return () => {
      viewerRef.current = null
      viewer.dispose()
    }
  }, [assetId, animations, controls])

  // 宿主挂起状态变化或播放器重建时同步挂起态：挂起停掉渲染循环，恢复时从当前帧继续
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    if (suspended) {
      viewer.suspend()
    } else {
      viewer.resume()
    }
  }, [suspended, assetId, animations, controls])

  useEffect(() => {
    viewerRef.current?.setScale(scale ?? 1)
  }, [scale])

  if (failed) {
    return <div className={className} aria-hidden />
  }
  if (!controls) {
    return <canvas ref={canvasRef} className={className} />
  }
  return (
    <div className={cn('group relative', className)}>
      <canvas ref={canvasRef} className="h-full w-full" />
      {/* 悬停浮现的控制条：动画切换 / 播放暂停 / 速度 */}
      <div className="pointer-events-auto absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded bg-black/65 px-2.5 py-1.5 opacity-0 backdrop-blur-sm transition-opacity duration-150 group-hover:opacity-100">
        <select
          value={currentAnim}
          onChange={(event) => {
            viewerRef.current?.setAnimation(event.currentTarget.value)
            setCurrentAnim(event.currentTarget.value)
          }}
          className="max-w-36 cursor-pointer rounded bg-transparent text-xs text-white outline-none"
        >
          {animationNames.map((name) => (
            <option key={name} value={name} className="bg-neutral-800">
              {name}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label={playing ? '暂停' : '播放'}
          className="text-xs text-white/85 hover:text-white"
          onClick={() => {
            const next = !playing
            viewerRef.current?.setPlaying(next)
            setPlayingState(next)
          }}
        >
          {playing ? '暂停' : '播放'}
        </button>
        <select
          value={currentSpeed}
          onChange={(event) => {
            const next = parseFloat(event.currentTarget.value)
            viewerRef.current?.setSpeed(next)
            setCurrentSpeed(next)
          }}
          className="cursor-pointer rounded bg-transparent text-xs text-white outline-none"
        >
          {CONTROL_SPEEDS.map((value) => (
            <option key={value} value={value} className="bg-neutral-800">
              {value}x
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
