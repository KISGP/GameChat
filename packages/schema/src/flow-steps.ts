/**
 * @description 流程步骤定义：节点池、属性面板、配置归一化与模板共用的单一事实源。
 * @remarks 本文件只描述结构与展示文案，不依赖 React 或宿主；视觉图标由编排应用按 type 映射。
 */
import type {
  FlowSelectionSource,
  FlowSelectionTieBreak,
  FlowStepConfig,
  FlowStepType
} from '@gamechat/type'
import { FLOW_STEP_TYPES } from '@gamechat/type'
import { FLOW_INTENT_TEMPLATE_VARIABLES } from './flow-prompts'

/** 步骤语义分类：决定画布节点的视觉分组。 */
export type FlowStepCategory =
  | 'model'
  | 'tool'
  | 'intent'
  | 'flow'
  | 'control'
  | 'environment'

/** 配置字段控件类型。 */
export type FlowConfigFieldKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'boolean'
  | 'select'
  | 'variable'
  | 'conditionVariable'
  | 'conditionValue'
  | 'model'
  | 'simulated-characters'

/** 单字段可见条件：当前配置值等于（或不等于）给定值时显示；notEquals 为数组时排除其中任一取值。 */
export type FlowConfigVisibility = {
  field: keyof FlowStepConfig
  equals?: string | boolean
  notEquals?: string | boolean | ReadonlyArray<string>
}

/** 流程步骤的配置字段定义。 */
export type FlowConfigFieldDefinition = {
  key: keyof FlowStepConfig
  kind: FlowConfigFieldKind
  label: string
  /** 数字字段：是否取整。 */
  integer?: boolean
  min?: number
  max?: number
  step?: number
  /** 文本字段：是否去除首尾空白。 */
  trim?: boolean
  /** 文本域行数。 */
  rows?: number
  placeholder?: string
  /** 选择字段的选项；suffix 为选项右侧的弱化标注（如符号），不参与取值。 */
  options?: ReadonlyArray<{ value: string; label: string; suffix?: string }>
  /** 模板字段可引用的上下文变量组：由引擎按步骤上下文提供取值，编排界面据此生成插入菜单与高亮。 */
  variables?: { label: string; items: ReadonlyArray<{ name: string; description: string }> }
  /** 未配置时属性面板展示的默认值；不写入流程包。 */
  defaultValue?: string | number | boolean
  /** 可见条件；不满足时属性面板隐藏该字段。 */
  visibleWhen?: FlowConfigVisibility
}

/** 流程步骤定义。 */
export type FlowStepDefinition = {
  type: FlowStepType
  label: string
  category: FlowStepCategory
  hint: string
  description: string
  configFields: readonly FlowConfigFieldDefinition[]
}

/** 选人来源选项。 */
const SELECTION_SOURCE_OPTIONS: ReadonlyArray<{
  value: FlowSelectionSource
  label: string
}> = [
  { value: 'mentioned', label: 'mentioned：按用户点名顺序' },
  { value: 'intent', label: 'intent：并行评分取最高' },
  { value: 'first', label: 'first：按参与者顺序' },
  { value: 'random', label: 'random：随机挑一位' }
]

/** 意愿评分并列规则选项。 */
const TIE_BREAK_OPTIONS: ReadonlyArray<{
  value: FlowSelectionTieBreak
  label: string
}> = [
  { value: 'random', label: '随机' },
  { value: 'first', label: '取参与者顺序第一个' }
]

/** 意愿评估模板的上下文变量组：被评估角色的名字与人格，由引擎逐角色提供取值。 */
const INTENT_VARIABLE_GROUP = {
  label: '评分变量',
  items: [
    {
      name: FLOW_INTENT_TEMPLATE_VARIABLES.name,
      description: '被评估角色的显示名'
    },
    {
      name: FLOW_INTENT_TEMPLATE_VARIABLES.characterPrompt,
      description: '被评估角色的 prompt 原文'
    }
  ]
} as const

/** 流程步骤定义清单。 */
export const FLOW_STEP_DEFINITIONS: Record<FlowStepType, FlowStepDefinition> = {
  selectSpeaker: {
    type: 'selectSpeaker',
    label: '选择发言者',
    category: 'intent',
    hint: '按点名/意愿/顺序/随机选出下一位',
    description:
      '群聊专用：按 source 选出下一位发言者并写入内置变量 next_speaker：mentioned 按用户 @ 点名顺序；intent 并行评分后取最高分；first 按参与者顺序；random 随机挑一位。未命中时 next_speaker 为空，出边据此结束或分流。单聊由引擎自动选择唯一参与者，不需要本步骤。',
    configFields: [
      {
        key: 'source',
        kind: 'select',
        label: '选人来源',
        options: SELECTION_SOURCE_OPTIONS,
        defaultValue: 'first'
      },
      {
        key: 'threshold',
        kind: 'number',
        label: '意愿阈值（0~100，缺省 60）',
        integer: true,
        min: 0,
        max: 100,
        visibleWhen: { field: 'source', equals: 'intent' }
      },
      {
        key: 'tieBreak',
        kind: 'select',
        label: '最高分并列时',
        options: TIE_BREAK_OPTIONS,
        defaultValue: 'random',
        visibleWhen: { field: 'source', equals: 'intent' }
      },
      {
        key: 'systemPromptTemplate',
        kind: 'textarea',
        label: '意愿评分提示词',
        rows: 4,
        placeholder: '意愿评分指令，运行期必须已填写；{{name}} 与 {{character_prompt}} 指被评估角色。',
        variables: INTENT_VARIABLE_GROUP,
        visibleWhen: { field: 'source', equals: 'intent' }
      }
    ]
  },
  condition: {
    type: 'condition',
    label: '判断',
    category: 'flow',
    hint: '条件成立与否决定走哪条分支',
    description:
      '对指定变量求值一次比较：成立走「成立」出口，不成立走「不成立」出口。出口至少连一条，未连线的分支视为流程到此结束；布尔变量（has_tools、tools_executed 等）本身就是条件，只需选择变量、无需比较方式与比较值。',
    configFields: [
      {
        key: 'variable',
        kind: 'conditionVariable',
        label: '变量'
      },
      {
        key: 'op',
        kind: 'select',
        label: '比较方式',
        options: [
          { value: 'equals', label: '等于', suffix: '=' },
          { value: 'contains', label: '包含', suffix: '⊃' },
          { value: 'gt', label: '大于', suffix: '>' },
          { value: 'lt', label: '小于', suffix: '<' },
          { value: 'notEmpty', label: '非空', suffix: '≠∅' },
          { value: 'empty', label: '为空', suffix: '∅' }
        ],
        defaultValue: 'equals'
      },
      {
        key: 'value',
        kind: 'conditionValue',
        label: '比较值',
        visibleWhen: { field: 'op', notEquals: ['notEmpty', 'empty'] }
      }
    ]
  },
  route: {
    type: 'route',
    label: '工具路由',
    category: 'model',
    hint: '让模型从应用已启用的工具中选择',
    description:
      '使用应用当前启用的工具做一次路由调用，模型自行决定是否调用以及调用哪个工具；工具启用范围与轮次上限都由应用侧策略决定，流程不再收窄。模型发起工具调用时内置变量 pending_tool_calls 变为 true。路由阶段不流式输出，也不携带角色人格。',
    configFields: [
      {
        key: 'systemPromptTemplate',
        kind: 'textarea',
        label: '路由提示词',
        rows: 4
      },
    ]
  },
  executeTools: {
    type: 'executeTools',
    label: '执行工具',
    category: 'tool',
    hint: '执行路由步骤发起的工具调用',
    description:
      '执行路由步骤发起的全部待处理工具调用。应用当前启用的工具全部可用，流程不再挑选或收窄工具；结果进入工具轨迹，供整理要点与终答引用。工具真实执行并可能产生外部副作用。',
    configFields: []
  },
  finalAnswer: {
    type: 'finalAnswer',
    label: '角色回复',
    category: 'model',
    hint: '以角色人格流式生成最终回复',
    description:
      '以角色人格与全部上下文注入流式生成最终回复；自定义 system 模板可引用终答 section 变量。流程未到达本步骤或没有产出草稿时，提交步骤会失败。',
    configFields: [
      {
        key: 'systemPromptTemplate',
        kind: 'textarea',
        label: '终答提示词（支持 {{变量}} 插值）',
        rows: 7
      }
    ]
  },
  llm: {
    type: 'llm',
    label: '模型调用',
    category: 'model',
    hint: '自由模板调用模型，输出可存为变量',
    description:
      '以当前生效模型执行一次调用：system/user 模板支持 {{变量}} 插值；未填 user 模板时延续会话上下文。交换记录会进入后续模型调用可见的对话流。',
    configFields: [
      {
        key: 'systemPromptTemplate',
        kind: 'textarea',
        label: 'system 模板（支持 {{变量}} 插值）',
        rows: 6,
        placeholder: '你是一个……；可用变量：{{last_user}}、{{character_name}}…'
      },
      {
        key: 'userTemplate',
        kind: 'textarea',
        label: 'user 模板（留空 = 延续会话上下文）',
        rows: 5,
        placeholder: '填写后只发送本模板（纯模板单轮）；留空时把当前对话整体发给模型。'
      },
      {
        key: 'outputVariable',
        kind: 'variable',
        label: '输出存为变量（供后继步骤与出边条件引用）',
        placeholder: '留空不保存，例：draft'
      },
    ]
  },
  intent: {
    type: 'intent',
    label: '发言意愿',
    category: 'intent',
    hint: '给当前输入打 0~100 分',
    description:
      '以角色人格评估当前输入的发言意愿并输出 0~100 分，结果写入输出变量，供出边条件分支。',
    configFields: [
      {
        key: 'systemPromptTemplate',
        kind: 'textarea',
        label: 'system 模板（支持 {{变量}} 插值）',
        rows: 6,
        placeholder: '你是一个……；可用变量：{{last_user}}、{{name}}、{{character_prompt}}…',
        variables: INTENT_VARIABLE_GROUP
      },
      {
        key: 'userTemplate',
        kind: 'textarea',
        label: 'user 模板（留空 = 只发当前输入）',
        rows: 5,
        placeholder: '填写后只发送本模板（纯模板单轮）；留空时只发送当前输入文本。',
        variables: INTENT_VARIABLE_GROUP
      },
      {
        key: 'outputVariable',
        kind: 'variable',
        label: '输出存为变量（供后继步骤与出边条件引用）',
        placeholder: '留空不保存，例：draft'
      },
    ]
  },
  display: {
    type: 'display',
    label: '预览',
    category: 'control',
    hint: '预览上游节点产出',
    description:
      '纯展示节点：串在连线中间，真实运行时直接穿过、不改变流程状态。调试运行时按上游节点自动预览内容——模型调用/发言意愿显示文本产出，执行工具显示回传路由的轨迹文本，角色回复显示回复文本。',
    configFields: []
  },
  environmentInput: {
    type: 'environmentInput',
    label: '外部输入',
    category: 'environment',
    hint: '用户消息与模拟角色提示词',
    description:
      '外部输入节点：一个节点承载本次运行的全部外部环境输入（用户消息与模拟角色提示词）。真实聊天中这些输入来自会话与角色配置，本步骤不改变流程状态。',
    configFields: [
      {
        key: 'inputText',
        kind: 'textarea',
        label: '用户消息',
        rows: 3,
        placeholder: '输入一条消息…'
      },
      {
        key: 'modelId',
        kind: 'model',
        label: '模型'
      },
      {
        key: 'simulatedCharacters',
        kind: 'simulated-characters',
        label: '模拟角色'
      }
    ]
  }
}

/** 步骤池展示顺序。 */
export const FLOW_STEP_ORDER: readonly FlowStepType[] = FLOW_STEP_TYPES
