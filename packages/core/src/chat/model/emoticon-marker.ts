import { CHAT_EMOTICON_MARKER_PREFIX } from '@gamechat/schema'

/**
 * @description 构造表情标记文本。
 * @param id 表情全局唯一 ID。
 * @returns 可注入聊天历史的表情标记。
 */
export function formatChatEmoticonMarker(id: string): string {
  return `${CHAT_EMOTICON_MARKER_PREFIX}${id}]`
}
