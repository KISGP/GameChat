/**
 * @description 角色媒体协议的主进程侧：协议路径解析。
 * @remarks 渲染层消费 @gamechat/schema 的纯构造器；本模块逐段校验路径并限定图片扩展名白名单，
 *   settings.json 等非图片文件不可达。
 */
import { join } from 'path'
import { isPathSegment } from '../infra/path'
import { CHAT_ATTACHMENT_EXTENSIONS } from '@gamechat/schema'


/**
 * @description 解析角色媒体请求的目标路径。
 * @param charactersRoot 角色资源根目录。
 * @param pathname 协议 URL 路径，形如 `/character/<id>/<角色目录内相对路径>`。
 * @returns 图片绝对路径；格式不合法时返回 null。
 */
export function resolveCharacterMediaPath(
  charactersRoot: string,
  pathname: string
): string | null {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length < 3 || parts[0] !== 'character') {
    return null
  }
  const [characterId, ...pathSegments] = parts.slice(1)
  if (!isSegment(characterId) || pathSegments.some((segment) => !isSegment(segment))) {
    return null
  }
  const fileName = pathSegments[pathSegments.length - 1]
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex <= 0) {
    return null
  }
  const extension = fileName.slice(dotIndex + 1).toLowerCase()
  if (!CHARACTER_MEDIA_IMAGE_EXTENSIONS.has(extension)) {
    return null
  }
  return joinPath(charactersRoot, characterId, ...pathSegments)
}

/**
 * @description 解析聊天附件请求的目标路径。
 * @param attachmentsRoot 聊天附件资源根目录（其下按 `<ownerId>/<sessionId>/attachments` 布局）。
 * @param pathname 协议 URL 路径，形如 `/chat/<ownerId>/<sessionId>/<resourceId>.<ext>`。
 * @returns 图片绝对路径；格式不合法或扩展名不在白名单时返回 null。
 */
export function resolveChatAttachmentMediaPath(
  attachmentsRoot: string,
  pathname: string
): string | null {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length !== 4 || parts[0] !== 'chat') {
    return null
  }
  const [ownerId, sessionId, fileName] = [parts[1], parts[2], parts[3]]
  if (!isSegment(ownerId) || !isSegment(sessionId)) {
    return null
  }
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex <= 0) {
    return null
  }
  const resourceId = fileName.slice(0, dotIndex)
  const extension = fileName.slice(dotIndex + 1).toLowerCase()
  if (!isSegment(resourceId)) {
    return null
  }
  const matched = Object.values(CHAT_ATTACHMENT_EXTENSIONS).find((value) => value === extension)
  if (!matched) {
    return null
  }
  return joinPath(attachmentsRoot, ownerId, sessionId, 'attachments', `${resourceId}.${matched}`)
}

/** 角色媒体允许服务的图片扩展名白名单（小写）。 */
const CHARACTER_MEDIA_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp'
])

/**
 * @description 判定字符串是否为安全的单段路径片段。
 * @param value 待判定字符串。
 * @returns 合法时返回 true。
 */
function isSegment(value: string): boolean {
  return isPathSegment(value)
}

/**
 * @description 拼接路径段。
 * @param base 基准目录。
 * @param segments 其余路径段。
 * @returns 拼接后的绝对路径。
 */
function joinPath(base: string, ...segments: string[]): string {
  return join(base, ...segments)
}
