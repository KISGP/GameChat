import { logger } from '../../infra/log'
import type { AssistantMessageSegment } from '@gamechat/schema'
import {
  splitAssistantMessageSegments as splitSegments,
  splitStreamingAssistantMessageSegments as splitStreamingSegments
} from '@gamechat/schema'

export {
  ASSISTANT_MESSAGE_SEPARATOR,
  type AssistantMessageSegment
} from '@gamechat/schema'

/**
 * @description 将模型回复解析为文字和表情消息段，未知表情 ID 记录日志。
 * @param content 模型生成的原始回复文本。
 * @param emoticonIds 当前角色允许发送的表情 ID 集合。
 * @returns 按显示顺序排列的 assistant 消息段。
 */
export function splitAssistantMessageSegments(
  content: string,
  emoticonIds: ReadonlySet<string>
): AssistantMessageSegment[] {
  return splitSegments(content, emoticonIds, reportUnknownEmoticonId)
}

/**
 * @description 将流式中的模型回复解析为 assistant 消息段，未知表情 ID 记录日志。
 * @param content 模型当前累计生成的原始回复文本。
 * @param emoticonIds 当前角色允许发送的表情 ID 集合。
 * @returns 当前可展示的消息段。
 */
export function splitStreamingAssistantMessageSegments(
  content: string,
  emoticonIds: ReadonlySet<string>
): AssistantMessageSegment[] {
  return splitStreamingSegments(content, emoticonIds, reportUnknownEmoticonId)
}

/**
 * @description 记录模型输出中未知表情 ID 的日志。
 * @param emoticonId 模型输出的未知表情 ID。
 */
function reportUnknownEmoticonId(emoticonId: string): void {
  void logger.warn('ai', 'chat-emoticon-unknown-id', 'Model emitted an unknown emoticon ID', {
    emoticonId
  })
}
