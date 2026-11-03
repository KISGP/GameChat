/**
 * @description 提示词编辑框：自动增高、键入 {{ 弹出变量补全、下方实时变量清单与未定义告警，
 *   可选的全屏编辑按钮。
 * @remarks 补全弹层经 createPortal 挂到 body 并按光标位置定位（React Flow 节点容器带
 *   transform，节点内 fixed 会退化）；弹层内外交互均用原生监听，Esc 捕获阶段优先处理。
 *   变量可用集来自编辑器上下文的分组清单，与条件芯片共用同一份计算。
 *   全屏编辑复用本组件的填满模式实例，补全与变量清单在弹窗内同样可用。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { Braces } from 'lucide-react'
import { FullscreenTextareaButton, FullscreenTextareaDialog } from './fullscreen-textarea-dialog'

/** 条件变量的一个可选项：变量名与一句中文说明。 */
export type ConditionVariableOption = {
  value: string
  description: string
}

/** 条件变量的分组选项清单。 */
export type ConditionVariableGroup = {
  label: string
  options: ConditionVariableOption[]
}

/** 单行文本的近似行高（像素），供最大高度换算。 */
const LINE_HEIGHT_PX = 18

/** 提示词正文中的变量插值匹配：`{{变量名}}`，允许两侧空白。 */
const TEMPLATE_VARIABLE_PATTERN = /\{\{\s*([\w\u4e00-\u9fff-]+)\s*\}\}/g

/** 触发补全的前缀：光标前两个字符。 */
const AUTOCOMPLETE_TRIGGER = '{{'

/**
 * @description 从提示词正文解析用到的变量名（按出现顺序去重）。
 * @param text 提示词正文。
 * @returns 变量名清单。
 */
export function extractTemplateVariables(text: string): string[] {
  const names: string[] = []
  for (const match of text.matchAll(TEMPLATE_VARIABLE_PATTERN)) {
    const name = match[1]
    if (!names.includes(name)) {
      names.push(name)
    }
  }
  return names
}

/** 模板正文的一个渲染段：普通文本或一段完整的 `{{变量}}` 占位。 */
export type TemplateSegment = {
  text: string
  /** 变量名；普通文本段为 null。 */
  variable: string | null
}

/**
 * @description 把模板正文按变量占位切成渲染段。
 * @param text 模板正文。
 * @returns 按原文顺序排列的分段清单；拼接后与原文完全一致。
 * @remarks 高亮层与插值预览共用同一刀切分，保证两处对变量的识别一致。
 */
export function parseTemplateSegments(text: string): TemplateSegment[] {
  const segments: TemplateSegment[] = []
  let last = 0
  for (const match of text.matchAll(TEMPLATE_VARIABLE_PATTERN)) {
    const start = match.index ?? 0
    if (start > last) {
      segments.push({ text: text.slice(last, start), variable: null })
    }
    segments.push({ text: match[0], variable: match[1] })
    last = start + match[0].length
  }
  if (last < text.length) {
    segments.push({ text: text.slice(last), variable: null })
  }
  return segments
}

/** 变量清单中一个条目的展示信息。 */
type VariableInfo = {
  name: string
  sourceLabel: string
  description: string
}

/**
 * @description 变量插入菜单：按分组列出全部可用变量，点选插入到光标处。
 * @param props 可用变量分组、锚点矩形与回调。
 * @param props.variableGroups 可用变量分组（运行时/节点输出/终答段）。
 * @param props.anchorRect 触发按钮的屏幕矩形；菜单对齐按钮右缘，向空间更足的一侧弹出。
 * @param props.onPick 点选变量回调。
 * @param props.onClose 关闭菜单回调。
 * @returns portal 变量菜单。
 * @remarks 与补全弹层同一套隔离手段：Esc 捕获关闭、外部点击关闭、弹层内 pointerdown
 *   原生阻断冒泡，避免误关条件卡片等 window 级监听。
 */
function VariableInsertMenu(props: {
  variableGroups: ReadonlyArray<ConditionVariableGroup>
  anchorRect: { left: number; right: number; top: number; bottom: number }
  onPick: (name: string) => void
  onClose: () => void
}): ReactElement {
  const { variableGroups, anchorRect, onPick, onClose } = props
  const menuRef = useRef<HTMLDivElement | null>(null)
  const MENU_WIDTH = 288
  const left = Math.max(
    8,
    Math.min(anchorRect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)
  )
  // 按钮贴近视口底部时向上弹出，其余情况向下弹出；菜单最大高约 248px。
  const openUpward = anchorRect.top - 4 > window.innerHeight - anchorRect.bottom
  const position = openUpward
    ? { bottom: window.innerHeight - anchorRect.top + 4 }
    : { top: anchorRect.bottom + 4 }

  // Esc 捕获关闭；外部 pointerdown 关闭。
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    const handlePointerDown = (event: PointerEvent): void => {
      if (menuRef.current?.contains(event.target as Node | null)) {
        return
      }
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('pointerdown', handlePointerDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [onClose])

  // 弹层内 pointerdown 原生阻断冒泡：避免误关条件卡片等 window 级监听。
  useLayoutEffect(() => {
    const element = menuRef.current
    if (!element) {
      return
    }
    const stop = (event: PointerEvent): void => {
      event.stopPropagation()
    }
    element.addEventListener('pointerdown', stop)
    return () => element.removeEventListener('pointerdown', stop)
  }, [])

  return createPortal(
    <div
      ref={menuRef}
      className="border-border bg-card fixed max-h-56 w-72 overflow-y-auto rounded-lg border p-1 shadow-2xl"
      style={{ left, ...position, zIndex: 1300 }}
    >
      {variableGroups.map((group) => (
        <div key={group.label}>
          <p className="text-muted-foreground px-2 pb-0.5 pt-1.5 text-[11px] font-semibold">
            {group.label}
          </p>
          {group.options.map((option) => (
            <button
              key={option.value}
              type="button"
              className="flex w-full items-start gap-1.5 rounded px-2 py-1 text-left transition-colors hover:bg-foreground/10"
              onClick={() => onPick(option.value)}
            >
              <span className="min-w-0 flex-1">
                <span className="block break-all font-mono text-xs leading-snug">
                  {option.value}
                </span>
                {option.description && (
                  <span className="text-muted-foreground mt-0.5 block text-[11px] leading-snug">
                    {option.description}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>,
    document.body
  )
}

/**
 * @description 渲染提示词编辑框。
 * @param props 受控值、可用变量分组与变更回调。
 * @param props.value 提示词正文。
 * @param props.onChange 正文变更回调。
 * @param props.variableGroups 可用变量分组（运行时/节点输出/终答段），供补全与清单使用。
 * @param props.placeholder 占位文本。
 * @param props.minRows 最小行数。
 * @param props.maxRows 最大行数。
 * @param props.disabled 禁用交互。
 * @param props.fill 填满模式：编辑框随容器高度拉伸（提示词是节点主体内容时使用），关闭自动增高。
 * @param props.expandable 是否在框内右上角显示全屏编辑按钮。
 * @param props.expandTitle 全屏弹窗标题行展示的字段名。
 * @param props.textareaRef 挂载回调：外部需要聚焦或定位光标时读取底层 textarea。
 * @returns 提示词编辑框与变量清单。
 */
export function PromptTextarea(props: {
  value: string
  onChange: (value: string) => void
  variableGroups: ReadonlyArray<ConditionVariableGroup>
  placeholder?: string
  minRows: number
  maxRows: number
  disabled?: boolean
  fill?: boolean
  expandable?: boolean
  expandTitle?: string
  textareaRef?: (element: HTMLTextAreaElement | null) => void
}): ReactElement {
  const {
    value,
    onChange,
    variableGroups,
    placeholder,
    minRows,
    maxRows,
    disabled,
    fill,
    expandable,
    expandTitle,
    textareaRef
  } = props
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const popupRef = useRef<HTMLDivElement | null>(null)
  /** 变量高亮层引用：滚动同步目标。 */
  const highlightRef = useRef<HTMLDivElement | null>(null)
  /** 补全弹层状态：锚点为触发时的光标屏幕坐标。 */
  const [popup, setPopup] = useState<{
    left: number
    top: number
    startIndex: number
    activeIndex: number
  } | null>(null)
  /** 最近一次输入时刻的光标位置，提交渲染后恢复。 */
  const caretRef = useRef<number | null>(null)
  /** 全屏编辑弹窗开关。 */
  const [expanded, setExpanded] = useState(false)
  /** 变量插入菜单开关与锚点：锚点为触发按钮的屏幕矩形。 */
  const [menuAnchor, setMenuAnchor] = useState<{
    left: number
    right: number
    top: number
    bottom: number
  } | null>(null)

  /** 挂载回调：登记内部引用并转发给外部引用。 */
  const attachTextarea = useCallback(
    (element: HTMLTextAreaElement | null): void => {
      ref.current = element
      textareaRef?.(element)
    },
    [textareaRef]
  )

  /** 全屏弹窗内实例的挂载回调：聚焦并把光标移到末尾，主实例不抢节点内焦点。 */
  const focusTextarea = useCallback((element: HTMLTextAreaElement | null): void => {
    if (!element) {
      return
    }
    element.focus()
    element.setSelectionRange(element.value.length, element.value.length)
  }, [])

  /** 扁平变量清单：补全导航与已用变量解析共用。 */
  const flatVariables = useMemo<VariableInfo[]>(
    () =>
      variableGroups.flatMap((group) =>
        group.options.map((option) => ({
          name: option.value,
          sourceLabel: group.label,
          description: option.description
        }))
      ),
    [variableGroups]
  )
  const variableByName = useMemo(
    () => new Map(flatVariables.map((item) => [item.name, item])),
    [flatVariables]
  )
  const usedVariables = useMemo(() => extractTemplateVariables(value), [value])
  /** 正文分段：高亮层渲染用，与插值预览同一刀切分。 */
  const segments = useMemo(() => parseTemplateSegments(value), [value])

  /** 高度自适应：随内容重算，受行数上下限约束；填满模式下交给容器拉伸。 */
  useLayoutEffect(() => {
    const element = ref.current
    if (!element || fill) {
      return
    }
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, maxRows * LINE_HEIGHT_PX)}px`
    element.style.overflowY = element.scrollHeight > maxRows * LINE_HEIGHT_PX ? 'auto' : 'hidden'
    const overlay = highlightRef.current
    if (overlay) {
      overlay.scrollTop = element.scrollTop
    }
  }, [fill, maxRows, value])

  /** 打开变量插入菜单：锚点为触发按钮的屏幕矩形，菜单就近弹出。 */
  const openInsertMenu = useCallback((button: HTMLButtonElement): void => {
    const rect = button.getBoundingClientRect()
    setMenuAnchor({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })
  }, [])

  /**
   * @description 在光标处插入一个变量占位并关闭菜单。
   * @param name 变量名。
   */
  const insertAtCaret = useCallback(
    (name: string): void => {
      const element = ref.current
      setMenuAnchor(null)
      if (!element) {
        return
      }
      const caret = element.selectionStart ?? element.value.length
      const selectionEnd = element.selectionEnd ?? caret
      const next = `${element.value.slice(0, caret)}{{${name}}}${element.value.slice(selectionEnd)}`
      const nextCaret = caret + name.length + 4
      onChange(next)
      caretRef.current = nextCaret
      requestAnimationFrame(() => {
        element.focus()
        element.setSelectionRange(nextCaret, nextCaret)
      })
    },
    [onChange]
  )

  /** 输入框滚动时同步变量高亮层，保持色块与正文对齐。 */
  const syncHighlightScroll = useCallback((): void => {
    const overlay = highlightRef.current
    const element = ref.current
    if (overlay && element) {
      overlay.scrollTop = element.scrollTop
    }
  }, [])

  /** 插值预览元素：变量替换为占位标记，已知变量金色、未定义变量红色。 */
  const previewElement = useMemo(() => {
    if (!expandable) {
      return undefined
    }
    return (
      <div className="border-border bg-muted/30 h-full overflow-y-auto whitespace-pre-wrap break-words rounded-lg border p-3 font-mono text-xs leading-relaxed">
        {segments.length === 0 && (
          <span className="text-muted-foreground">（空）</span>
        )}
        {segments.map((segment, index) =>
          segment.variable === null ? (
            <span key={index}>{segment.text}</span>
          ) : variableByName.has(segment.variable) ? (
            <span
              key={index}
              className="text-primary mx-0.5 rounded bg-primary/20 px-1 py-0.5"
            >
              {`⟦${segment.variable}⟧`}
            </span>
          ) : (
            <span
              key={index}
              className="mx-0.5 rounded bg-red-500/25 px-1 py-0.5 text-red-600 dark:text-red-400"
            >
              {`⟦${segment.variable}⟧`}
            </span>
          )
        )}
      </div>
    )
  }, [expandable, segments, variableByName])

  /** 补全选项过滤：触发后继续键入时按前缀收窄。 */
  const popupOptions = useMemo(() => {
    if (!popup) {
      return []
    }
    const element = ref.current
    if (!element) {
      return []
    }
    const typed = element.value.slice(popup.startIndex, element.selectionStart ?? popup.startIndex)
    const prefix = typed.toLowerCase()
    return flatVariables.filter((item) => item.name.toLowerCase().startsWith(prefix))
  }, [flatVariables, popup])

  /** 关闭补全弹层。 */
  const closePopup = useCallback((): void => {
    setPopup(null)
  }, [])

  /**
   * @description 在触发位置插入选定变量并关闭弹层。
   * @param name 变量名。
   */
  const insertVariable = useCallback(
    (name: string): void => {
      const element = ref.current
      if (!element || !popup) {
        closePopup()
        return
      }
      const caret = element.selectionStart ?? popup.startIndex
      const next = `${element.value.slice(0, popup.startIndex)}{{${name}}}${element.value.slice(caret)}`
      const nextCaret = popup.startIndex + name.length + 4
      onChange(next)
      caretRef.current = nextCaret
      closePopup()
      requestAnimationFrame(() => {
        element.focus()
        element.setSelectionRange(nextCaret, nextCaret)
      })
    },
    [closePopup, onChange, popup]
  )

  // 提交渲染后恢复输入时刻的光标；补全插入自行定位，caretRef 为 null 时不干预。
  useLayoutEffect(() => {
    const element = ref.current
    const caret = caretRef.current
    caretRef.current = null
    if (!element || caret === null || document.activeElement !== element) {
      return
    }
    element.setSelectionRange(caret, caret)
  }, [value])

  /** 键入处理：检测 {{ 触发补全，并保存光标供提交后恢复。 */
  const handleChange = useCallback(
    (element: HTMLTextAreaElement): void => {
      const caret = element.selectionStart ?? 0
      caretRef.current = caret
      onChange(element.value)
      const before = element.value.slice(Math.max(0, caret - AUTOCOMPLETE_TRIGGER.length), caret)
      if (before === AUTOCOMPLETE_TRIGGER) {
        const rect = element.getBoundingClientRect()
        // 光标行位置近似：按字符宽度估算水平偏移，行高估算垂直偏移。
        const lineHeight = parseFloat(getComputedStyle(element).lineHeight) || LINE_HEIGHT_PX
        const upToCaret = element.value.slice(0, caret)
        const lineStart = upToCaret.lastIndexOf('\n') + 1
        const column = caret - lineStart
        setPopup({
          left: rect.left + Math.min(column * 7.2, rect.width - 270),
          top: rect.top + (upToCaret.split('\n').length - 1) * lineHeight + lineHeight + 4,
          startIndex: caret,
          activeIndex: 0
        })
        return
      }
      if (popup && !before.endsWith('{') && element.value.slice(caret - 1, caret) !== '}') {
        closePopup()
      }
    },
    [closePopup, onChange, popup]
  )

  // 弹层打开期间：方向键与 Enter 导航、Esc 捕获关闭、外部点击关闭；滚动与缩放关闭。
  useEffect(() => {
    if (!popup) {
      return
    }
    const handleKeyDownCapture = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        closePopup()
        return
      }
      if (popupOptions.length === 0) {
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setPopup((previous) =>
          previous
            ? { ...previous, activeIndex: Math.min(previous.activeIndex + 1, popupOptions.length - 1) }
            : previous
        )
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setPopup((previous) =>
          previous ? { ...previous, activeIndex: Math.max(previous.activeIndex - 1, 0) } : previous
        )
        return
      }
      if (event.key === 'Enter') {
        const option = popupOptions[popup.activeIndex]
        if (option) {
          event.preventDefault()
          insertVariable(option.name)
        }
      }
    }
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (popupRef.current?.contains(target) || ref.current?.contains(target)) {
        return
      }
      closePopup()
    }
    const handleScrollCapture = (event: Event): void => {
      if (popupRef.current?.contains(event.target as Node | null)) {
        return
      }
      closePopup()
    }
    window.addEventListener('keydown', handleKeyDownCapture, true)
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('scroll', handleScrollCapture, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDownCapture, true)
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('scroll', handleScrollCapture, true)
    }
  }, [closePopup, insertVariable, popup, popupOptions])

  // 弹层内 pointerdown 原生阻断冒泡：避免误关条件卡片等 window 级监听。
  useLayoutEffect(() => {
    const element = popupRef.current
    if (!popup || !element) {
      return
    }
    const stop = (event: PointerEvent): void => {
      event.stopPropagation()
    }
    element.addEventListener('pointerdown', stop)
    return () => element.removeEventListener('pointerdown', stop)
  }, [popup])

  const hasCornerButtons = expandable || flatVariables.length > 0

  return (
    <div className={fill ? 'flex h-full min-h-0 flex-col space-y-1' : 'space-y-1'}>
      <div
        className={`border-border bg-muted/40 group relative rounded border transition-colors focus-within:border-primary/60 ${
          fill ? 'flex min-h-0 flex-1' : ''
        }`}
      >
        <div
          ref={highlightRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden px-2 py-1 font-mono text-xs leading-[20px] break-words whitespace-pre-wrap text-transparent [scrollbar-gutter:stable]"
        >
          {segments.map((segment, index) => (
            <span
              key={index}
              className={
                segment.variable === null
                  ? undefined
                  : variableByName.has(segment.variable)
                    ? 'rounded-sm bg-primary/20'
                    : 'rounded-sm bg-red-500/30'
              }
            >
              {segment.text}
            </span>
          ))}
          {/* textarea 对末尾换行额外保留一行滚动空间，高亮层补一行才能在滚动深度上对齐。 */}
          {value.endsWith('\n') && <span>{'\n'}</span>}
        </div>
        <textarea
          ref={attachTextarea}
          className={`relative w-full resize-none bg-transparent px-2 py-1 font-mono text-xs leading-[20px] outline-none [scrollbar-gutter:stable] ${
            fill ? 'min-h-0 flex-1 overflow-y-auto' : ''
          }`}
          rows={minRows}
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          onChange={(event) => handleChange(event.target)}
          onScroll={syncHighlightScroll}
        />
        {hasCornerButtons && (
          <div
            className={`absolute right-1.5 top-1.5 z-10 flex items-center gap-1 opacity-50 transition-opacity group-hover:opacity-100 ${
              disabled ? 'pointer-events-none' : ''
            }`}
          >
            {flatVariables.length > 0 && (
              <button
                type="button"
                className="border-border/60 bg-background/60 text-muted-foreground hover:text-primary flex h-5 w-5 cursor-pointer items-center justify-center rounded-md border hover:bg-foreground/10"
                title="插入变量"
                onClick={(event) => openInsertMenu(event.currentTarget)}
              >
                <Braces size={13} />
              </button>
            )}
            {expandable && <FullscreenTextareaButton onExpand={() => setExpanded(true)} />}
          </div>
        )}
      </div>
      {usedVariables.length > 0 && (
        <div className="space-y-0.5">
          {usedVariables.map((name) => {
            const info = variableByName.get(name)
            return (
              <p
                key={name}
                className={`text-[11px] leading-snug ${info ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-400'}`}
              >
                <span className="font-mono">{`{{${name}}}`}</span>
                {info
                  ? `  ${info.sourceLabel} · ${info.description}`
                  : '  ⚠ 流程中不存在此变量：请检查拼写，或在来源节点的「输出变量」中定义。'}
              </p>
            )
          })}
        </div>
      )}
      {popup &&
        popupOptions.length > 0 &&
        createPortal(
          <div
            ref={popupRef}
            className="border-border bg-card fixed max-h-56 w-72 overflow-y-auto rounded-lg border p-1 shadow-2xl"
            style={{ left: popup.left, top: popup.top, zIndex: 1300 }}
          >
            {variableGroups.map((group) => {
              const options = popupOptions.filter((option) =>
                group.options.some((item) => item.value === option.name)
              )
              if (options.length === 0) {
                return null
              }
              return (
                <div key={group.label}>
                  <p className="text-muted-foreground px-2 pb-0.5 pt-1.5 text-[11px] font-semibold">
                    {group.label}
                  </p>
                  {options.map((option) => {
                    const index = popupOptions.indexOf(option)
                    const active = index === popup.activeIndex
                    return (
                      <button
                        key={option.name}
                        type="button"
                        className={`flex w-full items-start gap-1.5 rounded px-2 py-1 text-left transition-colors ${
                          active ? 'bg-foreground/10' : ''
                        }`}
                        onMouseEnter={() =>
                          setPopup((previous) => (previous ? { ...previous, activeIndex: index } : previous))
                        }
                        onClick={() => insertVariable(option.name)}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block break-all font-mono text-xs leading-snug">
                            {option.name}
                          </span>
                          {option.description && (
                            <span className="text-muted-foreground mt-0.5 block text-[11px] leading-snug">
                              {option.description}
                            </span>
                          )}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>,
          document.body
        )}
      {menuAnchor &&
        createPortal(
          <VariableInsertMenu
            variableGroups={variableGroups}
            anchorRect={menuAnchor}
            onPick={insertAtCaret}
            onClose={() => setMenuAnchor(null)}
          />,
          document.body
        )}
      {expanded &&
        expandable &&
        createPortal(
          <FullscreenTextareaDialog
            title={expandTitle ?? ''}
            preview={previewElement}
            onClose={() => setExpanded(false)}
          >
            <PromptTextarea
              value={value}
              onChange={onChange}
              variableGroups={variableGroups}
              placeholder={placeholder}
              minRows={minRows}
              maxRows={maxRows}
              disabled={disabled}
              fill
              textareaRef={focusTextarea}
            />
          </FullscreenTextareaDialog>,
          document.body
        )}
    </div>
  )
}
