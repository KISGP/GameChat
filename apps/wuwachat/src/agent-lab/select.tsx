/**
 * @description 编排窗口的下拉选择器：深色主题弹层、分组选项、选项描述与键盘导航。
 * @remarks 弹层经 createPortal 挂到 body（绕开节点卡片的滚动裁剪），因此组件内外交互
 *   都用原生监听：弹层内 pointerdown 原生阻断冒泡（避免误关条件卡片等 window 级监听），
 *   Esc 用捕获阶段处理（优先于其他 window 级 Esc 监听）。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { cn } from '@renderer/common/lib/cn'

/** 下拉的一个选项；label 缺省时显示 value。 */
export type SelectOption = {
  value: string
  label?: string
  /** 选项说明：在选项名下方以弱化文字显示。 */
  description?: string
  /** 右侧弱化标注（如符号）：与选项名两端分布，不参与取值。 */
  suffix?: string
}

/** 下拉的分组选项清单。 */
export type SelectGroup = {
  label: string
  options: SelectOption[]
}

/** 弹层最大高度（像素）。 */
const POPUP_MAX_HEIGHT = 280

/**
 * @description 渲染下拉选择器。
 * @param props 受控值与选项清单。
 * @param props.value 当前选中值；不在选项中时触发器显示 placeholder。
 * @param props.onChange 选中变更回调；选项点击时触发。
 * @param props.options 扁平选项清单；与 groups 二选一。
 * @param props.groups 分组选项清单；与 options 二选一。
 * @param props.placeholder 未选中或值缺失时触发器显示的占位文本。
 * @param props.disabled 禁用交互。
 * @param props.className 附加到触发按钮的类名；调用点用它控制宽度与 no-drag。
 * @param props.title 触发器的悬停提示；长值截断时调用点可传当前值全文。
 * @returns 下拉选择器。
 */
export function Select(props: {
  value: string
  onChange: (value: string) => void
  options?: readonly SelectOption[]
  groups?: readonly SelectGroup[]
  placeholder?: string
  disabled?: boolean
  className?: string
  title?: string
}): ReactElement {
  const { value, onChange, placeholder, disabled, className, title } = props
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popupRef = useRef<HTMLDivElement | null>(null)
  const activeItemRef = useRef<HTMLButtonElement | null>(null)
  /** 弹层定位基准：打开瞬间的触发器矩形。 */
  const [anchor, setAnchor] = useState<{
    left: number
    top: number
    bottom: number
    width: number
  } | null>(null)

  /** 扁平化选项：供键盘导航与选中项展示。 */
  const flatOptions = useMemo<readonly SelectOption[]>(
    () => (props.groups ? props.groups.flatMap((group) => group.options) : (props.options ?? [])),
    [props.groups, props.options]
  )
  const selected = flatOptions.find((option) => option.value === value)

  /** 打开弹层并记录触发器位置。 */
  const openPopup = useCallback((): void => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) {
      return
    }
    setAnchor({ left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width })
    const selectedIndex = flatOptions.findIndex((option) => option.value === value)
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)
    setOpen(true)
  }, [flatOptions, value])

  const closePopup = useCallback((): void => {
    setOpen(false)
  }, [])

  /** 提交选中值并收起弹层。 */
  const commit = useCallback(
    (option: SelectOption): void => {
      onChange(option.value)
      setOpen(false)
      triggerRef.current?.focus()
    },
    [onChange]
  )

  // 弹层打开期间：外部点击、滚动与窗口尺寸变化关闭；Esc 用捕获阶段优先处理；方向键导航。
  useEffect(() => {
    if (!open) {
      return
    }
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (
        popupRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return
      }
      setOpen(false)
    }
    const handleKeyDownCapture = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex((previous) => Math.min(previous + 1, flatOptions.length - 1))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((previous) => Math.max(previous - 1, 0))
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const option = flatOptions[activeIndex]
        if (option) {
          commit(option)
        }
      }
    }
    const handleScrollCapture = (event: Event): void => {
      // 弹层自身的内部滚动不算页面滚动，不关闭。
      if (popupRef.current?.contains(event.target as Node | null)) {
        return
      }
      setOpen(false)
    }
    const handleResize = (): void => {
      setOpen(false)
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDownCapture, true)
    window.addEventListener('scroll', handleScrollCapture, true)
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDownCapture, true)
      window.removeEventListener('scroll', handleScrollCapture, true)
      window.removeEventListener('resize', handleResize)
    }
  }, [activeIndex, commit, flatOptions, open])

  // 活动选项跟随滚动，保证键盘导航可见。
  useLayoutEffect(() => {
    if (open) {
      activeItemRef.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex, open])

  /** 弹层内 pointerdown 原生阻断冒泡：条件卡片等 window 级关闭监听不应被弹层点击触发。 */
  useLayoutEffect(() => {
    if (!open || !popupRef.current) {
      return
    }
    const element = popupRef.current
    const stop = (event: PointerEvent): void => {
      event.stopPropagation()
    }
    element.addEventListener('pointerdown', stop)
    return () => element.removeEventListener('pointerdown', stop)
  }, [open])

  const anchorStyle = useMemo(() => {
    if (!anchor) {
      return undefined
    }
    const spaceBelow = window.innerHeight - anchor.bottom
    const openUp = spaceBelow < 220 && anchor.top > spaceBelow
    return {
      position: 'fixed' as const,
      left: Math.max(8, Math.min(anchor.left, window.innerWidth - 248)),
      ...(openUp
        ? { bottom: window.innerHeight - anchor.top + 4 }
        : { top: anchor.bottom + 4 }),
      width: Math.max(anchor.width, 180),
      maxWidth: 360
    }
  }, [anchor])

  const renderOption = (option: SelectOption, index: number, key: string): ReactElement => {
    const isSelected = option.value === value
    const isActive = index === activeIndex
    return (
      <button
        key={key}
        ref={isActive ? activeItemRef : undefined}
        type="button"
        className={`flex w-full items-start gap-1.5 rounded px-2 py-1 text-left text-xs transition-colors ${
          isActive ? 'bg-foreground/10' : ''
        } ${isSelected ? 'text-primary' : 'text-foreground/90'}`}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => commit(option)}
      >
        <span className="min-w-0 flex-1">
          <span className="block break-all leading-snug">{option.label ?? option.value}</span>
          {option.description && (
            <span className="text-muted-foreground mt-0.5 block text-[11px] leading-snug">
              {option.description}
            </span>
          )}
        </span>
        {option.suffix && (
          <span className="text-muted-foreground shrink-0 font-mono text-[11px] leading-snug">
            {option.suffix}
          </span>
        )}
      </button>
    )
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        title={title}
        className={cn(
          'flex w-full items-center gap-1 rounded border border-border bg-muted/40 px-2 py-1 text-xs transition-colors hover:bg-foreground/10 disabled:pointer-events-none disabled:opacity-50',
          className
        )}
        onClick={() => (open ? closePopup() : openPopup())}
      >
        <span className={`min-w-0 flex-1 truncate text-left ${selected ? '' : 'text-muted-foreground'}`}>
          {selected ? (selected.label ?? selected.value) : (placeholder ?? '')}
        </span>
        <ChevronDown size={12} className="text-muted-foreground shrink-0" />
      </button>
      {open &&
        anchor &&
        flatOptions.length > 0 &&
        createPortal(
          <div
            ref={popupRef}
            className="border-border bg-card overflow-y-auto rounded-lg border p-1 shadow-2xl"
            style={{ ...anchorStyle, maxHeight: POPUP_MAX_HEIGHT, zIndex: 200 }}
          >
            {props.groups
              ? props.groups.map((group) => (
                  <div key={group.label}>
                    <p className="text-muted-foreground px-2 pb-0.5 pt-1.5 text-[11px] font-semibold">
                      {group.label}
                    </p>
                    {group.options.map((option) =>
                      renderOption(
                        option,
                        flatOptions.indexOf(option),
                        `${group.label}:${option.value}`
                      )
                    )}
                  </div>
                ))
              : flatOptions.map((option, index) => renderOption(option, index, option.value))}
          </div>,
          document.body
        )}
    </>
  )
}
