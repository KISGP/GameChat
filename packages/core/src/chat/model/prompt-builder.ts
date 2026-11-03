import {
  FLOW_PROMPT_MESSAGE_FORMAT,
  FLOW_PROMPT_NATURAL_LANGUAGE_STYLE,
  type ChatEmoticonImage
} from '@gamechat/schema'
import { formatChatEmoticonMarker } from './emoticon-marker'

/**
 * @description 提示词拼装的单段内容。
 * @remarks 模型消息以 joinPromptSections 拼接。
 */
export type PromptSection = {
  /** 段文本，即最终发送给模型的内容片段。 */
  text: string
}

/** @description 工具路由阶段 system 提示词的拼装输入。 */
export type RoutingPromptInput = {
  /** 路由基座提示词，由流程路由步骤提供；派发侧已保证非空。 */
  basePrompt: string
  /** 启用工具包的路由规则段。 */
  packagePrompts: ReadonlyArray<{ text: string }>
  /** 当前发言角色显示名。 */
  characterName: string
}

/** @description 终答阶段 system 提示词的拼装输入。 */
export type FinalPromptInput = {
  /** 角色 prompt（prompt.md）原文。 */
  persona: string
  /** 当前角色可发送的表情清单。 */
  characterEmoticons: ReadonlyArray<ChatEmoticonImage>
  /** 是否群聊回合。 */
  isGroup: boolean
  /** 当前发言角色显示名。 */
  characterName: string
  /** 本回合路由消息中是否存在工具结果。 */
  hasToolEvidence: boolean
  /** 工具调用预算是否已耗尽。 */
  incomplete: boolean
  /** 本回合是否携带实时图片。 */
  hasRealtimeImages: boolean
}

/** @description 工具证据规则：仅在路由消息中存在工具结果时追加。 */
const TOOL_EVIDENCE_INSTRUCTION = `工具证据规则：
- 涉及剧情或世界观等原作事实时，以工具返回的核实结果为唯一依据，不要用模型记忆补充或改写。
- 工具结果未覆盖的具体事实，不要编造或猜测；证据不足时，明确说明资料不足。`

/** @description 工具调用预算耗尽时的终答提示。 */
const TOOL_BUDGET_EXHAUSTED_INSTRUCTION =
  '工具调用预算已耗尽。请基于已有工具结果回答；若证据不足，请明确说明查询未完成。'

/** @description 图片输入轮次的结构化回复协议说明；嗅探条件必须与其下发条件保持一致。 */
export const STRUCTURED_REPLY_INSTRUCTION =
  '包含新图片的请求必须返回严格 JSON：含 answer 字符串字段与可选的 imageAnalyses 数组；imageAnalyses 每项必须包含 resourceId 与一段融合后的 analysis。'

/**
 * @description 将提示词段拼装为最终发送给模型的 system 文本。
 * @param sections 拼装得到的段数组。
 * @returns 以空行分隔、不含段标签的纯文本。
 * @remarks 空段与前后空白会被剔除。
 */
export function joinPromptSections(sections: readonly PromptSection[]): string {
  return sections
    .map((section) => section.text.trim())
    .filter(Boolean)
    .join('\n\n')
}

/**
 * @description 拼装工具路由阶段的 system 提示词段。
 * @param input 路由拼装输入。
 * @returns 相位基座、启用包路由段与角色上下文段。
 * @remarks 路由阶段不携带角色人格；工具专属路由知识全部由各工具包自带，本函数不维护任何包文案。
 */
export function buildRoutingSystemPrompt(input: RoutingPromptInput): PromptSection[] {
  const sections: PromptSection[] = [{ text: input.basePrompt }]
  for (const item of input.packagePrompts) {
    if (item.text.trim()) {
      sections.push({ text: item.text })
    }
  }
  sections.push({ text: `当前角色：${input.characterName}。` })
  return sections
}

/**
 * @description 拼装终答阶段唯一的 system 提示词段。
 * @param input 终答拼装输入。
 * @returns 人格基底（角色人格、语言风格、气泡格式、表情规则）与条件段（群聊身份、工具证据、预算提示、JSON 协议）。
 * @remarks 条件段的触发参数由调用方传入；表情段只列出可用表情。
 */
export function buildFinalSystemPrompt(input: FinalPromptInput): PromptSection[] {
  return [
    { text: input.persona.trim() },
    { text: FLOW_PROMPT_NATURAL_LANGUAGE_STYLE },
    { text: FLOW_PROMPT_MESSAGE_FORMAT },
    ...buildFinalAnswerRuntimeSections(input)
  ]
}

/**
 * @description 构造终答提示词中的运行时规则段：表情、群聊身份、工具证据、预算与结构化协议。
 * @param input 终答拼装输入；`persona` 不参与本函数。
 * @returns 按触发条件筛选后的规则段。
 * @remarks 自定义终答提示词同样追加这些段，保证模板只负责人格与表达规则，运行时约束始终生效。
 *   表情规则仅在角色拥有可用表情时拼装：无表情的角色没有可输出的表情选项，
 *   常驻禁令只会浪费 token；历史中的表情标记靠其自带描述即可被理解为对话记录。
 */
export function buildFinalAnswerRuntimeSections(input: FinalPromptInput): PromptSection[] {
  const sections: PromptSection[] = []
  if (input.characterEmoticons.some((item) => !item.unavailable)) {
    sections.push({ text: buildEmoticonInstructionText(input.characterEmoticons) })
  }
  if (input.isGroup) {
    sections.push({ text: buildGroupTurnInstructionText(input.characterName) })
  }
  if (input.hasToolEvidence) {
    sections.push({ text: TOOL_EVIDENCE_INSTRUCTION })
  }
  if (input.incomplete) {
    sections.push({ text: TOOL_BUDGET_EXHAUSTED_INSTRUCTION })
  }
  if (input.hasRealtimeImages) {
    sections.push({ text: STRUCTURED_REPLY_INSTRUCTION })
  }
  return sections
}

/**
 * @description 构造终答阶段的表情使用规则及当前角色表情清单。
 * @param characterEmoticons 当前角色可发送的表情清单。
 * @returns 表情协议说明文本；角色没有可用表情时只保留输出禁令。
 * @remarks 用户表情不向角色下发可选清单：历史中的表情标记自带描述，模型按标记与描述即可理解对话；
 *   历史标记属于已发生的对话记录，不构成角色可用的输出选项。
 */
function buildEmoticonInstructionText(
  characterEmoticons: ReadonlyArray<ChatEmoticonImage>
): string {
  const characterList = formatEmoticonCatalogLines(
    characterEmoticons.filter((item) => !item.unavailable)
  )
  return `表情使用规则：
- 仅当当前角色确实拥有该 ID 时，才单独输出 [emoticon:id]。
- 单独成行的表情标记会成为一条独立消息；嵌在文本中的标记会被移除。
- 表情用于补充文字，不能代替有用的文字回复。
- 历史中出现的表情标记（含用户发送的）只是对话记录，不是你可以输出的选项。
当前角色表情：
${characterList}`
}

/**
 * @description 将表情目录渲染为统一的清单行。
 * @param catalog 表情条目（id + 描述）。
 * @returns 换行分隔的 `- [emoticon:id]：描述` 清单；空目录返回空文本。
 */
function formatEmoticonCatalogLines(
  catalog: ReadonlyArray<{ id: string; description: string }>
): string {
  return catalog
    .map((item) => `- ${formatChatEmoticonMarker(item.id)}：${item.description}`)
    .join('\n')
}

/**
 * @description 构造群聊正式回复的角色约束说明。
 * @param characterName 当前发言角色显示名。
 * @returns 追加在角色人格之后的群聊规则文本。
 */
export function buildGroupTurnInstructionText(characterName: string): string {
  return `你当前扮演的角色是 ${characterName}。你正在参与固定成员的公开群聊。
只以当前角色身份回应公开记录，不要替其他角色、用户或旁白发言。
历史中助手发言的 [名字]： 前缀由系统在渲染历史时自动添加；你的回复不要输出任何 [名字]： 前缀。
不要输出发言意愿标记或解释调度规则。`
}
