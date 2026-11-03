import { join } from 'path'
import { assertPathSegment } from '../infra/path'
import { getChatHost } from './host'

/**
 * @description 返回聊天记录根目录的宿主数据路径。
 * @returns 聊天记录根目录。
 * @remarks 每个拥有者和会话分别使用独立子目录。
 */
export function getChatHistoryRoot(): string {
  return join(getChatHost().appDataRoot(), 'chat-history')
}

/**
 * @description 返回独立群聊注册表的持久化文件路径。
 * @returns 群聊注册表 JSON 文件路径。
 */
export function getChatGroupsPath(): string {
  return join(getChatHistoryRoot(), 'groups.json')
}

/**
 * @description 返回指定拥有者的聊天记录目录。
 * @param ownerId 会话拥有者标识（角色 ID 或群聊成员标识）。
 * @returns 拥有者聊天记录目录路径。
 */
export function getChatCharacterRoot(ownerId: string): string {
  assertPathSegment(ownerId, 'character id')
  return join(getChatHistoryRoot(), ownerId)
}

/**
 * @description 返回指定会话的聊天记录目录。
 * @param ownerId 会话拥有者标识。
 * @param sessionId 会话标识。
 * @returns 会话目录路径。
 */
export function getChatSessionRoot(ownerId: string, sessionId: string): string {
  assertPathSegment(sessionId, 'session id')
  return join(getChatCharacterRoot(ownerId), sessionId)
}

/**
 * @description 返回指定会话的 JSON 持久化文件路径。
 * @param ownerId 会话拥有者标识。
 * @param sessionId 会话标识。
 * @returns 会话 JSON 文件路径。
 */
export function getChatSessionPath(ownerId: string, sessionId: string): string {
  return join(getChatSessionRoot(ownerId, sessionId), 'session.json')
}

/**
 * @description 返回指定会话内指定角色的状态卡 Markdown 文件路径。
 * @param ownerId 会话拥有者标识。
 * @param sessionId 会话标识。
 * @param characterId 发言角色标识。
 * @returns 会话状态卡 MD 文件路径。
 * @remarks 状态卡跟会话走、按角色分卡：群聊中每位角色维护自己的卡，单聊即该角色的一张卡；
 *   文件位于会话目录内，随会话目录的删除一并移除。
 */
export function getChatSessionStateCardPath(
  ownerId: string,
  sessionId: string,
  characterId: string
): string {
  assertPathSegment(characterId, 'character id')
  return join(getChatSessionRoot(ownerId, sessionId), 'state-cards', `${characterId}.md`)
}

/**
 * @description 返回指定会话的图片附件目录。
 * @param ownerId 会话拥有者标识。
 * @param sessionId 会话标识。
 * @returns 图片附件目录路径。
 */
export function getChatAttachmentsRoot(ownerId: string, sessionId: string): string {
  return join(getChatSessionRoot(ownerId, sessionId), 'attachments')
}

/**
 * @description 返回指定会话图片资源的文件路径。
 * @param ownerId 会话拥有者标识。
 * @param sessionId 会话标识。
 * @param resourceId 会话内资源标识。
 * @param extension 图片文件扩展名，须取自 IMAGE_MIME_EXTENSIONS 白名单映射。
 * @returns 图片附件文件路径。
 */
export function getChatAttachmentPath(
  ownerId: string,
  sessionId: string,
  resourceId: string,
  extension: string
): string {
  assertPathSegment(resourceId, 'resource id')
  return join(getChatAttachmentsRoot(ownerId, sessionId), resourceId + extension)
}
