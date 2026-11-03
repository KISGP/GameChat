/**
 * @description 流程编辑器的画布模型：正式流程包与 React Flow 画布的双向转换、自动布局、条件摘要与内置模板。
 * @remarks 画布坐标与节点尺寸属于编辑器本地状态（不在 FlowPackage 内）；连线端点侧别随流程包保存，
 *   转换产物必须能通过 schema 的 normalizeFlowPackage——模板与连线约束都以该函数的口径为准。
 */
import type { Edge, Node } from '@xyflow/react'
import dagre from '@dagrejs/dagre'
import type {
  FlowBranchValue,
  FlowEdge,
  FlowEdgeSide,
  FlowGraph,
  FlowNode,
  FlowPackage,
  FlowStepConfig,
  FlowStepType
} from '@gamechat/type'
import { FLOW_DEFAULT_PROMPTS, FLOW_STEP_DEFINITIONS, FLOW_STEP_ORDER, FLOW_BUILTIN_VARIABLES, FLOW_FINAL_ANSWER_SECTION_VARIABLES, type FlowStepCategory } from '@gamechat/schema'
import {
  Bot,
  Brain,
  Eye,
  Gauge,
  GitBranch,
  MessageSquare,
  Search,
  Users,
  type LucideIcon
} from 'lucide-react'

/** 画布节点数据：正式步骤节点 + 入口标记 + 用户调整后的高度。 */
export type StepNodeData = {
  step: FlowNode
  isEntry: boolean
  /** 用户手动调整后的节点高度；未调整时缺省，卡片按内容自适应。 */
  nodeHeight?: number
}

/** 画布节点类型别名。 */
export type StepCanvasNode = Node<StepNodeData, 'step'>

/** 画布边数据：判断节点的分支标记记录在出侧 Handle 上，边本身无数据。 */
export type StepCanvasEdge = Edge<Record<string, never>>

/** 节点视觉类别：决定图标配色与连线着色。 */
export type StepCategory = FlowStepCategory

/** 类别视觉规格。 */
/** 连线颜色按主题分档：明色用深色系保证浅底对比，暗色维持亮色系。 */
export type StepEdgeColors = { light: string; dark: string }

export const STEP_CATEGORY_META: Record<
  StepCategory,
  { chip: string; border: string; ring: string; edge: StepEdgeColors }
> = {
  model: {
    chip: 'bg-primary/15 text-primary',
    border: 'border-primary/40',
    ring: 'ring-primary/50',
    edge: { light: '#c9a45c', dark: '#e8c690' }
  },
  tool: {
    chip: 'bg-emerald-600/10 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300',
    border: 'border-emerald-600/40 dark:border-emerald-400/40',
    ring: 'ring-emerald-600/50 dark:ring-emerald-400/50',
    edge: { light: '#059669', dark: '#34d399' }
  },
  intent: {
    chip: 'bg-violet-600/10 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300',
    border: 'border-violet-600/40 dark:border-violet-400/40',
    ring: 'ring-violet-600/50 dark:ring-violet-400/50',
    edge: { light: '#7c3aed', dark: '#a78bfa' }
  },
  flow: {
    chip: 'bg-slate-500/10 text-slate-600 dark:bg-slate-400/15 dark:text-slate-300',
    border: 'border-slate-500/40 dark:border-slate-400/40',
    ring: 'ring-slate-500/50 dark:ring-slate-400/50',
    edge: { light: '#64748b', dark: '#94a3b8' }
  },
  control: {
    chip: 'bg-teal-600/10 text-teal-700 dark:bg-teal-400/15 dark:text-teal-300',
    border: 'border-teal-600/40 dark:border-teal-400/40',
    ring: 'ring-teal-600/50 dark:ring-teal-400/50',
    edge: { light: '#0d9488', dark: '#2dd4bf' }
  },
  environment: {
    chip: 'bg-cyan-600/10 text-cyan-700 dark:bg-cyan-400/15 dark:text-cyan-300',
    border: 'border-cyan-600/40 dark:border-cyan-400/40',
    ring: 'ring-cyan-600/50 dark:ring-cyan-400/50',
    edge: { light: '#0891b2', dark: '#22d3ee' }
  }
}

/** 步骤元数据视图：展示名、图标、类别、画布提示与参数页说明。 */
export type StepMeta = {
  label: string
  icon: LucideIcon
  category: StepCategory
  hint: string
  description: string
}

/** 步骤类型到图标的映射；其余元数据由 schema 的步骤定义提供。 */
const STEP_ICONS: Record<FlowStepType, LucideIcon> = {
  selectSpeaker: Users,
  condition: GitBranch,
  route: Brain,
  executeTools: Search,
  finalAnswer: MessageSquare,
  llm: Bot,
  intent: Gauge,
  display: Eye,
  environmentInput: MessageSquare
}

/** 步骤元数据：展示名、图标、类别、画布提示与参数页说明。 */
export const STEP_META = Object.fromEntries(
  FLOW_STEP_ORDER.map((type) => {
    const definition = FLOW_STEP_DEFINITIONS[type]
    return [
      type,
      {
        label: definition.label,
        icon: STEP_ICONS[type],
        category: definition.category,
        hint: definition.hint,
        description: definition.description
      }
    ]
  })
) as Record<FlowStepType, StepMeta>

/** 节点池展示顺序。 */
export const STEP_ORDER: readonly FlowStepType[] = FLOW_STEP_ORDER

/**
 * @description 生成一个画布节点标识。
 * @returns 进程内唯一的节点标识。
 */
export function createStepId(): string {
  return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/** 会带系统提示词的步骤类型到内置默认提示词的映射。 */
const DEFAULT_PROMPT_BY_TYPE: Partial<Record<FlowStepType, string>> = {
  selectSpeaker: FLOW_DEFAULT_PROMPTS.intent,
  route: FLOW_DEFAULT_PROMPTS.route,
  intent: FLOW_DEFAULT_PROMPTS.intent,
  finalAnswer: FLOW_DEFAULT_PROMPTS.finalAnswer
}

/**
 * @description 给步骤节点补上内置默认提示词。
 * @param step 流程节点。
 * @returns 补上默认提示词后的节点；已有提示词或该步骤没有默认值时原样返回。
 * @remarks 默认提示词直接写入节点配置，节点里看到的就是运行时使用的提示词。
 */
export function withDefaultPrompt(step: FlowNode): FlowNode {
  const defaultPrompt = DEFAULT_PROMPT_BY_TYPE[step.type]
  if (!defaultPrompt || step.config?.systemPromptTemplate?.trim()) {
    return step
  }
  return {
    ...step,
    config: { ...step.config, systemPromptTemplate: defaultPrompt }
  }
}

/**
 * @description 创建一个带缺省配置的画布节点。
 * @param type 步骤类型。
 * @param id 节点标识。
 * @param position 画布坐标。
 * @returns 画布节点；可配置步骤携带缺省配置，无配置字段的步骤省略 config。
 */
export function createStepNode(
  type: FlowStepType,
  id: string,
  position: { x: number; y: number }
): StepCanvasNode {
  const hasConfig = FLOW_STEP_DEFINITIONS[type].configFields.length > 0
  const config: FlowStepConfig = {
    ...(type === 'environmentInput' ? { simulatedCharacters: [{}] } : {}),
    ...(DEFAULT_PROMPT_BY_TYPE[type]
      ? { systemPromptTemplate: DEFAULT_PROMPT_BY_TYPE[type] }
      : {})
  }
  return {
    id,
    type: 'step',
    width: nodeCardWidth(type),
    position,
    data: { step: hasConfig ? { id, type, config } : { id, type }, isEntry: false }
  }
}

/** 节点卡片的缺省宽度：无配置字段的步骤保持窄卡片。 */
const LAYOUT_NODE_WIDTH = 240

/**
 * @description 计算步骤节点的卡片宽度。
 * @param type 步骤类型。
 * @returns 卡片宽度像素值。
 * @remarks 外部输入节点容纳用户消息与模拟角色；带配置字段的步骤需要更宽的表单。
 */
export function nodeCardWidth(type: FlowStepType): number {
  if (type === 'environmentInput') {
    return 320
  }
  return FLOW_STEP_DEFINITIONS[type].configFields.length > 0 ? 280 : LAYOUT_NODE_WIDTH
}

/**
 * @description 估算步骤节点的卡片高度，供自动布局使用。
 * @param node 流程节点。
 * @returns 宽高估算值。
 * @remarks 节点内表单高度随配置字段变化，布局按字段类型与行数估算；
 *   运行时 React Flow 仍以真实测量尺寸绘制连线。
 */
function estimateNodeSize(node: FlowNode): { width: number; height: number } {
  const width = nodeCardWidth(node.type)
  if (node.type === 'environmentInput') {
    const count = node.config?.simulatedCharacters?.length ?? 0
    return { width, height: 200 + count * 240 }
  }
  let height = 72
  for (const field of FLOW_STEP_DEFINITIONS[node.type].configFields) {
    height += field.kind === 'textarea' ? 26 + (field.rows ?? 4) * 18 : 48
  }
  return { width, height }
}

/**
 * @description 用 dagre 计算流程图各节点的坐标。
 * @param graph 流程图（入口、节点与边）。
 * @returns 节点 ID 到左上角坐标的映射。
 * @remarks 自上而下布局；dagre 负责分层与跨层最小化；环入边按 greedy 策略临时反向参与布局，
 *   渲染时仍按原始边方向绘制。
 */
export function layoutGraph(
  graph: Pick<FlowGraph, 'entry' | 'nodes' | 'edges'>
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()
  if (graph.nodes.length === 0) {
    return positions
  }
  const layout = new dagre.graphlib.Graph()
  layout.setGraph({
    rankdir: 'TB',
    nodesep: 56,
    ranksep: 96,
    edgesep: 24,
    marginx: 40,
    marginy: 40,
    acyclicer: 'greedy',
    ranker: 'network-simplex'
  })
  layout.setDefaultEdgeLabel(() => ({}))
  for (const node of graph.nodes) {
    layout.setNode(node.id, estimateNodeSize(node))
  }
  for (const edge of graph.edges) {
    layout.setEdge(edge.from, edge.to)
  }
  dagre.layout(layout)
  for (const node of graph.nodes) {
    const point = layout.node(node.id) as { x: number; y: number } | undefined
    if (!point) {
      continue
    }
    const size = estimateNodeSize(node)
    positions.set(node.id, {
      x: point.x - size.width / 2,
      y: point.y - size.height / 2
    })
  }
  return positions
}

/**
 * @description 读取节点用于选侧的视觉尺寸。
 * @param node 画布节点。
 * @returns 宽高像素值。
 * @remarks 优先取 React Flow 的测量值，其次取显式宽高，最后按步骤类型估算。
 */
function nodeRoutingSize(node: StepCanvasNode): { width: number; height: number } {
  const estimated = estimateNodeSize(node.data.step)
  return {
    width: node.measured?.width ?? node.width ?? estimated.width,
    height: node.measured?.height ?? node.height ?? estimated.height
  }
}

/**
 * @description 按两个节点中心点的相对位置选择一条边的出/入侧。
 * @param sourceNode 起点节点。
 * @param targetNode 终点节点。
 * @returns 出线侧与入线侧。
 * @remarks 以中心点判定，节点宽高不同也不会偏向边角；只在建线或流程包缺少端点侧别时调用一次，
 *   之后端点固定，不随节点移动变化。
 */
export function initialEdgeSides(
  sourceNode: StepCanvasNode,
  targetNode: StepCanvasNode
): { sourceHandle: FlowEdgeSide; targetHandle: FlowEdgeSide } {
  const source = nodeRoutingSize(sourceNode)
  const target = nodeRoutingSize(targetNode)
  const dx =
    targetNode.position.x + target.width / 2 - (sourceNode.position.x + source.width / 2)
  const dy =
    targetNode.position.y + target.height / 2 - (sourceNode.position.y + source.height / 2)
  if (Math.abs(dy) >= Math.abs(dx)) {
    return dy >= 0
      ? { sourceHandle: 'bottom', targetHandle: 'top' }
      : { sourceHandle: 'top', targetHandle: 'bottom' }
  }
  return dx >= 0
    ? { sourceHandle: 'right', targetHandle: 'left' }
    : { sourceHandle: 'left', targetHandle: 'right' }
}

/**
 * @description 判断画布 Handle 标识是否为合法的端点侧别。
 * @param value 画布 Handle 标识。
 * @returns 属于 `left | right | top | bottom` 时返回 true。
 */
function isEdgeSide(value: string | null | undefined): value is FlowEdgeSide {
  return value === 'left' || value === 'right' || value === 'top' || value === 'bottom'
}

/**
 * @description 判断画布 Handle 标识是否为判断节点的分支标记。
 * @param value 画布 Handle 标识。
 * @returns 属于 `true | false` 时返回 true。
 */
function isBranchValue(value: string | null | undefined): value is FlowBranchValue {
  return value === 'true' || value === 'false'
}

/**
 * @description 把正式流程包转换为画布节点与边。
 * @param graph 流程图。
 * @returns 画布节点与边；坐标与尺寸优先取流程包内的摆位记录，缺失时用自动布局与默认宽度。
 * @remarks 边优先使用流程包记录的端点侧别；缺失时按节点中心位置补算一次。判断节点入线
 *   落在顶/左/右入口 Handle（缺省按起点相对方位选取），分支 Handle 只作为出线端点。
 */
export function toCanvas(graph: FlowGraph): { nodes: StepCanvasNode[]; edges: StepCanvasEdge[] } {
  const layout = layoutGraph(graph)
  const nodes: StepCanvasNode[] = graph.nodes.map((step) => {
    const saved = graph.layout?.[step.id]
    return {
      id: step.id,
      type: 'step',
      width: saved?.width ?? nodeCardWidth(step.type),
      ...(saved?.height ? { height: saved.height } : {}),
      position: saved
        ? { x: saved.x, y: saved.y }
        : layout.get(step.id) ?? { x: 80, y: 120 },
      data: { step, isEntry: step.id === graph.entry }
    }
  })
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const edges: StepCanvasEdge[] = graph.edges.map((edge) => {
    const sourceNode = nodeById.get(edge.from)
    const targetNode = nodeById.get(edge.to)
    // 判断节点的出线固定从分支 Handle 出发、入线落在三向入口；其余节点按端点侧别或相对位置补算。
    const sourceHandle =
      edge.branch ?? edge.fromSide ?? (sides(sourceNode, targetNode)?.sourceHandle ?? 'right')
    const targetIsCondition = nodeById.get(edge.to)?.data.step.type === 'condition'
    return {
      id: `e-${edge.from}-${edge.to}`,
      source: edge.from,
      target: edge.to,
      sourceHandle,
      targetHandle: targetIsCondition
        ? (edge.toSide && CONDITION_ENTRY_SIDES.includes(edge.toSide)
            ? edge.toSide
            : conditionEntryFallback(sourceNode, targetNode))
        : (edge.toSide ?? sides(sourceNode, targetNode)?.targetHandle ?? 'left'),
      data: {}
    }
  })
  return { nodes, edges }
}

/** 判断节点的入口 Handle 取值：顶/左/右三向可入线，分支 Handle 仅作输出。 */
export const CONDITION_ENTRY_SIDES: readonly string[] = ['top', 'left', 'right']

/**
 * @description 按起点相对方位为判断节点选入线入口侧。
 * @param sourceNode 起点节点。
 * @param targetNode 判断节点。
 * @returns 起点偏左入左侧、偏右入右侧，其余顶部。
 */
function conditionEntryFallback(
  sourceNode: StepCanvasNode | undefined,
  targetNode: StepCanvasNode | undefined
): 'top' | 'left' | 'right' {
  if (sourceNode && targetNode) {
    if (sourceNode.position.x < targetNode.position.x) {
      return 'left'
    }
    if (sourceNode.position.x > targetNode.position.x) {
      return 'right'
    }
  }
  return 'top'
}

/**
 * @description 按两个节点的中心位置补算端点侧别；任一节点缺失时返回 null。
 * @param sourceNode 起点节点。
 * @param targetNode 终点节点。
 * @returns 出/入侧别；无法补算时为 null。
 */
function sides(
  sourceNode: StepCanvasNode | undefined,
  targetNode: StepCanvasNode | undefined
): { sourceHandle: FlowEdgeSide; targetHandle: FlowEdgeSide } | null {
  return sourceNode && targetNode ? initialEdgeSides(sourceNode, targetNode) : null
}

/**
 * @description 把画布节点与边转换为正式流程包（剥离入口标记，摆位写入流程包）。
 * @param meta 流程包标识与显示名。
 * @param nodes 画布节点。
 * @param edges 画布边。
 * @param entry 入口节点标识。
 * @returns 可保存或导出的流程包。
 * @remarks 摆位（坐标与已调整尺寸）随流程包走：保存、导出与复制都携带，画布外观与流程内容同源。
 */
export function toFlowPackage(
  meta: { id: string; name: string },
  nodes: StepCanvasNode[],
  edges: StepCanvasEdge[],
  entry: string
): FlowPackage {
  const layout: Record<string, { x: number; y: number; width?: number; height?: number }> = {}
  for (const node of nodes) {
    layout[node.id] = {
      x: node.position.x,
      y: node.position.y,
      ...(typeof node.width === 'number' ? { width: node.width } : {}),
      ...(typeof node.height === 'number' ? { height: node.height } : {})
    }
  }
  return {
    id: meta.id,
    name: meta.name,
    graph: {
      entry,
      nodes: nodes.map((node) => node.data.step),
      edges: edges.map((edge): FlowEdge => {
        const branch = isBranchValue(edge.sourceHandle) ? edge.sourceHandle : undefined
        return {
          from: edge.source,
          to: edge.target,
          ...(branch ? { branch } : {}),
          ...(isEdgeSide(edge.sourceHandle) ? { fromSide: edge.sourceHandle } : {}),
          ...(isEdgeSide(edge.targetHandle) ? { toSide: edge.targetHandle } : {})
        }
      }),
      layout
    }
  }
}

/**
 * @description 汇总可用的变量名：运行时变量 + 终答 section 变量 + 各节点的输出变量。
 * @param nodes 画布节点。
 * @returns 去重后的变量名清单，供条件编辑器与模板提示引用。
 */
export function collectVariableNames(nodes: StepCanvasNode[]): string[] {
  const outputNames = nodes
    .map((node) => node.data.step.config?.outputVariable)
    .filter((name): name is string => Boolean(name?.trim()))
  return [
    ...new Set([
      ...Object.values(FLOW_BUILTIN_VARIABLES),
      ...Object.values(FLOW_FINAL_ANSWER_SECTION_VARIABLES),
      ...outputNames
    ])
  ]
}

/**
 * @description 校验画布能否构成可运行的流程包：非空、入口存在、出边条件无歧义。
 * @param nodes 画布节点。
 * @param edges 画布边。
 * @param entry 入口节点标识。
 * @returns 校验结果；不合法时携带可直接展示的原因。
 * @remarks 节点类型与边引用由画布操作保证合法；此处只兜住保存前的结构性缺口，
 *   归一化的最终终审仍在保存时执行。单聊/群聊的行为差异由流程内的人数分支表达，
 *   选人步骤的位置无法静态判定，缺失由引擎运行期报错兜底。
 */
export function validateFlow(
  nodes: StepCanvasNode[],
  edges: StepCanvasEdge[],
  entry: string | null
): { ok: true } | { ok: false; message: string } {
  if (nodes.length === 0) {
    return { ok: false, message: '画布为空：请先从左侧添加节点并连线。' }
  }
  if (!entry || !nodes.some((node) => node.id === entry)) {
    return { ok: false, message: '请先指定入口节点（入口决定流程从哪里开始执行）。' }
  }
  for (const node of nodes) {
    const outgoing = edges.filter((edge) => edge.source === node.id)
    if (node.data.step.type === 'condition') {
      // 判断节点：出边从满足/不满足两个分支 Handle 出发，各至多一条；缺变量在节点内即可见。
      const branches = outgoing.map((edge) => edge.sourceHandle)
      if (branches.filter((handle) => handle === 'true').length > 1) {
        return { ok: false, message: '判断节点的「满足」出口有多条连线：请只保留一条。' }
      }
      if (branches.filter((handle) => handle === 'false').length > 1) {
        return { ok: false, message: '判断节点的「不满足」出口有多条连线：请只保留一条。' }
      }
      if (!node.data.step.config?.variable?.trim()) {
        return {
          ok: false,
          message: '判断节点还没有选择变量：请在节点内选择判断依据的变量。'
        }
      }
      continue
    }
    if (outgoing.length > 1) {
      return {
        ok: false,
        message: `节点「${STEP_META[node.data.step.type].label}」有多条出边：只有判断节点可以分支。`
      }
    }
  }
  return { ok: true }
}
