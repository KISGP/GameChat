import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { gsap } from 'gsap'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { Info, Trash2, TriangleAlert } from 'lucide-react'
import { useMotionPreference } from '@renderer/app/hooks/useMotionPreference'
import {
  FLOW_CONTROL_STEP_TYPES,
  type CharacterSummary,
  type FlowDebugToolTrace,
  type FlowNodeRawExchange,
  type FlowSimulatedCharacter,
  type FlowStepConfig,
  type FlowStepType,
  type FlowToolCatalogEntry
} from '@gamechat/type'
import {
  FLOW_BOOLEAN_VARIABLES,
  FLOW_STEP_DEFINITIONS,
  isValidFlowOutputVariable,
  type FlowConfigFieldDefinition,
  type FlowStepDefinition
} from '@gamechat/schema'
import { Button } from '@renderer/common/components/button'
import {
  STEP_CATEGORY_META,
  STEP_META,
  type StepCanvasNode
} from './flow-model'
import { Select, type SelectGroup, type SelectOption } from './select'
import { RawExchangeDialog } from './raw-exchange-dialog'
import { ToolTraceDialog, TRACE_STATUS_META } from './tool-trace-dialog'
import { PromptTextarea } from './prompt-textarea'
import { FullscreenTextareaButton, FullscreenTextareaDialog } from './fullscreen-textarea-dialog'
import type { ConditionVariableGroup } from './prompt-textarea'
import type { FlowModelOption } from './use-reference-data'

/** 节点内编辑器上下文：控制节点在卡片内读取画布级依赖与回调。 */
export type StepEditorContextValue = {
  characters: CharacterSummary[]
  /** 供应商模型条目展示视图：真实模型名 + 所属供应商。 */
  models: ReadonlyArray<FlowModelOption>
  /** 当前调试运行会绑定的全部工具。 */
  availableTools: ReadonlyArray<FlowToolCatalogEntry>
  debugRunning: boolean
  /** 调试运行产生的工具调用轨迹，供预览节点内展示。 */
  debugToolTraces: ReadonlyArray<FlowDebugToolTrace>
  /** 展示节点的内容映射：按入边上游节点的调试产出自动绑定，逐段排列（模型/选人上游一段，角色回复每回合一段）。 */
  debugDisplayContent: Readonly<Record<string, ReadonlyArray<string>>>
  /** 展示节点的上游类型映射：决定显示文本产出还是工具调用轨迹。 */
  debugDisplayUpstream: Readonly<Record<string, FlowStepType>>
  /** 展示节点的原始模型交换映射：raw 弹窗展示未加工的请求与响应。 */
  debugDisplayRaw: Readonly<Record<string, ReadonlyArray<FlowNodeRawExchange>>>
  /** 正在执行的节点标识：执行高亮用，null 表示无节点在执行。 */
  debugActiveNodeId: string | null
  /** 本次运行已进入过的节点标识：画布保留执行路径标记。 */
  debugVisitedNodeIds: ReadonlyArray<string>
  /** 推断出的失败节点标识：节点描红定位用，null 表示无失败节点。 */
  debugFailedNodeId: string | null

  /** 可用变量分组（运行时/节点输出/终答段）：提示词补全与变量清单使用。 */
  variableGroups: ReadonlyArray<ConditionVariableGroup>
  /**
   * @description 更新指定节点的步骤配置。
   * @param nodeId 节点标识。
   * @param patch 配置补丁。
   * @returns 无返回值。
   */
  onPatchConfig: (nodeId: string, patch: Partial<FlowStepConfig>) => void
  /**
   * @description 删除指定节点及其全部连线。
   * @param nodeId 节点标识。
   * @returns 无返回值。
   */
  onRemoveNode: (nodeId: string) => void
  /**
   * @description 从已有角色填充某一个模拟角色的提示词。
   * @param nodeId 节点标识。
   * @param index 模拟角色在节点内的序号。
   * @param characterId 来源角色标识。
   * @returns 无返回值。
   */
  onFillCharacter: (nodeId: string, index: number, characterId: string) => void
}

/** 节点内编辑器上下文；未提供时控制节点不渲染节点内控件。 */
export const StepEditorContext = createContext<StepEditorContextValue | null>(null)

/** 揭示动画的上浮距离（像素）。 */
const REVEAL_OFFSET_Y = 8

/** 揭示动画的时长（秒）。 */
const REVEAL_DURATION = 0.28

/** 展示节点卡片的高度上限（像素）：内容超出在区块内滚动。 */
const DISPLAY_MAX_HEIGHT = 480

/**
 * @description 进场揭示容器：子内容挂载时以 GSAP 播放淡入上浮，替代条件渲染的硬弹出。
 * @param props 容器类名与子内容。
 * @param props.className 附加到容器的类名。
 * @param props.children 挂载时揭示的内容。
 * @returns 揭示容器。
 * @remarks 动画在布局生效前启动（useLayoutEffect），首帧即处于透明起点，无闪烁；
 *   系统或用户偏好减少动态效果时直接静态呈现；卸载时终止在飞补间并清理内联样式。
 */
function Reveal(props: { className?: string; children: ReactNode }): ReactElement {
  const ref = useRef<HTMLDivElement | null>(null)
  const { shouldAnimate } = useMotionPreference()

  useLayoutEffect(() => {
    const element = ref.current
    if (!element || !shouldAnimate) {
      return
    }
    const tween = gsap.from(element, {
      opacity: 0,
      y: REVEAL_OFFSET_Y,
      duration: REVEAL_DURATION,
      ease: 'power2.out',
      onComplete: () => gsap.set(element, { clearProps: 'transform,opacity' })
    })
    return () => {
      tween.kill()
      gsap.set(element, { clearProps: 'transform,opacity' })
    }
    // 仅挂载时播放一次：内容更新不重放入场动画，依赖留空是有意为之。
  }, [])

  return (
    <div ref={ref} className={props.className}>
      {props.children}
    </div>
  )
}

/**
 * @description React Flow 自定义节点卡片：步骤图标、入口标记、节点内编辑器与输出变量摘要。
 * @param props React Flow 节点属性。
 * @returns 节点卡片。
 */
export function StepNodeCard(props: NodeProps<StepCanvasNode>): ReactElement {
  const { step, isEntry } = props.data
  const editor = useContext(StepEditorContext)
  const meta = STEP_META[step.type]
  const definition = FLOW_STEP_DEFINITIONS[step.type]
  const isControlStep = (FLOW_CONTROL_STEP_TYPES as readonly string[]).includes(step.type)
  const category = STEP_CATEGORY_META[meta.category]
  const Icon = meta.icon
  const config = step.config ?? {}
  const outputVariable = config.outputVariable
  const visibleFields = isControlStep
    ? []
    : definition.configFields.filter((field) =>
        isFieldVisible(field, definition, config)
      )
  /** 预览节点内容：按上游节点类型自动绑定的调试产出，逐段排列。 */
  const displayContent =
    editor && step.type === 'display' ? (editor.debugDisplayContent[props.id] ?? []) : []
  /** 预览节点上游类型：决定显示文本产出还是工具调用轨迹。 */
  const displayUpstream = editor?.debugDisplayUpstream[props.id]
  /** 预览节点上游的原始模型交换：raw 弹窗数据，非模型上游为空。 */
  const displayRaws = editor?.debugDisplayRaw[props.id] ?? []
  /** 本节点是否为调试运行正在执行的节点。 */
  const debugActive = editor?.debugActiveNodeId === props.id
  /** 本节点是否为调试运行推断出的失败节点。 */
  const debugFailed = editor?.debugFailedNodeId === props.id
  /** 本节点是否已被本次调试运行执行过。 */
  const debugVisited = editor?.debugVisitedNodeIds.includes(props.id) ?? false
  /** raw 弹窗开关。 */
  const [showRaw, setShowRaw] = useState(false)
  /** 执行状态优先于选中态表达：失败描红 > 执行金色 > 选中 > 已走过暗金 > 分类常态。 */
  const skin = debugFailed
    ? 'border-red-500/80 ring-2 ring-red-500/40'
    : debugActive
      ? 'border-amber-500 shadow-[0_0_16px_rgba(217,119,6,0.3)] ring-2 ring-amber-500/50 dark:border-amber-400 dark:shadow-[0_0_16px_rgba(251,191,36,0.3)] dark:ring-amber-400/50'
      : props.selected
        ? 'border-primary ring-primary/30 ring-2'
        : debugVisited
          ? 'ring-1 ring-amber-500/40 dark:ring-amber-400/40'
          : category.border

  return (
    <div
      className={`animate-node-in bg-card group relative rounded-xl border px-3 py-2 shadow-md transition-[box-shadow,border-color] duration-150 hover:shadow-xl ${skin}`}
      style={{
        width: '100%',
        minHeight: 64,
        ...(step.type === 'display' ? { maxHeight: DISPLAY_MAX_HEIGHT } : {}),
        display: 'flex',
        flexDirection: 'column',
        ...(props.data.nodeHeight ? { height: props.data.nodeHeight } : {})
      }}
    >
      <NodeResizer
        minWidth={200}
        minHeight={80}
        isVisible={props.selected}
        lineClassName="!border-primary/40"
        handleClassName="!border-background !bg-primary !h-2 !w-2 !rounded-sm"
      />
      <span className={`${category.edge} absolute inset-y-0 left-0 w-[3px] rounded-l-xl opacity-80`} />
      <div className="flex shrink-0 items-center gap-1.5 pl-1.5">
        <span className={`${category.chip} flex items-center gap-1 rounded-md px-1.5 py-0.5`}>
          <Icon size={12} />
          <span className="text-xs font-semibold">{meta.label}</span>
        </span>
        {debugFailed && (
          <TriangleAlert size={13} className="shrink-0 text-red-600 dark:text-red-400" aria-label="执行失败" />
        )}
        {step.type === 'executeTools' && editor && (
          <ToolCatalogBadge tools={editor.availableTools} />
        )}
        <span className="ml-auto shrink-0" />
        {step.type === 'display' && displayRaws.length > 0 && (
          <button
            type="button"
            className="text-primary/80 hover:text-primary cursor-pointer font-mono text-[11px]"
            title="查看原始请求与响应"
            onClick={() => setShowRaw(true)}
          >
            raw
          </button>
        )}
        {isEntry && (
          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs text-emerald-700 dark:text-emerald-400">
            入口
          </span>
        )}
        {editor && (
          <button
            type="button"
            className="-mr-1 cursor-pointer rounded p-0.5 text-muted-foreground/50 transition-colors hover:text-red-600 opacity-0 group-hover:opacity-100 dark:hover:text-red-400"
            title="删除节点（Delete 键同效，可撤销）"
            onClick={() => editor.onRemoveNode(step.id)}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
      <p className="text-muted-foreground mt-1.5 shrink-0 pl-1.5 text-xs">{meta.hint}</p>
      <div
        className="nodrag nowheel mt-1.5 overflow-y-auto pl-1.5"
        style={{
          // 预览节点没有配置字段，容器不参与伸展，把剩余高度让给产出区块。
          flex: step.type === 'display' ? '0 0 auto' : '1 1 auto',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 8
        }}
      >
        {step.type === 'environmentInput' && editor && (
          <EnvironmentInputEditor
            config={config}
            characters={editor.characters}
            models={editor.models}
            variableGroups={editor.variableGroups}
            disabled={editor.debugRunning}
            onPatchConfig={(patch) => editor.onPatchConfig(step.id, patch)}
            onFillCharacter={(index, characterId) =>
              editor.onFillCharacter(step.id, index, characterId)
            }
          />
        )}
        {step.type === 'condition' && editor && (
          <ConditionCardBody
            config={config}
            definition={definition}
            variableGroups={editor.variableGroups}
            onPatch={(patch) => editor.onPatchConfig(step.id, patch)}
          />
        )}
        {!isControlStep &&
          step.type !== 'condition' &&
          editor &&
          visibleFields.map((field) => (
            <ConfigField
              key={field.key}
              field={field}
              config={config}
              variableGroups={editor.variableGroups}
              onChange={(patch) => editor.onPatchConfig(step.id, patch)}
            />
          ))}
        {outputVariable && (
          <p className="text-primary/80 font-mono text-xs">
            {`{{${outputVariable}}}`}
          </p>
        )}
      </div>
      {step.type === 'display' && (
        <Reveal className="border-border mt-auto flex min-h-[96px] flex-1 flex-col rounded-lg border p-2">
          <div className="nowheel nodrag min-h-0 flex-1 overflow-y-auto pr-1">
            {displayUpstream === 'executeTools' ? (
              <ToolTraceList traces={editor?.debugToolTraces ?? []} />
            ) : displayContent.length > 0 ? (
              <div className="space-y-1.5">
                {displayContent.map((line, index) => (
                  <p key={index} className="whitespace-pre-wrap text-xs leading-relaxed">
                    {line}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground/60 text-xs">
                {editor?.debugRunning ? '等待上游产出…' : '调试运行后在此显示上游内容'}
              </p>
            )}
          </div>
          {showRaw && (
            <RawExchangeDialog exchanges={displayRaws} onClose={() => setShowRaw(false)} />
          )}
        </Reveal>
      )}
      {/* 判断节点：两个分支出口在卡片底边（25%/75%），圆心经 translate 精确压在底边框线上，
          标签写在出口正上方（n8n IF 形态）；其余节点四向 Handle 统一为 source 类型：
          loose 模式下任意方向都可作为出线或入线端点。 */}
      {step.type === 'condition' ? (
        <>
          {/* 三向入口：顶部/左侧/右侧均可入线（悬停显现，同其他节点的金点）；
              入口只进不出，从这里起拖的连线由 isValidConnection 拦截。 */}
          <Handle
            id="top"
            type="source"
            position={Position.Top}
            className="handle-auto !border-background !bg-primary !h-3 !w-3 !rounded-full !border-2"
          />
          <Handle
            id="left"
            type="source"
            position={Position.Left}
            className="handle-auto !border-background !bg-primary !h-3 !w-3 !rounded-full !border-2"
          />
          <Handle
            id="right"
            type="source"
            position={Position.Right}
            className="handle-auto !border-background !bg-primary !h-3 !w-3 !rounded-full !border-2"
          />
          <div className="relative mt-auto h-10 shrink-0">
            {(
              [
                { id: 'true' as const, label: '成立', left: '25%' },
                { id: 'false' as const, label: '不成立', left: '75%' }
              ]
            ).map((item) => (
              <div
                key={item.id}
                className={`absolute bottom-1.5 flex -translate-x-1/2 flex-col items-center ${
                  item.id === 'true'
                    ? 'text-emerald-700 dark:text-emerald-300'
                    : 'text-rose-600 dark:text-rose-300'
                }`}
                style={{ left: item.left }}
              >
                <span className="text-[11px] font-semibold">{item.label}</span>
                <span className="font-mono text-[10px] leading-tight text-muted-foreground">
                  {item.id}
                </span>
              </div>
            ))}
          </div>
          <Handle
            id="true"
            type="source"
            position={Position.Bottom}
            style={{ left: '25%', bottom: 0, transform: 'translate(-50%, 50%)' }}
            className="!border-background !bg-emerald-400 !h-4 !w-4 !rounded-full !border-2"
          />
          <Handle
            id="false"
            type="source"
            position={Position.Bottom}
            style={{ left: '75%', bottom: 0, transform: 'translate(-50%, 50%)' }}
            className="!border-background !bg-rose-400 !h-4 !w-4 !rounded-full !border-2"
          />
        </>
      ) : (
        <>
          <Handle
            id="left"
            type="source"
            position={Position.Left}
            className="handle-auto !border-background !bg-primary !h-3 !w-3 !rounded-full !border-2"
          />
          <Handle
            id="top"
            type="source"
            position={Position.Top}
            className="handle-auto !border-background !bg-primary !h-3 !w-3 !rounded-full !border-2"
          />
          <Handle
            id="right"
            type="source"
            position={Position.Right}
            className="handle-auto !border-background !bg-primary !h-3 !w-3 !rounded-full !border-2"
          />
          <Handle
            id="bottom"
            type="source"
            position={Position.Bottom}
            className="handle-auto !border-background !bg-primary !h-3 !w-3 !rounded-full !border-2"
          />
        </>
      )}
    </div>
  )
}

/**
 * @description 工具调用轨迹列表：逐条展示状态徽标、摘要与入参，点击摘要在弹窗查看完整输出。
 * @param props 本运行收集的工具调用轨迹。
 * @returns 轨迹列表；无轨迹时显示占位文案。
 */
function ToolTraceList(props: { traces: ReadonlyArray<FlowDebugToolTrace> }): ReactElement {
  /** 详情弹窗正在展示的工具调用；null 表示关闭。 */
  const [activeTrace, setActiveTrace] = useState<FlowDebugToolTrace | null>(null)
  if (props.traces.length === 0) {
    return <p className="text-muted-foreground/60 text-xs">暂无工具调用</p>
  }
  return (
    <div className="space-y-1.5">
      {props.traces.map((trace) => {
        const status = TRACE_STATUS_META[trace.status]
        return (
          <Reveal key={`${trace.toolCallId}-${trace.round}`} className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <span className={`rounded px-1 py-px text-[10px] ${status.className}`}>
                {status.label}
              </span>
              <span className="truncate font-mono text-xs" title={trace.toolName}>
                {trace.toolName}
              </span>
              <span className="text-muted-foreground ml-auto shrink-0 text-[10px]">
                第 {trace.round} 轮
              </span>
            </div>
            {trace.outputSummary && (
              <div className="space-y-0.5">
                <p
                  className="text-muted-foreground line-clamp-3 cursor-pointer whitespace-pre-wrap break-all text-[11px] leading-snug transition-colors hover:text-foreground/80"
                  title="点击查看完整输出"
                  onClick={() => setActiveTrace(trace)}
                >
                  {trace.outputSummary}
                </p>
                {trace.outputSummary.length > 160 && (
                  <button
                    type="button"
                    className="text-primary/80 hover:text-primary cursor-pointer text-[11px]"
                    onClick={() => setActiveTrace(trace)}
                  >
                    查看全部
                  </button>
                )}
              </div>
            )}
          </Reveal>
        )
      })}
      {activeTrace && (
        <ToolTraceDialog trace={activeTrace} onClose={() => setActiveTrace(null)} />
      )}
    </div>
  )
}

/**
 * @description 执行工具节点右上角的可用工具入口：信息图标，悬停展开工具清单。
 * @param props 当前调试运行会绑定的全部工具。
 * @returns 悬停式工具清单徽标。
 * @remarks 清单来自主进程的工具包解析结果，与调试运行实际绑定的工具一致；
 *   展开面板以纯 CSS 悬停驱动，不占节点内编辑空间。
 */
/** 工具面板宽度（像素），与图标右缘对齐。 */
const TOOL_PANEL_WIDTH = 256

/** 工具面板最大高度（像素）。 */
const TOOL_PANEL_MAX_HEIGHT = 288

/** 悬停消失的延迟：给鼠标从图标移向面板留出间隙。 */
const TOOL_PANEL_HIDE_DELAY_MS = 160

/**
 * @description 执行工具节点右上角的可用工具入口：信息图标，悬浮展开工具清单。
 * @param props 当前调试运行会绑定的全部工具。
 * @returns 悬浮式工具清单徽标。
 * @remarks 清单来自主进程的工具包解析结果，与调试运行实际绑定的工具一致。面板经 portal
 *   挂到 body：边条件芯片所在的边标签层压在节点之上，节点内部的浮层盖不过它，只有
 *   脱离节点层级才能稳定置顶。悬浮改用 JS 延迟收起（portal 切断了 CSS 群组 hover 链）。
 */
function ToolCatalogBadge(props: {
  tools: ReadonlyArray<FlowToolCatalogEntry>
}): ReactElement {
  const { tools } = props
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null)
  const iconRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const hideTimerRef = useRef<number | null>(null)

  /** 取消延迟收起。 */
  const keepOpen = useCallback((): void => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])

  /** 打开面板并按图标当前位置定位。 */
  const openPanel = useCallback((): void => {
    keepOpen()
    const rect = iconRef.current?.getBoundingClientRect()
    if (!rect) {
      return
    }
    setAnchor({
      left: Math.max(8, Math.min(rect.right - TOOL_PANEL_WIDTH, window.innerWidth - 8 - TOOL_PANEL_WIDTH)),
      top: rect.bottom + 6
    })
    setOpen(true)
  }, [keepOpen])

  /** 延迟收起：给鼠标从图标移向面板留出间隙。 */
  const scheduleHide = useCallback((): void => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current)
    }
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null
      setOpen(false)
    }, TOOL_PANEL_HIDE_DELAY_MS)
  }, [])

  useEffect(
    () => () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current)
      }
    },
    []
  )

  // 面板打开期间页面滚动或窗口变化直接关闭（定位基于打开瞬间的图标矩形）。
  useEffect(() => {
    if (!open) {
      return
    }
    const close = (event: Event): void => {
      if (panelRef.current?.contains(event.target as Node | null)) {
        return
      }
      setOpen(false)
    }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  // 面板内 pointerdown 原生阻断冒泡：避免误关条件卡片等 window 级监听。
  useLayoutEffect(() => {
    if (!open || !panelRef.current) {
      return
    }
    const element = panelRef.current
    const stop = (event: PointerEvent): void => {
      event.stopPropagation()
    }
    element.addEventListener('pointerdown', stop)
    return () => element.removeEventListener('pointerdown', stop)
  }, [open])

  return (
    <>
      <div
        ref={iconRef}
        className="relative ml-auto flex shrink-0"
        onMouseEnter={openPanel}
        onMouseLeave={scheduleHide}
      >
        <Info size={13} className="text-muted-foreground cursor-help" />
      </div>
      {open &&
        anchor &&
        createPortal(
          <div
            ref={panelRef}
            className="border-border bg-card/95 fixed w-64 rounded-lg border p-2 text-left shadow-xl backdrop-blur"
            style={{
              left: anchor.left,
              top: anchor.top,
              maxHeight: TOOL_PANEL_MAX_HEIGHT,
              overflowY: 'auto',
              zIndex: 200
            }}
            onMouseEnter={keepOpen}
            onMouseLeave={scheduleHide}
          >
            <p className="text-muted-foreground text-xs font-semibold">
              可用工具（{tools.length}）
            </p>
            {tools.length === 0 ? (
              <p className="text-muted-foreground mt-1 text-xs">当前没有可用工具。</p>
            ) : (
              <div className="mt-1 space-y-1">
                {tools.map((tool) => (
                  <div key={tool.name}>
                    <p className="truncate font-mono text-xs" title={tool.description}>
                      {tool.name}
                    </p>
                    <p className="text-muted-foreground text-[11px] leading-snug">{tool.description}</p>
                  </div>
                ))}
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  )
}

/**
 * @description 判断节点卡片主体：条件表单（分支出口在卡片底边，见 StepNodeCard 的 footer）。
 * @param props 当前配置、步骤定义、变量分组与配置写回回调。
 * @returns 条件表单。
 * @remarks 布尔变量本身就是条件——表单只留变量下拉；其他变量按变量 + 比较符号 + 比较值
 *   求值。切换变量时自动归位比较配置，避免出现「小于 + 满足」一类不成立的存档。
 */
function ConditionCardBody(props: {
  config: FlowStepConfig
  definition: FlowStepDefinition
  variableGroups: ReadonlyArray<ConditionVariableGroup>
  onPatch: (patch: Partial<FlowStepConfig>) => void
}): ReactElement {
  const { config, definition, variableGroups, onPatch } = props
  const op = config.op ?? 'equals'
  const isBooleanVariable = FLOW_BOOLEAN_VARIABLES.includes(config.variable ?? '')
  const value = config.value ?? ''
  const opOptions =
    definition.configFields.find((field) => field.key === 'op')?.options ?? []

  /**
   * @description 切换判断变量并归位比较配置：布尔变量固定等号且取真值，其他变量清空比较值。
   * @param next 新变量名。
   */
  const changeVariable = (next: string): void => {
    onPatch(
      FLOW_BOOLEAN_VARIABLES.includes(next)
        ? { variable: next, op: 'equals', value: 'true' }
        : { variable: next, op: 'equals', value: undefined }
    )
  }

  return (
    <div className="flex items-center gap-1">
      <Select
        className="min-w-0 flex-1"
        value={config.variable ?? ''}
        placeholder="选择变量…"
        groups={variableGroups}
        onChange={changeVariable}
      />
      {!isBooleanVariable && config.variable && (
        <>
          <Select
            className="w-24 shrink-0"
            value={op}
            options={opOptions}
            onChange={(next) => onPatch({ op: next as FlowStepConfig['op'] })}
          />
          {op !== 'notEmpty' && (
            <input
              className="border-border bg-muted/40 w-20 shrink-0 rounded border px-1.5 py-1 font-mono text-xs outline-none focus:border-primary/60"
              placeholder="值"
              value={value}
              onChange={(event) => onPatch({ value: event.target.value || undefined })}
            />
          )}
        </>
      )}
    </div>
  )
}

/**
 * @description 外部输入节点的节点内编辑器：模型、用户消息与模拟角色清单。
 * @param props 当前配置、可填充角色、可用模型、变量分组、禁用状态与编辑回调。
 * @returns 模型、用户消息与模拟角色编辑控件。
 * @remarks 布局按操作频率分层：运行环境（模型）→ 用户消息（主输入，自动增高）→ 模拟角色。
 *   角色卡在窄卡片下折叠提示词、只展示已有角色名，点开编辑；删除始终可见但收为图标。
 */
function EnvironmentInputEditor(props: {
  config: FlowStepConfig
  characters: CharacterSummary[]
  models: ReadonlyArray<FlowModelOption>
  variableGroups: ReadonlyArray<ConditionVariableGroup>
  disabled: boolean
  onPatchConfig: (patch: Partial<FlowStepConfig>) => void
  onFillCharacter: (index: number, characterId: string) => void
}): ReactElement {
  const { config, characters, models, variableGroups, disabled, onPatchConfig, onFillCharacter } = props
  const entries = config.simulatedCharacters ?? []
  const canAddCharacter = entries.length < 8

  /** 模型选项按供应商分组：展示名取模型条目的 model 字段，存储值仍是条目标识。 */
  const modelGroups = useMemo<SelectGroup[]>(() => {
    const byProvider = new Map<string, SelectOption[]>()
    for (const model of models) {
      const options = byProvider.get(model.providerName) ?? []
      options.push({ value: model.id, label: model.label })
      byProvider.set(model.providerName, options)
    }
    return [...byProvider].map(([label, options]) => ({ label, options }))
  }, [models])

  /**
   * @description 写回模拟角色清单。
   * @param next 新的模拟角色清单。
   * @returns 无返回值。
   */
  const patchEntries = (next: FlowSimulatedCharacter[]): void => {
    onPatchConfig({ simulatedCharacters: next.length > 0 ? next : undefined })
  }

  /**
   * @description 更新单个模拟角色。
   * @param index 角色序号。
   * @param patch 角色字段补丁。
   * @returns 无返回值。
   */
  const patchEntry = (index: number, patch: Partial<FlowSimulatedCharacter>): void => {
    patchEntries(
      entries.map((entry, itemIndex) =>
        itemIndex === index ? { ...entry, ...patch } : entry
      )
    )
  }

  /** 角色卡头部：填充过已有角色时展示其名字，否则按序号。 */
  const entryTitle = (index: number): string => {
    const source = entries[index]?.sourceCharacterId
    const name = source ? characters.find((item) => item.id === source)?.name : undefined
    return name ?? `角色 ${index + 1}`
  }

  return (
    <div className="nodrag nowheel mt-1.5 space-y-3 pl-1.5">
      <section className="space-y-1">
        <p className="text-muted-foreground text-xs font-semibold">运行环境</p>
        <Select
          className="w-full"
          title={models.find((item) => item.id === config.modelId)?.label}
          value={config.modelId ?? ''}
          placeholder={models.length > 0 ? '选择模型…' : '没有可用模型'}
          disabled={disabled || models.length === 0}
          groups={modelGroups}
          onChange={(next) => onPatchConfig({ modelId: next || undefined })}
        />
      </section>

      <section className="space-y-1">
        <p className="text-muted-foreground text-xs font-semibold">用户消息</p>
        <AutoGrowTextarea
          value={config.inputText ?? ''}
          placeholder="输入一条消息…"
          minRows={2}
          maxRows={10}
          disabled={disabled}
          expandTitle="用户消息"
          onChange={(next) => onPatchConfig({ inputText: next || undefined })}
        />
      </section>

      <section className="space-y-1.5">
        <p className="text-muted-foreground text-xs font-semibold">
          模拟角色（{entries.length}/8）
        </p>
        <SimulatedCharacterTabs
          entries={entries}
          entryTitle={entryTitle}
          characters={characters}
          variableGroups={variableGroups}
          disabled={disabled}
          canAdd={canAddCharacter}
          onAdd={() => patchEntries([...entries, {}])}
          onRemove={(index) => patchEntries(entries.filter((_, itemIndex) => itemIndex !== index))}
          onFill={onFillCharacter}
          onPromptChange={(index, prompt) => patchEntry(index, { prompt: prompt || undefined })}
        />
      </section>
    </div>
  )
}

/** 单行文本的近似行高（像素），供最大高度换算。 */
const LINE_HEIGHT_PX = 18

/**
 * @description 保存受控输入框的光标位置，并在值提交后恢复。
 * @param ref 输入框元素引用。
 * @param value 受控值；每次变更后执行一次恢复。
 * @returns 保存回调：在 onChange 里、把新值交给状态前调用，记录此刻的光标区间。
 * @remarks 画布节点内的输入随每次键入触发节点数据重建与重渲染，React 可能在提交中重写
 *   DOM 值，浏览器随之把光标重置到末尾；本钩子在提交完成后恢复输入时刻的光标位置。
 *   值未被重写时重复设置同一区间是无操作；失焦或外部改值（无保存回调）不干预。
 */
function usePreserveCaret(
  ref: RefObject<HTMLTextAreaElement | HTMLInputElement | null>,
  value: string
): (element: HTMLTextAreaElement | HTMLInputElement) => void {
  /** 最近一次输入时刻的光标区间；提交恢复后清空。 */
  const caretRef = useRef<[number, number] | null>(null)

  const save = useCallback((element: HTMLTextAreaElement | HTMLInputElement): void => {
    const start = element.selectionStart
    const end = element.selectionEnd
    if (start !== null && end !== null) {
      caretRef.current = [start, end]
    }
  }, [])

  useLayoutEffect(() => {
    const element = ref.current
    const caret = caretRef.current
    caretRef.current = null
    if (!element || !caret || document.activeElement !== element) {
      return
    }
    element.setSelectionRange(caret[0], caret[1])
  }, [ref, value])

  return save
}

/**
 * @description 自动增高的多行文本框，可选全屏编辑：弹窗内以提示词编辑组件承载，保留变量补全。
 * @param props 受控值、行数范围、变更回调、全屏标题与可选变量分组。
 * @returns 随内容伸缩的 textarea。
 * @remarks 高度在每次渲染后按内容重算，受 minRows/maxRows 约束；为空时回落到最小行数。
 *   全屏弹窗内统一用提示词编辑组件（填满模式），variableGroups 缺省时不给补全与变量清单。
 */
function AutoGrowTextarea(props: {
  value: string
  placeholder?: string
  minRows: number
  maxRows: number
  disabled?: boolean
  onChange: (value: string) => void
  expandTitle?: string
  variableGroups?: ReadonlyArray<ConditionVariableGroup>
}): ReactElement {
  const { value, placeholder, minRows, maxRows, disabled, expandTitle, variableGroups } = props
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const saveCaret = usePreserveCaret(ref, value)
  /** 全屏编辑弹窗开关；未提供标题时按钮不渲染。 */
  const [expanded, setExpanded] = useState(false)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, maxRows * LINE_HEIGHT_PX)}px`
    element.style.overflowY = element.scrollHeight > maxRows * LINE_HEIGHT_PX ? 'auto' : 'hidden'
  }, [maxRows, value])

  /** 全屏弹窗内实例的挂载回调：聚焦并把光标移到末尾。 */
  const focusTextarea = useCallback((element: HTMLTextAreaElement | null): void => {
    if (!element) {
      return
    }
    element.focus()
    element.setSelectionRange(element.value.length, element.value.length)
  }, [])

  return (
    <>
      <div className="group relative">
        <textarea
          ref={ref}
          className="border-border bg-muted/40 w-full resize-none rounded border px-2 py-1 text-xs leading-relaxed outline-none focus:border-primary/60"
          rows={minRows}
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            saveCaret(event.target)
            props.onChange(event.target.value)
          }}
        />
        {expandTitle !== undefined && (
          <div className="absolute right-1.5 top-1.5 z-10 opacity-50 transition-opacity group-hover:opacity-100">
            <FullscreenTextareaButton onExpand={() => setExpanded(true)} />
          </div>
        )}
      </div>
      {expanded &&
        expandTitle !== undefined &&
        createPortal(
          <FullscreenTextareaDialog title={expandTitle} onClose={() => setExpanded(false)}>
            <PromptTextarea
              value={value}
              onChange={props.onChange}
              variableGroups={variableGroups ?? []}
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
    </>
  )
}

/**
 * @description 模拟角色标签组：角色以标签页呈现，同一时刻只展开当前角色的编辑区。
 * @param props 角色清单、标签标题、可填充角色、变量分组与编辑回调。
 * @param props.entries 模拟角色清单。
 * @param props.entryTitle 角色序号到标签标题的映射（填充过已有角色时显示其名字）。
 * @param props.characters 可填充的已有角色。
 * @param props.variableGroups 可用变量分组，供提示词编辑器补全。
 * @param props.disabled 禁用交互。
 * @param props.canAdd 是否还能添加角色（上限 8）。
 * @param props.onAdd 添加一个空角色；激活序号由调用方切到新角色。
 * @param props.onRemove 删除指定序号的角色。
 * @param props.onFill 用已有角色填充指定序号的提示词。
 * @param props.onPromptChange 更新指定序号的提示词。
 * @returns 角色标签行与当前角色的编辑区。
 * @remarks 节点高度不随角色数量累加：只有激活角色占据编辑区；激活序号经收敛始终落在
 *   有效范围内，删除当前角色后自动落到相邻角色。
 */
function SimulatedCharacterTabs(props: {
  entries: FlowSimulatedCharacter[]
  entryTitle: (index: number) => string
  characters: CharacterSummary[]
  variableGroups: ReadonlyArray<ConditionVariableGroup>
  disabled: boolean
  canAdd: boolean
  onAdd: () => void
  onRemove: (index: number) => void
  onFill: (index: number, characterId: string) => void
  onPromptChange: (index: number, prompt: string) => void
}): ReactElement {
  const { entries, entryTitle, characters, variableGroups, disabled, canAdd, onAdd, onRemove, onFill, onPromptChange } = props
  const [activeIndex, setActiveIndex] = useState(0)
  const active = Math.min(activeIndex, entries.length - 1)
  const canRemove = entries.length > 1
  const entry = entries[active]

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {entries.map((_, index) => (
          <button
            key={index}
            type="button"
            className={`cursor-pointer rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
              index === active
                ? 'border-primary/40 bg-primary/15 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveIndex(index)}
          >
            {entryTitle(index)}
          </button>
        ))}
        {canAdd && (
          <button
            type="button"
            className="border-border text-muted-foreground hover:text-foreground cursor-pointer rounded-full border border-dashed px-2.5 py-0.5 text-xs transition-colors"
            title="添加角色"
            onClick={() => {
              setActiveIndex(entries.length)
              onAdd()
            }}
          >
            ＋
          </button>
        )}
      </div>
      {entry && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Select
              className="min-w-0 flex-1"
              value=""
              placeholder={characters.length > 0 ? '从已有角色填充…' : '没有可填充的角色'}
              disabled={disabled || characters.length === 0}
              options={characters.map((character) => ({
                value: character.id,
                label: character.name
              }))}
              onChange={(next) => {
                if (next) {
                  onFill(active, next)
                }
              }}
            />
            {canRemove && (
              <Button
                variant="ghost"
                size="icon-xs"
                title="删除当前角色"
                disabled={disabled}
                onClick={() => onRemove(active)}
              >
                <Trash2 size={12} />
              </Button>
            )}
          </div>
          <AutoGrowTextarea
            value={entry.prompt ?? ''}
            placeholder="角色提示词…"
            minRows={3}
            maxRows={14}
            disabled={disabled}
            expandTitle={`${entryTitle(active)} · 角色提示词`}
            variableGroups={variableGroups}
            onChange={(next) => onPromptChange(active, next)}
          />
        </div>
      )}
    </div>
  )
}

/**
 * @description 按字段定义渲染一个配置控件。
 * @param props 字段定义、当前配置与配置补丁回调。
 * @returns 配置控件。
 */
function ConfigField(props: {
  field: FlowConfigFieldDefinition
  config: FlowStepConfig
  variableGroups: ReadonlyArray<ConditionVariableGroup>
  onChange: (patch: Partial<FlowStepConfig>) => void
}): ReactElement {
  const { field, config, variableGroups, onChange } = props
  const value = config[field.key] ?? field.defaultValue
  const fieldInputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null)
  const saveFieldCaret = usePreserveCaret(fieldInputRef, typeof value === 'string' ? value : '')

  switch (field.kind) {
    case 'text':
      return (
        <LabeledField label={field.label}>
          <input
            ref={fieldInputRef as RefObject<HTMLInputElement | null>}
            className="border-border bg-muted/40 w-full rounded border px-2 py-1 font-mono text-xs outline-none focus:border-primary/60"
            placeholder={field.placeholder}
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => {
              saveFieldCaret(event.target)
              onChange({
                [field.key]: event.target.value || undefined
              } as Partial<FlowStepConfig>)
            }}
          />
        </LabeledField>
      )
    case 'textarea': {
      // 字段定义携带的上下文变量组（如评分变量）排在通用分组之前，供插入菜单与高亮识别。
      const fieldGroups = field.variables
        ? [
            {
              label: field.variables.label,
              options: field.variables.items.map((item) => ({
                value: item.name,
                description: item.description
              }))
            },
            ...variableGroups
          ]
        : variableGroups
      return (
        <label
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            flex: '1 1 auto',
            minHeight: 0
          }}
        >
          <span className="text-muted-foreground text-xs">{field.label}</span>
          <PromptTextarea
            value={typeof value === 'string' ? value : ''}
            onChange={(next) =>
              onChange({ [field.key]: next || undefined } as Partial<FlowStepConfig>)
            }
            variableGroups={fieldGroups}
            placeholder={field.placeholder}
            minRows={field.rows ?? 4}
            maxRows={18}
            fill
            expandable
            expandTitle={field.label}
          />
        </label>
      )
    }
    case 'number':
      return (
        <NumberField
          label={field.label}
          value={typeof value === 'number' ? value : undefined}
          min={field.min}
          max={field.max}
          step={field.step}
          onChange={(next) =>
            onChange({ [field.key]: next } as Partial<FlowStepConfig>)
          }
        />
      )
    case 'boolean':
      return (
        <CheckboxField
          label={field.label}
          checked={value === true}
          onChange={(checked) =>
            onChange({ [field.key]: checked } as Partial<FlowStepConfig>)
          }
        />
      )
    case 'select':
      return (
        <LabeledField label={field.label}>
          <Select
            className="w-full"
            value={typeof value === 'string' ? value : ''}
            options={(field.options ?? []).map((option) => ({
              value: option.value,
              label: option.label
            }))}
            onChange={(next) =>
              onChange({ [field.key]: next || undefined } as Partial<FlowStepConfig>)
            }
          />
        </LabeledField>
      )
    case 'variable': {
      const variable = typeof value === 'string' ? value : ''
      const invalid = Boolean(variable) && !isValidFlowOutputVariable(variable)
      return (
        <LabeledField label={field.label}>
          <div className="space-y-1">
            <input
              className="border-border bg-muted/40 w-full rounded border px-2 py-1 font-mono text-xs outline-none focus:border-primary/60"
              placeholder={field.placeholder}
              list="agent-lab-variables"
              value={variable}
              onChange={(event) =>
                onChange({
                  [field.key]: event.target.value || undefined
                } as Partial<FlowStepConfig>)
              }
            />
            {invalid && (
              <p className="text-xs text-amber-500">
                变量名只能包含字母、数字、下划线、连字符或汉字，且不能与运行时变量重名。
              </p>
            )}
          </div>
        </LabeledField>
      )
    }
    case 'conditionVariable': {
      return (
        <LabeledField label={field.label}>
          <Select
            className="w-full"
            value={typeof value === 'string' ? value : ''}
            placeholder="选择变量…"
            groups={variableGroups}
            onChange={(next) => onChange({ [field.key]: next } as Partial<FlowStepConfig>)}
          />
        </LabeledField>
      )
    }
    case 'conditionValue': {
      // 布尔变量的比较值收编为满足/不满足二选一，避免手写 true/false 字符串。
      const isBooleanVariable = FLOW_BOOLEAN_VARIABLES.includes(config.variable ?? '')
      if (isBooleanVariable) {
        return (
          <LabeledField label={field.label}>
            <Select
              className="w-full"
              value={typeof value === 'string' ? value : ''}
              placeholder="选择…"
              options={[
                { value: 'true', label: '满足' },
                { value: 'false', label: '不满足' }
              ]}
              onChange={(next) => onChange({ [field.key]: next } as Partial<FlowStepConfig>)}
            />
          </LabeledField>
        )
      }
      return (
        <LabeledField label={field.label}>
          <input
            ref={fieldInputRef as RefObject<HTMLInputElement | null>}
            className="border-border bg-muted/40 w-full rounded border px-2 py-1 font-mono text-xs outline-none focus:border-primary/60"
            placeholder={field.placeholder}
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => {
              saveFieldCaret(event.target)
              onChange({ [field.key]: event.target.value || undefined } as Partial<FlowStepConfig>)
            }}
          />
        </LabeledField>
      )
    }
    case 'simulated-characters':
      return <p className="text-muted-foreground text-xs">该字段在节点内编辑。</p>
    default:
      return <p className="text-muted-foreground text-xs">不支持的字段类型。</p>
  }
}

/**
 * @description 判断字段在当前配置下是否可见。
 * @param field 字段定义。
 * @param definition 所属步骤定义。
 * @param config 当前配置。
 * @returns 满足可见条件时返回 true。
 */
function isFieldVisible(
  field: FlowConfigFieldDefinition,
  definition: FlowStepDefinition,
  config: FlowStepConfig
): boolean {
  const condition = field.visibleWhen
  if (!condition) {
    return true
  }
  const controller = definition.configFields.find((item) => item.key === condition.field)
  const actual = config[condition.field] ?? controller?.defaultValue
  if (condition.equals !== undefined) {
    return actual === condition.equals
  }
  if (condition.notEquals !== undefined) {
    if (Array.isArray(condition.notEquals)) {
      return !condition.notEquals.includes(actual as string)
    }
    return actual !== condition.notEquals
  }
  return true
}

/**
 * @description 数字字段。
 * @param props 标签、当前值、范围与变更回调。
 * @returns 数字输入行。
 */
function NumberField(props: {
  label: string
  value?: number
  min?: number
  max?: number
  step?: number
  onChange: (value: number | undefined) => void
}): ReactElement {
  return (
    <LabeledField label={props.label}>
      <input
        type="number"
        className="border-border bg-muted/40 w-full rounded border px-2 py-1 text-xs outline-none focus:border-primary/60"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value ?? ''}
        onChange={(event) => {
          const raw = event.target.value.trim()
          props.onChange(raw ? Number(raw) : undefined)
        }}
      />
    </LabeledField>
  )
}

/**
 * @description 布尔字段。
 * @param props 标签、当前值与变更回调。
 * @returns 复选框行。
 */
function CheckboxField(props: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}): ReactElement {
  return (
    <label className="flex items-center gap-2 text-xs">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      {props.label}
    </label>
  )
}

/**
 * @description 带标签的字段容器。
 * @param props 标签与字段内容。
 * @returns 字段行。
 */
function LabeledField(props: { label: string; children: ReactNode }): ReactElement {
  return (
    <label className="block space-y-1">
      <span className="text-muted-foreground text-xs">{props.label}</span>
      {props.children}
    </label>
  )
}
