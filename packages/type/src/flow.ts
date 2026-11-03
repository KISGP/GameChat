import type { ContextUsage } from './chat'
import type { AgentToolPackageId } from './contract-ids'

/** 内置标准流程的保留标识：一份通用标准流程，单聊与群聊由流程内的人数分支表达。 */
export const FLOW_STANDARD_ID = 'standard'

/** 流程步骤类型全集：流程引擎在主进程可执行的全部步骤种类。 */
export const FLOW_STEP_TYPES = [
  'selectSpeaker',
  'condition',
  'llm',
  'route',
  'executeTools',
  'finalAnswer',
  'intent',
  'display',
  'environmentInput'
] as const

/** 流程步骤类型联合。 */
export type FlowStepType = (typeof FLOW_STEP_TYPES)[number]

/** 编排控制步骤：运行时不改变流程状态（外部输入承载运行参数，预览节点承载调试观察）。 */
export const FLOW_CONTROL_STEP_TYPES = ['environmentInput', 'display'] as const

/** 编排控制步骤类型联合。 */
export type FlowControlStepType = (typeof FLOW_CONTROL_STEP_TYPES)[number]

/** 选人来源：群聊按点名、意愿或参与者顺序。 */
export type FlowSelectionSource = 'mentioned' | 'intent' | 'first' | 'random'

/** 意愿评分同分时的取舍方式。 */
export type FlowSelectionTieBreak = 'random' | 'first'

/** 连线端点在节点上的出/入侧；只影响画布走线，运行时不读取。 */
export const FLOW_EDGE_SIDES = ['left', 'right', 'top', 'bottom'] as const

/** 连线端点侧别联合。 */
export type FlowEdgeSide = (typeof FLOW_EDGE_SIDES)[number]

/**
 * @description 流程出边激活条件的比较操作符清单。
 * @remarks 求值语义见 @gamechat/schema 的 `matchConditionValue`；新增取值时同步扩展该 switch。
 */
export const FLOW_CONDITION_OPS = ['equals', 'contains', 'gt', 'lt', 'notEmpty', 'empty'] as const

/** 流程出边条件的比较操作符联合。 */
export type FlowConditionOp = (typeof FLOW_CONDITION_OPS)[number]

/**
 * @description 判断节点的比较条件；也作为比较操作符求值的数据形状。
 * @remarks 求值语义见 @gamechat/schema 的 `matchConditionValue`；新增取值时同步扩展该 switch。
 */
export type FlowCondition = {
  variable: string
  op?: FlowConditionOp
  value?: string
}

/** 判断节点的分支取值：条件满足走 true 分支，不满足走 false 分支。 */
export const FLOW_BRANCH_VALUES = ['true', 'false'] as const

/** 判断节点分支联合。 */
export type FlowBranchValue = (typeof FLOW_BRANCH_VALUES)[number]

/** 外部输入节点中的模拟角色：只记录提示词与可选的已有角色来源。 */
export type FlowSimulatedCharacter = {
  /** 角色的提示词。 */
  prompt?: string
  /** 填充提示词时使用的已有角色标识，只用于读取头像、表情与记忆。 */
  sourceCharacterId?: string
}

/**
 * @description 流程步骤配置：按步骤类型只保留相关字段，未消费字段在归一化时丢弃。
 * @remarks 字段归属见 @gamechat/schema 的 `normalizeFlowStepConfig`；模型参数不进入流程配置。
 */
export type FlowStepConfig = {
  /** selectSpeaker/llm/route/finalAnswer/intent：system 模板，支持 {{变量}} 插值。 */
  systemPromptTemplate?: string
  /** llm/intent：user 模板；非空时以插值后的单条消息替代会话上下文。 */
  userTemplate?: string
  /** llm/intent：步骤文本产出的落点变量名，禁止与内置变量同名。 */
  outputVariable?: string
  /** condition：判断依据的变量名。 */
  variable?: string
  /** condition：比较操作符。 */
  op?: FlowConditionOp
  /** condition：比较值；notEmpty/empty 比较不消费。 */
  value?: string
  /** selectSpeaker：选人来源；单聊标准流程使用 sole。 */
  source?: FlowSelectionSource
  /** selectSpeaker：意愿评分阈值（0~100）。 */
  threshold?: number
  /** selectSpeaker：最高分并列时的取舍方式。 */
  tieBreak?: FlowSelectionTieBreak
  /** environmentInput：本次运行的用户消息。 */
  inputText?: string
  /** environmentInput：本次运行使用的模型条目标识。 */
  modelId?: string
  /** environmentInput：本次运行使用的模拟角色清单。 */
  simulatedCharacters?: FlowSimulatedCharacter[]
}

export type FlowNode = {
  id: string
  type: FlowStepType
  config?: FlowStepConfig
}

export type FlowEdge = {
  from: string
  to: string
  /** 判断节点的分支标记：出边来自判断节点时必填，其他节点出边禁止携带。 */
  branch?: FlowBranchValue
  /** 出线侧；缺省时画布按节点相对位置补算一次。 */
  fromSide?: FlowEdgeSide
  /** 入线侧；缺省时画布按节点相对位置补算一次。 */
  toSide?: FlowEdgeSide
}

/** 流程包内记录的单节点画布摆位：坐标必填，尺寸为用户调整后的可选值。 */
export type FlowNodeLayout = {
  x: number
  y: number
  width?: number
  height?: number
}

export type FlowGraph = {
  entry: string
  nodes: FlowNode[]
  edges: FlowEdge[]
  /** 画布摆位：按节点 ID 记录坐标与可选尺寸；运行时不读取，仅供编排画布恢复用户的摆放。 */
  layout?: Record<string, FlowNodeLayout>
}

/** 声明式流程包：可导入导出的纯数据定义；连线端点侧别与画布摆位是其中的画布外观字段，运行时不读取。 */
export type FlowPackage = {
  id: string
  name: string
  graph: FlowGraph
}

/** 流程设置分区：当前生效的通用流程标识。 */
export type FlowSettingsStore = {
  currentFlowId: string
}

/** 流程包摘要：列表展示用的最小信息。 */
export type FlowPackageSummary = {
  id: string
  name: string
}

/** 流程包导出结果：用户取消时 canceled 为 true 且 path 为 null。 */
export type FlowExportResult = {
  canceled: boolean
  path: string | null
}

/** 打开编排窗口的请求：可选的流程标识；缺省打开当前流程。 */
export type FlowEditorOpenRequest = {
  flowId?: string
}

/** 调试工具轨迹：节点列表展示摘要，弹窗展示完整输出。 */
export type FlowDebugToolTrace = {
  characterId: string
  round: number
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
  outputSummary: string
  /** 完整工具输出：结构随工具返回值，详情弹窗展示用；未产出时缺省。 */
  output?: unknown
  status: 'completed' | 'failed' | 'rejected'
}

/** 编排窗口展示的可用工具条目：工具所属包、名称与描述。 */
export type FlowToolCatalogEntry = {
  packageId: AgentToolPackageId
  name: string
  description: string
}

/** 调试运行使用的模拟角色：提示词由编排方提供，来源角色只用于读取本地资源。 */
export type FlowDebugCharacter = {
  /** 本次运行内的角色标识，需在同一请求内唯一。 */
  id: string
  /** 展示名；留空时画布按序号显示为「角色 N」。 */
  name: string
  /** 该角色在本次运行中使用的提示词。 */
  prompt: string
  /** 填充提示词时使用的已有角色标识；只用于头像、表情与记忆，不覆盖提示词。 */
  sourceCharacterId?: string
}

/** 调试启动请求。 */
export type FlowDebugStartRequest = {
  requestId: string
  flow: FlowPackage
  /** 本次运行使用的模拟角色；1 个按单聊运行，2 个以上按群聊运行。 */
  characters: FlowDebugCharacter[]
  input: string
  /** 调试使用的模型条目标识。 */
  modelId: string
}

/** 调试运行终态。 */
export type FlowDebugResult = {
  requestId: string
  status: 'completed' | 'aborted' | 'error'
  /** 失败时的可展示错误文本。 */
  errorMessage?: string
}

/** 节点原始模型交换：请求消息序列与模型响应，供编排调试查看未加工内容。 */
export type FlowNodeRawExchange = {
  /** 发送给模型的输入消息序列（角色名 + 文本内容）。 */
  messages: Array<{ role: string; content: string }>
  /** 模型响应的文本内容；无文本时为空串。 */
  content: string
  /** 模型响应中的工具调用清单；未发起调用时为空数组。 */
  toolCalls: Array<{ name: string; args: unknown }>
}

/** 调试运行事件：流式输出、工具调用、节点路径、流程变量与用量；全部变体携带 requestId 供渲染层过滤。 */
export type FlowDebugEvent =
  | { type: 'run-started'; requestId: string }
  | { type: 'turn-started'; requestId: string; characterId: string; characterName: string }
  | { type: 'turn-committed'; requestId: string; characterId: string }
  | { type: 'token'; requestId: string; characterId: string; text: string }
  | { type: 'tool-trace'; requestId: string; trace: FlowDebugToolTrace }
  | {
      type: 'image-analysis'
      requestId: string
      characterId: string
      resourceId: string
      analysis: string
    }
  | {
      type: 'character-state'
      requestId: string
      characterId: string
      state: 'evaluating' | 'replying' | 'failed' | 'idle'
    }
  | { type: 'node-enter'; requestId: string; nodeId: string; nodeType: FlowStepType }
  | { type: 'node-exit'; requestId: string; nodeId: string }
  | {
      type: 'node-output'
      requestId: string
      nodeId: string
      text: string
      /** 原始模型交换；非模型步骤或不产出时缺省。 */
      raw?: FlowNodeRawExchange
    }
  | { type: 'variables'; requestId: string; variables: Record<string, string> }
  | {
      type: 'context-usage'
      requestId: string
      characterId: string
      usage: ContextUsage
    }
  | { type: 'run-finished'; requestId: string; result: FlowDebugResult }
