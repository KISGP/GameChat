import gsap from 'gsap'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type WheelEvent
} from 'react'
import { LoaderCircle } from 'lucide-react'
import { useMotionPreference } from '@renderer/app/hooks/useMotionPreference'
import ProspectRolePile from '@renderer/assets/T_IconRole_Pile_ProspectRole_UI.png'
import { cn } from '@renderer/common/lib/cn'
import { useCharacterRegistryStore } from '@renderer/store/character-registry'

type CharacterPickerStepProps = {
  /** 确认角色并进入模型配置步。 */
  onConfirm: (characterId: string) => void
  /** Esc 无展开卡可收起时请求关闭整个向导。 */
  onRequestClose: () => void
}

/** 卡带跨窗口可见的收起卡数量：收起/悬停/展开宽度均按它与容器宽度推算。 */
const BELT_VISIBLE_SLOTS = 8

/** 悬停预览宽度占收起宽度的倍数。 */
const BELT_HOVER_SCALE = 1.6

/** 中心展开宽度占收起宽度的倍数。 */
const BELT_OPEN_SCALE = 2.5

/** 卡带布局变化的补间时长（秒）。 */
const BELT_TWEEN_DURATION = 0.7

/** 展开卡内文字排版宽占展开卡宽的比例。 */
const BELT_TEXT_MEASURE_SCALE = 1

/** 滚轮单步滑动占收起宽度的比例。 */
const BELT_WHEEL_STEP_SCALE = 0.9

/**
 * @description 渲染单张角色卡面：未知角色剪影占位图常驻底层，有图源时网络图加载完成后淡入覆盖。
 * @param props 图片源地址（可空）、角色名与是否播放过渡动画。
 * @returns 铺满容器的卡面内容。
 */
function CharacterFaceImage({
  source,
  name,
  shouldAnimate
}: {
  source?: string
  name: string
  shouldAnimate: boolean
}): ReactElement {
  const [loadedSource, setLoadedSource] = useState<string | null>(null)

  return (
    <div className="relative size-full bg-neutral-900">
      <img
        src={ProspectRolePile}
        alt=""
        decoding="async"
        className="absolute inset-0 size-full object-cover"
        draggable={false}
      />
      {source ? (
        <img
          key={source}
          src={source}
          alt={name}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoadedSource(source)}
          className={cn(
            'absolute inset-0 size-full object-cover',
            shouldAnimate && 'transition-opacity duration-500 ease-out',
            loadedSource === source ? 'opacity-100' : 'opacity-0'
          )}
          draggable={false}
        />
      ) : null}
    </div>
  )
}

/** 卡带条目的统一展示形状：本地与远端条目的公共字段集合。 */
type BeltEntry = {
  id: string
  name: string
  information?: string
  avatar?: string
  cardBg?: string
  pixActivity?: string
  rolePile?: string
  syncState?: 'queued' | 'downloading' | 'failed'
  syncError?: string
}

/** 传送带上单个槽位的布局与内容信息。 */
type BeltSlot = {
  entry: BeltEntry
  /** 槽位在无限环带上的绝对格位号；随滑动单调变化，同一张卡在滑动前后保持同一格位。 */
  cell: number
  /** 槽位相对中心的偏移；同一角色在角色数少于槽位数时可能在多个槽位重复出现。 */
  offset: number
  /** 卡片左缘相对中轴的偏移（像素）。 */
  left: number
  width: number
  /** 是否处于中心展开位。 */
  expanded: boolean
  /** 是否处于悬停预览态。 */
  hovered: boolean
}

type BeltSlotProps = {
  slot: BeltSlot
  /** 卡片展开终宽（像素）；文字块按该宽度排版，折叠收窄时只被裁切、不重排。 */
  openWidth: number
  /** 是否播放补间动画（跟随应用「界面动画」设置）。 */
  shouldAnimate: boolean
  /** 向父级登记卡片元素，供布局补间读写几何信息。 */
  registerElement: (cell: number, element: HTMLButtonElement | null) => void
  /** 槽位被点击时回传角色标识与槽位偏移。 */
  onSelect: (characterId: string, offset: number) => void
  /** 槽位悬停/聚焦状态变化时回传。 */
  onHoverChange: (offset: number, hovered: boolean) => void
  /** 确认该角色并进入模型配置步。 */
  onConfirm: (characterId: string) => void
}

/**
 * @description 渲染传送带上单个槽位的角色卡：收起为窄条立牌，点击带到中心展开预览，展开位提供确认入口。
 * @param props 槽位数据与回调。
 * @returns 角色卡槽位。
 */
function BeltSlotItem({
  slot,
  openWidth,
  shouldAnimate,
  registerElement,
  onSelect,
  onHoverChange,
  onConfirm
}: BeltSlotProps): ReactElement {
  const { entry, offset, expanded, hovered } = slot
  // 收起态以立牌为主体（缺图退回立绘链），中心展开位为完整活动立绘。
  const standeeSource = entry.rolePile ?? entry.pixActivity ?? entry.cardBg ?? entry.avatar
  const portraitSource = entry.pixActivity ?? entry.cardBg ?? entry.avatar

  return (
    <button
      ref={(element) => registerElement(slot.cell, element)}
      type="button"
      aria-pressed={expanded}
      onClick={() => onSelect(entry.id, offset)}
      onMouseEnter={() => onHoverChange(offset, true)}
      onMouseLeave={() => onHoverChange(offset, false)}
      onBlur={() => onHoverChange(offset, false)}
      className={cn(
        'absolute top-0 bottom-0 cursor-pointer overflow-hidden text-left',
        'border-l border-white/10 focus-visible:outline-none',
        shouldAnimate && 'transition-[filter] duration-500 ease-in-out',
        expanded || hovered ? '' : 'brightness-[.55]'
      )}
      style={{ left: '50%' }}
    >
      {/* 收起态立牌层：压暗，悬停点亮，展开时淡出 */}
      <div
        className={cn(
          'absolute inset-0',
          shouldAnimate && 'transition-[opacity,filter] duration-500 ease-out',
          expanded ? 'opacity-0' : 'opacity-100'
        )}
      >
        <CharacterFaceImage source={standeeSource} name={entry.name} shouldAnimate={shouldAnimate} />
      </div>
      {/* 展开态活动立绘层：淡入 */}
      <div
        className={cn(
          'absolute inset-0 overflow-hidden',
          shouldAnimate && 'transition-opacity duration-500 ease-out',
          expanded ? 'opacity-100' : 'opacity-0'
        )}
      >
        <CharacterFaceImage source={portraitSource} name={entry.name} shouldAnimate={shouldAnimate} />
      </div>
      {/* 展开态顶部横幅排版宽度固定为展开终宽：与下方文字块同理，宽度补间期间只做揭示、内容不重排 */}
      {expanded && entry.syncState === 'queued' && (
        <div
          className="absolute top-0 left-0 z-[3] flex items-center justify-center gap-2 bg-black/60 py-2.5 text-xs text-[#f1d9af]"
          style={{ width: slot.width }}
        >
          <LoaderCircle className="size-3.5 animate-spin" aria-label="下载中" />
          排队中，即将开始下载...
        </div>
      )}
      {expanded && entry.syncState === 'downloading' && (
        <div
          className="absolute top-0 left-0 z-[3] flex items-center justify-center gap-2 bg-black/60 py-2.5 text-xs text-[#f1d9af]"
          style={{ width: slot.width }}
        >
          <LoaderCircle className="size-3.5 animate-spin" aria-label="下载中" />
          正在下载角色...
        </div>
      )}
      {expanded && entry.syncState === 'failed' && (
        <div
          className="absolute top-0 left-0 z-[3] bg-black/70 px-3 py-2.5 text-center text-xs leading-relaxed text-red-200"
          style={{ width: slot.width }}
        >
          下载失败：{entry.syncError || '未知错误'}，可滚动卡带选择其他角色后再次尝试
        </div>
      )}
      {/* 悬停态名字：自卡片底边滑入并贴底显示；展开后由信息层的大名字接管 */}
      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 z-[2] bg-gradient-to-t from-black/80 to-transparent px-4 pt-8 pb-4 text-center text-[13px] font-bold tracking-[.2em] text-[#f5eee0]',
          shouldAnimate && 'transition-[opacity,transform] duration-300 ease-out',
          hovered && !expanded ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'
        )}
      >
        {entry.name}
      </div>
      {/* 展开态内容列：衬底铺满整张展开卡；文字块恒按展开终宽排版（展开只做揭示、收起只做裁切，
          两个方向的宽度变化都不触发文字重排）；底部预留全宽确认条槽位，悬停时长出半透明金底，
          点击整条即确认进入模型步 */}
      <div
        className={cn(
          'pointer-events-none absolute inset-0 z-[1] flex flex-col justify-end bg-gradient-to-t from-black/70 via-black/25 to-transparent text-[#f5eee0]',
          shouldAnimate && 'transition-opacity duration-300',
          expanded ? 'opacity-100' : 'opacity-0'
        )}
      >
        <div
          key={entry.id}
          className={cn(
            'flex flex-col px-10 pb-3',
            shouldAnimate && 'animate-[quickstart-name-in_0.5s_cubic-bezier(0.6,0,0.4,1)_both]'
          )}
          style={{ width: openWidth * BELT_TEXT_MEASURE_SCALE }}
        >
          {/* 字号与配色对齐鸣潮官网共鸣者页的实测规格 */}
          <div className="text-[20.58px] text-[rgb(181,174,161)]">{entry.name}</div>
          {entry.information && (
            <p className="mt-3 text-xs leading-relaxed text-white/65">{entry.information}</p>
          )}
        </div>
        <div
          role="button"
          tabIndex={expanded ? 0 : -1}
          onClick={(event) => {
            event.stopPropagation()
            onConfirm(entry.id)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.stopPropagation()
              onConfirm(entry.id)
            }
          }}
          className={cn(
            'group/belt relative flex h-14 w-full cursor-pointer items-center justify-center overflow-hidden text-sm font-bold tracking-[.3em] transition-[color] duration-300',
            expanded
              ? 'pointer-events-auto text-[#f1d9af]/70 hover:text-[#f1d9af]'
              : 'pointer-events-none text-transparent'
          )}
        >
          {/* 悬停时金底自底向上升起填充 */}
          <div
            className={cn(
              'absolute inset-0 origin-bottom scale-y-0 bg-[#f1d9af]/15 ease-out group-hover/belt:scale-y-100',
              shouldAnimate && 'transition-transform duration-300'
            )}
          />
          <span className="relative z-[1]">下一步</span>
        </div>
      </div>
    </button>
  )
}

/**
 * @description 渲染首启向导的角色选择步：全屏无缝环形卡带，滚轮或方向键滑动浏览，点击卡片带到
 *   中心展开选中，Enter 确认，Esc 收起选中或退出向导。
 * @param props 组件 props。
 * @returns 角色选择步内容。
 */
export function CharacterPickerStep({
  onConfirm,
  onRequestClose
}: CharacterPickerStepProps): ReactElement {
  const registry = useCharacterRegistryStore((state) => state.registry)
  const { shouldAnimate } = useMotionPreference()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [beltIndex, setBeltIndex] = useState(0)
  const [hoverOffset, setHoverOffset] = useState<number | null>(null)
  const [beltHalfWidth, setBeltHalfWidth] = useState(0)
  const [beltSettling, setBeltSettling] = useState(false)
  const beltRef = useRef<HTMLDivElement>(null)
  const cardElements = useRef(new Map<number, HTMLButtonElement>())
  const previousLayout = useRef(new Map<number, { left: number; width: number }>())
  const settleTimer = useRef<number | null>(null)
  const wheelAccum = useRef(0)

  // 卸载时清理滑动标记计时器。
  useEffect(() => {
    return () => {
      if (settleTimer.current !== null) {
        window.clearTimeout(settleTimer.current)
      }
    }
  }, [])

  /**
   * @description 标记卡带进入滑动过程，并在过渡时长（含错峰延迟上限）后恢复。
   * @returns 无返回值。
   * @remarks 滑动期间清空并忽略悬停变化：静止的鼠标会被途经的卡片反复触发悬停，
   *   导致布局抖动破坏滑动动画。
   */
  function beginBeltMotion(): void {
    setBeltSettling(true)
    setHoverOffset(null)
    if (settleTimer.current !== null) {
      window.clearTimeout(settleTimer.current)
    }
    settleTimer.current = window.setTimeout(() => setBeltSettling(false), 700)
  }

  // 渲染半径随容器宽度自适应：保证两侧最远槽位始终落在窗口之外，任何宽度下都铺满全屏。
  useEffect(() => {
    const element = beltRef.current
    if (!element) {
      return
    }
    const observer = new ResizeObserver((items) => {
      setBeltHalfWidth(items[0].contentRect.width / 2)
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [])

  // 合并本地与远端：卡带展示全部角色，已安装在前、未安装在后。
  const entries: BeltEntry[] = [...registry.local, ...registry.remote]
  const count = entries.length
  // 槽位宽度按「容器宽度 ÷ 可见槽位数」推算，悬停与展开按倍数放大；滚轮步长与文字排版宽随之推导。
  const collapsedWidth = (beltHalfWidth * 2) / BELT_VISIBLE_SLOTS
  const hoverWidth = collapsedWidth * BELT_HOVER_SCALE
  const openWidth = collapsedWidth * BELT_OPEN_SCALE
  const wheelStep = collapsedWidth * BELT_WHEEL_STEP_SCALE
  const renderReach = Math.ceil(BELT_VISIBLE_SLOTS / 2) + 2

  /**
   * @description 处理槽位点击：中心展开卡再次点击收起取消选中，其他卡被带到中心展开选中。
   * @param characterId 被点击的角色标识。
   * @param offset 被点击槽位相对中心的偏移。
   * @returns 无返回值。
   */
  function handleSelect(characterId: string, offset: number): void {
    if (activeId === characterId && offset === 0) {
      setActiveId(null)
      if (shouldAnimate) {
        beginBeltMotion()
      }
      return
    }
    setBeltIndex(beltIndex + offset)
    setActiveId(characterId)
    if (shouldAnimate) {
      beginBeltMotion()
    }
  }

  /**
   * @description 处理槽位悬停/聚焦状态变化。
   * @param offset 槽位相对中心的偏移。
   * @param hovered 是否进入悬停态。
   * @returns 无返回值。
   * @remarks 卡带滑动期间忽略悬停变化：静止的鼠标会被途经的卡片反复触发。
   */
  function handleHover(offset: number, hovered: boolean): void {
    if (beltSettling) {
      return
    }
    setHoverOffset((current) => (hovered ? offset : current === offset ? null : current))
  }

  /**
   * @description 将滚轮累计换算为卡带的整卡滑动。
   * @param event 滚轮事件。
   * @returns 无返回值。
   */
  function handleWheel(event: WheelEvent<HTMLDivElement>): void {
    wheelAccum.current += event.deltaY + event.deltaX
    if (wheelAccum.current > wheelStep) {
      setBeltIndex((current) => current + 1)
      wheelAccum.current = 0
      if (shouldAnimate) {
        beginBeltMotion()
      }
    } else if (wheelAccum.current < -wheelStep) {
      setBeltIndex((current) => current - 1)
      wheelAccum.current = 0
      if (shouldAnimate) {
        beginBeltMotion()
      }
    }
  }

  /**
   * @description 处理角色步键盘快捷键：方向键整卡滑动并自动选中展开中心卡，Enter 确认，Esc 先收起再退出。
   * @param event 键盘事件。
   * @returns 无返回值。
   * @remarks 方向键与滚轮共用同一套整卡滑动路径，滑动后中心卡自动展开选中，键盘可独立完成
   *   浏览、选中与确认；Enter 在已有选中时抑制原生按钮激活（鼠标点选后焦点残留在过期卡片上，
   *   原生回车会误触收起或跳卡），无选中时不拦截原生行为（如 Tab 聚焦的卡片回车展开）；
   *   「下一步」确认条自带回车与空格处理并在冒泡前拦截，本处理不会与之重复触发。
   */
  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const nextCell = beltIndex + (event.key === 'ArrowRight' ? 1 : -1)
      const entry = entries[((nextCell % count) + count) % count]
      if (!entry) {
        return
      }
      event.preventDefault()
      setBeltIndex(nextCell)
      setActiveId(entry.id)
      if (shouldAnimate) {
        beginBeltMotion()
      }
      return
    }
    if (event.key === 'Enter') {
      if (!activeId) {
        return
      }
      event.preventDefault()
      onConfirm(activeId)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      if (!activeId) {
        onRequestClose()
        return
      }
      setActiveId(null)
      if (shouldAnimate) {
        beginBeltMotion()
      }
    }
  }

  // 每轮渲染重挂监听，保证闭包内的卡带状态与回调始终为最新。
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  })

  /**
   * @description 向父级登记卡片元素，供布局补间读写几何信息。
   * @param cell 槽位的绝对格位号。
   * @param element 卡片元素；卸载时为 null。
   * @returns 无返回值。
   */
  function registerElement(cell: number, element: HTMLButtonElement | null): void {
    if (element) {
      cardElements.current.set(cell, element)
    } else {
      cardElements.current.delete(cell)
    }
  }

  // 以中轴为原点向两侧铺槽位：中心展开卡按选中态取宽，悬停槽位微加宽，槽位对角色数取模环形填充。
  const belt: BeltSlot[] = []
  let total = 0
  for (let offset = -renderReach; offset <= renderReach; offset++) {
    const cell = beltIndex + offset
    const index = ((cell % count) + count) % count
    const entry = entries[index]
    if (!entry) {
      continue
    }
    const expanded = offset === 0 && activeId !== null
    const hovered = hoverOffset === offset
    const width = expanded ? openWidth : hovered ? hoverWidth : collapsedWidth
    belt.push({ entry, cell, offset, left: 0, width, expanded, hovered })
    total += width
  }
  let cursor = -total / 2
  for (const slot of belt) {
    slot.left = cursor
    cursor += slot.width
  }

  // 布局补间：与上一次布局对比，位置/宽度变化交由 GSAP 补间（可打断、可重定向）；离中心越远的卡
  // 延迟越大，形成错峰跟滑；新挂载的槽位直接落位。
  useLayoutEffect(() => {
    const previous = previousLayout.current
    const next = new Map<number, { left: number; width: number }>()
    for (const slot of belt) {
      next.set(slot.cell, { left: slot.left, width: slot.width })
      const element = cardElements.current.get(slot.cell)
      if (!element) {
        continue
      }
      const before = previous.get(slot.cell)
      const target = { x: slot.left, width: slot.width }
      if (!before) {
        gsap.set(element, target)
      } else if (before.left !== slot.left || before.width !== slot.width) {
        if (shouldAnimate) {
          gsap.to(element, {
            ...target,
            duration: BELT_TWEEN_DURATION,
            delay: Math.min(Math.abs(slot.offset) * 0.02, 0.1),
            ease: 'power3.out',
            overwrite: 'auto'
          })
        } else {
          gsap.set(element, target)
        }
      }
    }
    for (const cell of previous.keys()) {
      if (!next.has(cell)) {
        cardElements.current.delete(cell)
      }
    }
    previousLayout.current = next
  })

  // 无角色可展示时（首启离线、索引同步失败或远端为空）以占位说明替代空卡带。
  if (count === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-white/50">
        {registry.isSyncing ? (
          <>
            <LoaderCircle className="size-5 animate-spin" aria-label="同步中" />
            <span className="text-sm">正在获取角色资料…</span>
          </>
        ) : registry.syncError ? (
          <>
            <span className="text-sm text-red-300">角色资料获取失败</span>
            <span className="max-w-md text-center text-xs text-white/45">{registry.syncError}</span>
          </>
        ) : (
          <span className="text-sm">暂无可选角色</span>
        )}
      </div>
    )
  }

  return (
    <div
      ref={beltRef}
      className="relative h-full overflow-hidden"
      onWheel={(event) => handleWheel(event)}
    >
      {belt.map((slot) => (
        <BeltSlotItem
          key={slot.cell}
          slot={slot}
          openWidth={openWidth}
          shouldAnimate={shouldAnimate}
          registerElement={registerElement}
          onSelect={handleSelect}
          onHoverChange={handleHover}
          onConfirm={onConfirm}
        />
      ))}
    </div>
  )
}
