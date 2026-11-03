import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { ChatImageProcessingSettings } from '@gamechat/type'
import { contentToText } from './message-content'

/** CJK 字符的平均 token 换算：约 1.5 个汉字折算 1 个 token。 */
const CJK_CHARS_PER_TOKEN = 1.5
/** 拉丁字符的平均 token 换算：约 4 个字符折算 1 个 token。 */
const LATIN_CHARS_PER_TOKEN = 4
/** 单条消息的结构开销（角色标记与内容包装）。 */
const MESSAGE_TOKEN_OVERHEAD = 8
/** 窗口墙在窗口上预留的输出 token：回复本身也占窗口，输入顶满窗口必然生成失败。 */
const WALL_OUTPUT_RESERVE_TOKENS = 8192
/** 窗口墙必须高出压缩水位的最小余量：保证省略发生前压缩一定先得到触发机会。 */
const WALL_WATER_GAP_TOKENS = 2048
/** 工具轨迹中被截断的早期轮次在消息流中的占位文本。 */
export const TOOL_TRAJECTORY_OMITTED_MARKER = '（早期工具调用与结果已省略）'
/** CJK 统一表意文字、兼容表意、日文假名、CJK 标点与全角形式的字符范围。 */
const CJK_CHAR_PATTERN = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/u

/**
 * @description 校验上下文窗口的生效值。
 * @param contextWindow 模型条目配置的窗口容量；未配置或非法时为 undefined。
 * @returns 校验后的窗口 token 容量。
 * @throws 未配置或非法时抛出：窗口必填于模型编辑界面，运行期不应出现缺失。
 */
function resolveContextWindow(contextWindow: number | undefined): number {
  if (typeof contextWindow !== 'number' || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    throw new Error('Model context window is not configured.')
  }
  return Math.floor(contextWindow)
}

/**
 * @description 生效的上下文预算：压缩水位与输入硬上限的统一推导结果。
 */
export type ContextBudget = {
  /** 校验后的上下文窗口容量。 */
  contextWindow: number
  /** 压缩水位：输入占用的 token 数，达到即触发自动压缩与回合前压缩。 */
  budgetTokens: number
  /** 窗口墙：输入的硬上限，达到才从最旧端省略历史或工具轨迹。 */
  wallTokens: number
  /** 单张图片的 token 估算常数，按图片处理设置的分辨率档位确定。 */
  imageTokenEstimate: number
}

/**
 * @description 按图片处理设置解析单张图片的 token 估算常数。
 * @param settings 图片处理设置。
 * @returns 与压缩后分辨率档位对应的估算常数；档位以「最大边像素平方 ÷ 750」为参照取整。
 * @remarks 处理关闭或档位为 original 时不缩放，取代表性常数兜底；系统偏差由校准系数吸收。
 */
export function resolveImageTokenEstimate(settings: ChatImageProcessingSettings): number {
  if (!settings.enabled) {
    return 8000
  }
  switch (settings.resize.preset) {
    case 768:
      return 800
    case 1024:
      return 1400
    case 1536:
      return 3200
    case 2048:
      return 5600
    default:
      return 8000
  }
}

/**
 * @description 推导一次模型调用的生效上下文预算。
 * @param options 推导输入：模型条目窗口、全局预算比例与图片估算常数。
 * @returns 生效的上下文预算。
 * @remarks 窗口缺省或非法时抛出（窗口必填于模型编辑界面，运行启动前置校验已拦截）；
 *   预算下限 1024 token，防止极端比例把可用预算压为零。水位与墙之间不干预：水位达到只压缩，
 *   输入继续增长不受限；墙为「窗口减输出预留」，且恒高出水位至少 2048 token、不超过窗口，
 *   小窗口或高水位比例下自动抬墙，保证省略发生前压缩一定先触发。
 */
export function resolveContextBudget(options: {
  contextWindow: number | undefined
  budgetRatio: number
  imageTokenEstimate: number
}): ContextBudget {
  const contextWindow = resolveContextWindow(options.contextWindow)
  const budgetTokens = Math.max(1024, Math.floor(contextWindow * options.budgetRatio))
  return {
    contextWindow,
    budgetTokens,
    wallTokens: Math.min(
      contextWindow,
      Math.max(contextWindow - WALL_OUTPUT_RESERVE_TOKENS, budgetTokens + WALL_WATER_GAP_TOKENS)
    ),
    imageTokenEstimate: options.imageTokenEstimate
  }
}

/**
 * @description 推导工具轨迹的可用 token 上限。
 * @param options 扣除输入：总上限（窗口墙）、system 预留与历史估算占用。
 * @returns 工具轨迹可用的 token 数；扣完为零。
 * @remarks 终答与工具循环的各轮路由共用同一扣除口径，保证同一次调用链上不会出现双标。
 */
export function resolveToolTrajectoryBudget(options: {
  totalTokens: number
  systemReserveTokens: number
  historyEstimateTokens: number
}): number {
  return Math.max(
    0,
    options.totalTokens - options.systemReserveTokens - options.historyEstimateTokens
  )
}

/**
 * @description 按字符类别估算一段文本的 token 数。
 * @param text 待估算文本。
 * @returns 估算的 token 数；空文本返回 0。
 * @remarks CJK 字符按 1.5 字符每 token、其余字符按 4 字符每 token 线性折算；系统偏差由
 *   按模型条目的校准系数统一吸收，估算器本身不做供应商特化。
 */
export function estimateTextTokens(text: string): number {
  if (!text) {
    return 0
  }
  let cjkCount = 0
  for (const char of text) {
    if (CJK_CHAR_PATTERN.test(char)) {
      cjkCount += 1
    }
  }
  const otherCount = text.length - cjkCount
  return Math.ceil(cjkCount / CJK_CHARS_PER_TOKEN + otherCount / LATIN_CHARS_PER_TOKEN)
}

/**
 * @description 统计一条模型消息内容中的实时图片数量。
 * @param message 待统计的模型消息。
 * @returns 多模态内容块中的 image_url 数量；纯文本消息返回 0。
 */
function countMessageImages(message: BaseMessage): number {
  if (!Array.isArray(message.content)) {
    return 0
  }
  return message.content.filter(
    (part) =>
      Boolean(part) && typeof part === 'object' && (part as { type?: unknown }).type === 'image_url'
  ).length
}

/**
 * @description 估算单条模型消息的 token 数。
 * @param message 待估算的模型消息。
 * @param imageTokenEstimate 单张图片的估算常数。
 * @returns 未校准的估算 token 数。
 */
function estimateMessageTokens(message: BaseMessage, imageTokenEstimate: number): number {
  return (
    MESSAGE_TOKEN_OVERHEAD +
    estimateTextTokens(contentToText(message.content)) +
    countMessageImages(message) * imageTokenEstimate
  )
}

/**
 * @description 估算一组已渲染模型消息的总 token 数。
 * @param messages 待估算的消息数组。
 * @param imageTokenEstimate 单张图片的估算常数。
 * @returns 未校准的估算 token 总数。
 */
export function estimateMessagesTokens(
  messages: readonly BaseMessage[],
  imageTokenEstimate: number
): number {
  let total = 0
  for (const message of messages) {
    total += estimateMessageTokens(message, imageTokenEstimate)
  }
  return total
}

/** 截断结果的统一形状：保留的消息与截断前后口径的估算值。 */
export type TruncatedMessages = {
  /** 截断后保留的消息，按原顺序排列。 */
  messages: BaseMessage[]
  /** 保留消息的校准后估算 token 数，与预算决策同一口径。 */
  estimateTokens: number
  /** 保留消息的未校准估算 token 数，供校准采样使用。 */
  rawEstimateTokens: number
  /** 被截断丢弃的消息（或工具轮次）数量。 */
  droppedCount: number
}

/**
 * @description 按预算从最旧端截断已渲染的历史消息。
 * @param messages 已渲染的全量历史消息，按时间升序排列。
 * @param options 截断输入：可用 token 上限、图片估算常数与校准系数。
 * @returns 截断结果；上限足以容纳全量时原样返回。
 * @remarks 最新一条消息始终保留，携带实时图片的消息不参与截断；预算装不下保底消息时原样放行，
 *   由供应商侧报错兜底。
 */
export function truncateRenderedMessages(
  messages: readonly BaseMessage[],
  options: {
    maxTokens: number
    imageTokenEstimate: number
    calibration: number
  }
): TruncatedMessages {
  if (messages.length === 0) {
    return { messages: [], estimateTokens: 0, rawEstimateTokens: 0, droppedCount: 0 }
  }
  let keptFrom = messages.length - 1
  let calibratedTotal =
    estimateMessageTokens(messages[keptFrom], options.imageTokenEstimate) * options.calibration
  for (let index = messages.length - 2; index >= 0; index -= 1) {
    const cost =
      estimateMessageTokens(messages[index], options.imageTokenEstimate) * options.calibration
    if (countMessageImages(messages[index]) > 0) {
      // 实时图片消息不参与截断：无论预算是否容纳都保留，并停止向前保留更旧消息。
      calibratedTotal += cost
      keptFrom = index
      break
    }
    if (calibratedTotal + cost > options.maxTokens) {
      break
    }
    calibratedTotal += cost
    keptFrom = index
  }
  const kept = messages.slice(keptFrom)
  return {
    messages: kept,
    estimateTokens: Math.ceil(calibratedTotal),
    rawEstimateTokens: Math.ceil(calibratedTotal / options.calibration),
    droppedCount: keptFrom
  }
}

/**
 * @description 将工具轨迹按轮次分段：每个携带 tool_calls 的 AI 消息开启一轮，其后紧跟的 ToolMessage 归属同轮。
 * @param messages 工具轨迹消息数组。
 * @returns 每轮的消息切片；不含 tool_calls 的前导消息并入第一轮。
 */
function splitToolTrajectoryRounds(messages: readonly BaseMessage[]): BaseMessage[][] {
  const rounds: BaseMessage[][] = []
  for (const message of messages) {
    const toolCalls = (message as { tool_calls?: unknown }).tool_calls
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      rounds.push([message])
      continue
    }
    if (rounds.length === 0) {
      rounds.push([message])
      continue
    }
    rounds[rounds.length - 1].push(message)
  }
  return rounds
}

/**
 * @description 按预算从最旧轮次截断工具调用轨迹。
 * @param messages 当前累积的工具轨迹消息。
 * @param options 截断输入：可用 token 上限、图片估算常数与校准系数。
 * @returns 截断结果；发生丢弃时以占位文本消息补在保留轮次之前。
 * @remarks 最新一轮（含刚执行完的工具结果）始终保留；call 与 result 按轮成对截断，不会出现
 *   无配对结果的 tool_call；最新一轮自身超预算时原样放行。
 */
export function truncateToolTrajectory(
  messages: readonly BaseMessage[],
  options: {
    maxTokens: number
    imageTokenEstimate: number
    calibration: number
  }
): TruncatedMessages {
  const rounds = splitToolTrajectoryRounds(messages)
  if (rounds.length === 0) {
    return { messages: [], estimateTokens: 0, rawEstimateTokens: 0, droppedCount: 0 }
  }
  const roundCosts = rounds.map((round) =>
    round.reduce(
      (total, message) =>
        total + estimateMessageTokens(message, options.imageTokenEstimate) * options.calibration,
      0
    )
  )
  let keptFrom = rounds.length - 1
  let calibratedTotal = roundCosts[keptFrom]
  for (let index = rounds.length - 2; index >= 0; index -= 1) {
    if (calibratedTotal + roundCosts[index] > options.maxTokens) {
      break
    }
    calibratedTotal += roundCosts[index]
    keptFrom = index
  }
  const droppedRounds = keptFrom
  if (droppedRounds === 0) {
    const raw = rounds.reduce(
      (total, round) =>
        total +
        round.reduce(
          (sum, message) => sum + estimateMessageTokens(message, options.imageTokenEstimate),
          0
        ),
      0
    )
    return {
      messages: [...messages],
      estimateTokens: Math.ceil(raw * options.calibration),
      rawEstimateTokens: raw,
      droppedCount: 0
    }
  }
  return {
    messages: [new AIMessage(TOOL_TRAJECTORY_OMITTED_MARKER), ...rounds.slice(keptFrom).flat()],
    estimateTokens: Math.ceil(calibratedTotal),
    rawEstimateTokens: Math.ceil(calibratedTotal / options.calibration),
    droppedCount: droppedRounds
  }
}
