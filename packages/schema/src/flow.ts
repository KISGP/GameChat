/**
 * @description 流程包的归一化与校验纯函数：导入落盘与引擎装载共用的单实现。
 * @remarks 不做版本控制：结构合法即收，格式演进依赖本函数的逐项容错；
 *   分支走向由判断节点承载，边级条件模型已移除——携带 condition 的旧流程整体拒绝。
 */
import type {
  FlowBranchValue,
  FlowEdge,
  FlowGraph,
  FlowNode,
  FlowNodeLayout,
  FlowPackage,
  FlowSettingsStore,
  FlowStepConfig,
  FlowStepType
} from '@gamechat/type'
import {
  FLOW_BRANCH_VALUES,
  FLOW_EDGE_SIDES,
  FLOW_STANDARD_ID,
  FLOW_STEP_TYPES
} from '@gamechat/type'
import { FLOW_INTENT_TEMPLATE_VARIABLES } from './flow-prompts'
import { FLOW_STEP_DEFINITIONS } from './flow-steps'

/** 流程内置变量名：引擎在出边求值时注入的只读变量，画布侧变量下拉同源引用。 */
export const FLOW_BUILTIN_VARIABLES = {
  /** 当前策略、实时图片或表情清单是否命中工具循环入口条件。 */
  hasTools: 'has_tools',
  /** 路由步骤是否产出待执行工具调用。 */
  pendingToolCalls: 'pending_tool_calls',
  /** 本回合是否执行过工具调用（true/false）。 */
  toolsExecuted: 'tools_executed',
  /** 本回合工具轨迹原文（调用参数与返回结果，按工具轨迹预算截断）。 */
  toolTrace: 'tool_trace',
  /** 工具轮数耗尽标记。 */
  incomplete: 'incomplete',
  /** 当前发言角色显示名。 */
  characterName: 'character_name',
  /** 当前会话参与者数量。 */
  participantCount: 'participant_count',
  /** 本次选人产出的下一位发言角色 ID。 */
  nextSpeaker: 'next_speaker',
  /** 本次选人的来源（sole/mentioned/intent/first）。 */
  selectionSource: 'selection_source',
  /** 本轮已经发言过的参与者数量。 */
  spokenCount: 'spoken_count',
  /** 上一位发言角色 ID。 */
  lastSpeaker: 'last_speaker'
} as const

/** 终答模板可引用的 section 变量：由回合装配产物直接提供。 */
export const FLOW_FINAL_ANSWER_SECTION_VARIABLES = {
  /** 角色 prompt 原文。 */
  characterPrompt: 'character_prompt',
  /** 滚动摘要段文本。 */
  historySummary: 'history_summary',
  /** 会话状态卡段文本。 */
  stateCard: 'state_card',
  /** 角色长期记忆段文本。 */
  memory: 'memory',
  /** 历史省略说明段文本。 */
  historyOmitted: 'history_omitted',
  /** 本回合是否携带实时图片（true/false）。 */
  hasRealtimeImages: 'has_realtime_images',
  /** 工具轮次是否耗尽（true/false）。 */
  incomplete: 'incomplete',
  /** 末位用户输入文本。 */
  lastUser: 'last_user'
} as const

/** 内置变量的中文说明：变量名 → 一句话语义，供条件编辑器就地展示。 */
export const FLOW_BUILTIN_VARIABLE_DESCRIPTIONS: Readonly<Record<string, string>> = {  [FLOW_BUILTIN_VARIABLES.hasTools]: '当前策略、实时图片或表情清单是否命中工具循环入口条件',
  [FLOW_BUILTIN_VARIABLES.pendingToolCalls]: '路由步骤是否产出待执行的工具调用',
  [FLOW_BUILTIN_VARIABLES.toolsExecuted]: '本回合是否执行过工具调用（true/false）',
  [FLOW_BUILTIN_VARIABLES.toolTrace]: '本回合工具轨迹原文（调用参数与返回结果）',
  [FLOW_BUILTIN_VARIABLES.incomplete]: '工具轮数是否耗尽的标记',
  [FLOW_BUILTIN_VARIABLES.characterName]: '当前发言角色的显示名',
  [FLOW_BUILTIN_VARIABLES.participantCount]: '当前会话的参与者数量',
  [FLOW_BUILTIN_VARIABLES.nextSpeaker]: '本次选人产出的下一位发言角色 ID',
  [FLOW_BUILTIN_VARIABLES.selectionSource]: '本次选人的来源（sole/mentioned/intent/first）',
  [FLOW_BUILTIN_VARIABLES.spokenCount]: '本轮已经发言过的参与者数量',
  [FLOW_BUILTIN_VARIABLES.lastSpeaker]: '上一位发言角色的 ID'
}

/** 终答段变量的中文说明：变量名 → 一句话语义，供条件编辑器就地展示。 */
export const FLOW_SECTION_VARIABLE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  [FLOW_FINAL_ANSWER_SECTION_VARIABLES.characterPrompt]: '角色 prompt 原文',
  [FLOW_FINAL_ANSWER_SECTION_VARIABLES.historySummary]: '滚动摘要段文本',
  [FLOW_FINAL_ANSWER_SECTION_VARIABLES.stateCard]: '会话状态卡段文本',
  [FLOW_FINAL_ANSWER_SECTION_VARIABLES.memory]: '角色长期记忆段文本',
  [FLOW_FINAL_ANSWER_SECTION_VARIABLES.historyOmitted]: '历史省略说明段文本',
  [FLOW_FINAL_ANSWER_SECTION_VARIABLES.hasRealtimeImages]: '本回合是否携带实时图片（true/false）',
  [FLOW_FINAL_ANSWER_SECTION_VARIABLES.incomplete]: '工具轮次是否耗尽（true/false）',
  [FLOW_FINAL_ANSWER_SECTION_VARIABLES.lastUser]: '末位用户输入文本'
}

/** 取值只有 true/false 的内置与终答段变量：判断节点的比较值对这些变量渲染为满足/不满足选择。 */
export const FLOW_BOOLEAN_VARIABLES: readonly string[] = [
  FLOW_BUILTIN_VARIABLES.hasTools,
  FLOW_BUILTIN_VARIABLES.pendingToolCalls,
  FLOW_BUILTIN_VARIABLES.toolsExecuted,
  FLOW_BUILTIN_VARIABLES.incomplete,
  FLOW_FINAL_ANSWER_SECTION_VARIABLES.hasRealtimeImages,
  FLOW_FINAL_ANSWER_SECTION_VARIABLES.incomplete
]

/** 变量名允许的字符集：字母数字、下划线、连字符与汉字。 */
const OUTPUT_VARIABLE_PATTERN = /^[\w\u4e00-\u9fff-]+$/u

/** 流程变量禁止占用的名称：运行时变量、终答 section 变量与意愿模板变量。 */
const RESERVED_VARIABLE_NAMES = new Set<string>([
  ...Object.values(FLOW_BUILTIN_VARIABLES),
  ...Object.values(FLOW_FINAL_ANSWER_SECTION_VARIABLES),
  ...Object.values(FLOW_INTENT_TEMPLATE_VARIABLES)
])

/**
 * @description 创建流程设置分区的默认值：使用内置通用标准流程。
 * @returns 可安全写入统一设置文件的默认分区。
 */
export function createDefaultFlowSettingsStore(): FlowSettingsStore {
  return { currentFlowId: FLOW_STANDARD_ID }
}

/**
 * @description 规范化持久化的流程设置分区。
 * @param value 未受信任的持久化分区。
 * @returns 可安全使用的分区；流程标识非法时回退标准流程。
 * @remarks 旧的双标识（currentSingleFlowId/currentGroupFlowId）配置按缺失处理，不迁移。
 */
export function normalizeFlowSettingsStore(value: unknown): FlowSettingsStore {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  const candidate = raw?.currentFlowId
  return {
    currentFlowId:
      typeof candidate === 'string' && candidate.trim() ? candidate.trim() : FLOW_STANDARD_ID
  }
}

/**
 * @description 规范化不受信任的流程包原始数据。
 * @param value 从文件或导入通道读取的原始数据。
 * @returns 结构合法的流程包；缺 id、断边、缺 entry 等结构性错误返回 null。
 * @remarks 步骤配置逐项容错：非法字段丢弃而非整体拒绝；id 的文件名安全性由存储层校验。
 *   旧的双包（含 kind 字段）数据不兼容，读取即拒绝。
 */
export function normalizeFlowPackage(value: unknown): FlowPackage | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const raw = value as Record<string, unknown>
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!id) {
    return null
  }
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id
  const graph = normalizeFlowGraph(raw.graph)
  if (!graph) {
    return null
  }
  return { id, name, graph }
}

/**
 * @description 规范化流程图结构。
 * @param value 未受信任的图数据。
 * @returns 结构合法的图；节点为空、entry 不存在、边引用未知节点或单节点出现多条无条件出边时返回 null。
 */
function normalizeFlowGraph(value: unknown): FlowGraph | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const raw = value as Record<string, unknown>
  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : []
  const nodes: FlowNode[] = []
  const nodeIds = new Set<string>()
  for (const item of rawNodes) {
    const node = normalizeFlowNode(item)
    if (!node || nodeIds.has(node.id)) {
      return null
    }
    nodeIds.add(node.id)
    nodes.push(node)
  }
  if (nodes.length === 0) {
    return null
  }
  const rawEdges = Array.isArray(raw.edges) ? raw.edges : []
  const edges: FlowEdge[] = []
  for (const item of rawEdges) {
    const edge = normalizeFlowEdge(item)
    if (!edge || !nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      return null
    }
    edges.push(edge)
  }
  const entry = typeof raw.entry === 'string' ? raw.entry : ''
  if (!nodeIds.has(entry)) {
    return null
  }
  for (const node of nodes) {
    const outgoing = edges.filter((edge) => edge.from === node.id)
    if (node.type === 'condition') {
      // 判断节点：出边必须全部带互不重复的分支标记，至少一条；不带分支的出边非法。
      if (outgoing.length === 0) {
        return null
      }
      const branches = new Set<FlowBranchValue>()
      for (const edge of outgoing) {
        if (!edge.branch || branches.has(edge.branch)) {
          return null
        }
        branches.add(edge.branch)
      }
      continue
    }
    if (outgoing.some((edge) => edge.branch)) {
      return null
    }
    if (outgoing.length > 1) {
      return null
    }
  }
  // 判断节点的变量必须配置：空变量在运行时无法求值，属结构性缺失。
  for (const node of nodes) {
    if (node.type === 'condition' && !node.config?.variable?.trim()) {
      return null
    }
  }
  const layout = normalizeFlowLayout(raw.layout, nodeIds)
  return { entry, nodes, edges, ...(layout ? { layout } : {}) }
}

/**
 * @description 归一化画布摆位记录：仅保留已知节点上的合法坐标条目。
 * @param value 流程包携带的 layout 原始数据。
 * @param nodeIds 归一化后存在的节点 ID 集合。
 * @returns 合法的摆位映射；缺失或全部非法时为 null。
 * @remarks 摆位是画布外观字段，非法条目逐项丢弃并回落自动布局，不影响流程结构合法性。
 */
function normalizeFlowLayout(
  value: unknown,
  nodeIds: Set<string>
): Record<string, FlowNodeLayout> | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const layout: Record<string, FlowNodeLayout> = {}
  for (const [id, item] of Object.entries(value as Record<string, unknown>)) {
    if (!nodeIds.has(id) || !item || typeof item !== 'object') {
      continue
    }
    const raw = item as Record<string, unknown>
    if (
      typeof raw.x !== 'number' ||
      !Number.isFinite(raw.x) ||
      typeof raw.y !== 'number' ||
      !Number.isFinite(raw.y)
    ) {
      continue
    }
    layout[id] = {
      x: raw.x,
      y: raw.y,
      ...(typeof raw.width === 'number' && Number.isFinite(raw.width) && raw.width > 0
        ? { width: raw.width }
        : {}),
      ...(typeof raw.height === 'number' && Number.isFinite(raw.height) && raw.height > 0
        ? { height: raw.height }
        : {})
    }
  }
  return Object.keys(layout).length > 0 ? layout : null
}

/**
 * @description 规范化单个流程节点。
 * @param value 未受信任的节点数据。
 * @returns 合法节点；id 为空或步骤类型不在白名单时返回 null。
 */
function normalizeFlowNode(value: unknown): FlowNode | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const raw = value as Record<string, unknown>
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const type = raw.type
  if (!id || typeof type !== 'string' || !FLOW_STEP_TYPES.includes(type as FlowStepType)) {
    return null
  }
  const stepType = type as FlowStepType
  return { id, type: stepType, config: normalizeFlowStepConfig(raw.config, stepType) }
}

/**
 * @description 按步骤类型规范化配置：只保留该步骤消费的字段。
 * @param value 未受信任的配置数据。
 * @param type 步骤类型。
 * @returns 规范化后的配置，非法字段以缺省形式丢弃。
 */
function normalizeFlowStepConfig(value: unknown, type: FlowStepType): FlowStepConfig {
  if (!value || typeof value !== 'object') {
    return {}
  }
  const raw = value as Record<string, unknown>
  const config: FlowStepConfig = {}
  const target = config as Record<string, unknown>
  for (const field of FLOW_STEP_DEFINITIONS[type].configFields) {
    const rawValue = raw[field.key]
    switch (field.kind) {
      case 'text': {
        if (typeof rawValue !== 'string') {
          break
        }
        const text = field.trim ? rawValue.trim() : rawValue
        if (text || !field.trim) {
          target[field.key] = text
        }
        break
      }
      case 'textarea': {
        if (typeof rawValue === 'string') {
          target[field.key] = rawValue
        }
        break
      }
      case 'variable': {
        const outputVariable = normalizeOutputVariable(rawValue)
        if (outputVariable) {
          target[field.key] = outputVariable
        }
        break
      }
      case 'conditionVariable': {
        // 判断依据的变量可以是内置变量等保留名，只做非空字符串校验。
        if (typeof rawValue === 'string' && rawValue.trim()) {
          target[field.key] = rawValue.trim()
        }
        break
      }
      case 'conditionValue': {
        if (typeof rawValue === 'string' && rawValue) {
          target[field.key] = rawValue
        }
        break
      }
      case 'number': {
        const clamped = field.integer
          ? clampInteger(
              rawValue,
              field.min ?? Number.NEGATIVE_INFINITY,
              field.max ?? Number.POSITIVE_INFINITY
            )
          : clampNumber(
              rawValue,
              field.min ?? Number.NEGATIVE_INFINITY,
              field.max ?? Number.POSITIVE_INFINITY
            )
        if (clamped !== null) {
          target[field.key] = clamped
        }
        break
      }
      case 'boolean': {
        if (typeof rawValue === 'boolean') {
          target[field.key] = rawValue
        }
        break
      }
      case 'select': {
        const options = (field.options ?? []).map((option) => option.value)
        const selected = normalizeEnum(rawValue, options)
        if (selected) {
          target[field.key] = selected
        }
        break
      }
      case 'model': {
        if (typeof rawValue === 'string') {
          const modelId = rawValue.trim()
          if (modelId) {
            target[field.key] = modelId
          }
        }
        break
      }
      case 'simulated-characters': {
        const list = Array.isArray(rawValue) ? rawValue.slice(0, 8) : []
        const characters = list.flatMap((item) => {
          if (!item || typeof item !== 'object') {
            return []
          }
          const record = item as Record<string, unknown>
          const prompt = typeof record.prompt === 'string' ? record.prompt : ''
          const sourceCharacterId =
            typeof record.sourceCharacterId === 'string'
              ? record.sourceCharacterId.trim()
              : ''
          if (!prompt.trim() && !sourceCharacterId) {
            return []
          }
          return [
            {
              ...(prompt ? { prompt } : {}),
              ...(sourceCharacterId ? { sourceCharacterId } : {})
            }
          ]
        })
        // 外部输入至少保留一个模拟角色槽位，避免节点落盘后变成空列表。
        target[field.key] = characters.length > 0 ? characters : [{}]
        break
      }
    }
  }
  return config
}

/**
 * @description 规范化步骤输出变量名。
 * @param value 未受信任的变量名。
 * @returns 合法且不与保留变量重名的变量名；非法时返回 null。
 */
function normalizeOutputVariable(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const name = value.trim()
  if (!name || !OUTPUT_VARIABLE_PATTERN.test(name) || RESERVED_VARIABLE_NAMES.has(name)) {
    return null
  }
  return name
}

/**
 * @description 判断一个变量名是否可作为流程输出变量。
 * @param value 待检查的变量名。
 * @returns 格式合法且不与运行时变量、终答段变量或意愿模板变量重名时返回 true。
 */
export function isValidFlowOutputVariable(value: string): boolean {
  return normalizeOutputVariable(value) !== null
}

/**
 * @description 读取枚举值。
 * @param value 未受信任的配置值。
 * @param options 允许的取值清单。
 * @returns 命中清单的值；未命中时返回 null。
 */
function normalizeEnum<T extends string>(value: unknown, options: readonly T[]): T | null {
  return typeof value === 'string' && (options as readonly string[]).includes(value)
    ? (value as T)
    : null
}

/**
 * @description 读取有限数字并收敛到给定区间。
 * @param value 未受信任的配置值。
 * @param min 区间下限。
 * @param max 区间上限。
 * @returns 区间内的数字；非有限数字返回 null。
 */
function clampNumber(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }
  return Math.min(max, Math.max(min, value))
}

/**
 * @description 读取整数并收敛到给定区间。
 * @param value 未受信任的配置值。
 * @param min 区间下限。
 * @param max 区间上限。
 * @returns 四舍五入并收敛后的整数；非有限数字返回 null。
 */
function clampInteger(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }
  return Math.min(max, Math.max(min, Math.round(value)))
}

/**
 * @description 规范化单条出边；条件缺 variable 或操作符非法时丢弃条件（视为无条件边）。
 * @param value 未受信任的边数据。
 * @returns 合法边；from/to 为空时返回 null。
 */
function normalizeFlowEdge(value: unknown): FlowEdge | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const raw = value as Record<string, unknown>
  const from = typeof raw.from === 'string' ? raw.from.trim() : ''
  const to = typeof raw.to === 'string' ? raw.to.trim() : ''
  if (!from || !to) {
    return null
  }
  // 旧的边级条件模型不再受支持：携带 condition 的流程整体拒绝，不做迁移。
  if (raw.condition !== undefined) {
    return null
  }
  const branch = normalizeEnum(raw.branch, FLOW_BRANCH_VALUES)
  const fromSide = normalizeEnum(raw.fromSide, FLOW_EDGE_SIDES)
  const toSide = normalizeEnum(raw.toSide, FLOW_EDGE_SIDES)
  return {
    from,
    to,
    ...(branch ? { branch } : {}),
    ...(fromSide ? { fromSide } : {}),
    ...(toSide ? { toSide } : {})
  }
}
