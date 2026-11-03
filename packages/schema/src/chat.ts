import type { ChatImageAttachment, ConversationSession } from '@gamechat/type'

/**
 * @description 聊天图片附件允许的 MIME 到落盘文件扩展名的映射。
 * @remarks 会话存储落盘、Markdown 导出与附件路径构造共用本单一事实源；键集合即附件 MIME 允许域。
 */
export const CHAT_IMAGE_MIME_EXTENSIONS: Record<ChatImageAttachment['mimeType'], string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp'
}

/**
 * @description 判断会话是否为群聊（参与者数大于 1）。
 * @param session 会话快照。
 * @returns 群聊会话返回 true。
 */
export function isGroupSession(session: ConversationSession): boolean {
  return session.participants.length > 1
}
