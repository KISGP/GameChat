/**
 * @description 角色媒体与聊天附件的协议地址契约：scheme、主机名、扩展名映射与 URL 构造，进程两侧共用的单一事实源。
 * @remarks 渲染层与主进程协议侧（路径解析、扩展名白名单在 core characters/media.ts）都消费本模块。
 */

/** 角色媒体与聊天附件自定义协议名。 */
export const CHARACTER_MEDIA_SCHEME = 'gamechat-media'

/** 自定义协议的固定主机名，路径按资源类型分段。 */
export const CHARACTER_MEDIA_HOST = 'media'

/** 聊天附件 MIME 类型到文件扩展名的固定映射。 */
export const CHAT_ATTACHMENT_EXTENSIONS: Record<
  'image/png' | 'image/jpeg' | 'image/webp',
  string
> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp'
}

/** 未安装远端角色可预览的图片资产类型。 */
export type RemoteCharacterMediaAsset = 'avatar' | 'cardBg' | 'pixActivity' | 'rolePile'

/**
 * @description 构造本地角色媒体文件的协议地址。
 * @param characterId 角色标识。
 * @param relativePath 角色目录内相对路径（如 info.json 中记录的 `avatar.png`）。
 * @returns 角色媒体文件的协议 URL。
 */
export function getCharacterMediaUrl(characterId: string, relativePath: string): string {
  return `${CHARACTER_MEDIA_SCHEME}://${CHARACTER_MEDIA_HOST}/character/${characterId}/${relativePath}`
}

/**
 * @description 构造未安装远端角色预览图的媒体协议地址。
 * @param characterId 角色标识。
 * @param asset 预览资产类型。
 * @returns 远端预览图的协议 URL。
 * @remarks 主进程协议侧按需经 GitHub 来源链取图并落盘缓存，渲染层不直连仓库地址。
 */
export function getRemoteCharacterMediaUrl(
  characterId: string,
  asset: RemoteCharacterMediaAsset
): string {
  return `${CHARACTER_MEDIA_SCHEME}://${CHARACTER_MEDIA_HOST}/remote/${characterId}/${asset}`
}

/**
 * @description 构造聊天附件图片的媒体协议地址。
 * @param ownerId 会话所有者 ID。
 * @param sessionId 会话 ID。
 * @param resourceId 附件资源 ID。
 * @param mimeType 附件 MIME 类型。
 * @returns 附件图片的协议 URL。
 */
export function getChatAttachmentMediaUrl(
  ownerId: string,
  sessionId: string,
  resourceId: string,
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
): string {
  const extension = CHAT_ATTACHMENT_EXTENSIONS[mimeType]
  return `${CHARACTER_MEDIA_SCHEME}://${CHARACTER_MEDIA_HOST}/chat/${ownerId}/${sessionId}/${resourceId}.${extension}`
}
