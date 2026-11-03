import { CHAT_EMOTICON_MARKER_PATTERN, CHAT_EMOTICON_TOKEN_PATTERN } from './emoticon-markers'

export const ASSISTANT_MESSAGE_SEPARATOR = '\n[WUWA_NEXT_MESSAGE]\n'

/**
 * @description assistant 消息段：一条文字气泡或一个表情消息。
 */
export type AssistantMessageSegment =
  | { type: 'text'; text: string }
  | { type: 'emoticon'; emoticonId: string }

/** @description 未知表情 ID 的回调；主进程传入日志记录，渲染进程可不传。 */
export type UnknownEmoticonReporter = (emoticonId: string) => void

/**
 * @description 将模型回复解析为文字和表情消息段。
 * @param content 模型生成的原始回复文本。
 * @param emoticonIds 当前角色允许发送的表情 ID 集合。
 * @param onUnknownEmoticonId 可选的未知表情 ID 回调。
 * @returns 按显示顺序排列的 assistant 消息段。
 */
export function splitAssistantMessageSegments(
  content: string,
  emoticonIds: ReadonlySet<string>,
  onUnknownEmoticonId?: UnknownEmoticonReporter
): AssistantMessageSegment[] {
  const segments: AssistantMessageSegment[] = []
  for (const rawPart of content.split(ASSISTANT_MESSAGE_SEPARATOR)) {
    const part = rawPart.trim()
    if (!part) continue
    const marker = part.match(CHAT_EMOTICON_MARKER_PATTERN)
    if (marker) {
      const emoticonId = marker[1].trim()
      if (emoticonIds.has(emoticonId)) {
        segments.push({ type: 'emoticon', emoticonId })
      } else {
        onUnknownEmoticonId?.(emoticonId)
      }
      continue
    }
    const text = part.replace(CHAT_EMOTICON_TOKEN_PATTERN, '').trim()
    if (text) segments.push({ type: 'text', text })
  }
  return segments
}

/**
 * @description 将流式中的模型回复解析为 assistant 消息段。
 * @param content 模型当前累计生成的原始回复文本。
 * @param emoticonIds 当前角色允许发送的表情 ID 集合。
 * @param onUnknownEmoticonId 可选的未知表情 ID 回调。
 * @returns 当前可展示的消息段。
 * @remarks 末尾尚未完整输出的分隔符与表情标记前缀会被隐藏，避免流式期闪现半截标记。
 */
export function splitStreamingAssistantMessageSegments(
  content: string,
  emoticonIds: ReadonlySet<string>,
  onUnknownEmoticonId?: UnknownEmoticonReporter
): AssistantMessageSegment[] {
  const prefixLength = getTrailingSeparatorPrefixLength(content)
  const displayWithoutSeparator = prefixLength > 0 ? content.slice(0, -prefixLength) : content
  const emoticonPrefix = getTrailingEmoticonPrefixLength(displayWithoutSeparator)
  const displayContent =
    emoticonPrefix > 0 ? displayWithoutSeparator.slice(0, -emoticonPrefix) : displayWithoutSeparator
  return splitAssistantMessageSegments(displayContent, emoticonIds, onUnknownEmoticonId)
}

/**
 * @description 计算末尾未闭合的表情标记前缀长度。
 * @param content 模型当前累计生成的原始回复文本。
 * @returns 未完成标记长度；没有未完成标记时返回 0。
 */
function getTrailingEmoticonPrefixLength(content: string): number {
  const match = content.match(/\[emoticon:[^\]\r\n]*$/u)
  return match ? match[0].length : 0
}

/**
 * @description 计算文本末尾与分隔符开头重合的最长前缀长度。
 * @param content 模型当前累计生成的原始回复文本。
 * @returns 末尾未完成分隔符前缀长度；没有匹配时返回 0。
 */
function getTrailingSeparatorPrefixLength(content: string): number {
  for (let length = ASSISTANT_MESSAGE_SEPARATOR.length - 1; length > 0; length -= 1) {
    if (content.endsWith(ASSISTANT_MESSAGE_SEPARATOR.slice(0, length))) {
      return length
    }
  }

  return 0
}
