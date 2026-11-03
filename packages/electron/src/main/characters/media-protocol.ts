/**
 * @description 角色媒体协议：注册 gamechat-media 特权协议并处理本地角色、聊天附件与远端预览的图片请求。
 * @remarks 协议地址契约在 core 角色域；本模块只做 Electron 侧注册与路径解析。
 *   远端预览路由经角色门面装配的取图缓存读取，取图失败只记日志并返回 404。
 *   特权注册在进程内只允许一次，由启动链统一调用。
 */
import { net, protocol } from 'electron'
import type { CustomScheme } from 'electron'
import { constants } from 'fs'
import { access } from 'fs/promises'
import { pathToFileURL } from 'url'
import {
  CHARACTER_MEDIA_HOST,
  CHARACTER_MEDIA_SCHEME,
  type RemoteCharacterMediaAsset
} from '@gamechat/schema'
import {
  resolveCharacterMediaPath,
  resolveChatAttachmentMediaPath
} from '@gamechat/core'
import { logger } from '../logging/index'
import { getChatHistoryRoot } from '../chat/paths'
import { getCharactersRoot } from './paths'
import { readRemotePreviewImage } from './remote-preview'

/** 远端预览路由允许的资产类型白名单。 */
const REMOTE_MEDIA_ASSETS: ReadonlySet<string> = new Set([
  'avatar',
  'cardBg',
  'pixActivity',
  'rolePile'
])

/** 角色媒体协议向 Chromium 声明的特权描述。 */
export const privilegedCharacterMediaScheme: CustomScheme = {
  scheme: CHARACTER_MEDIA_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    corsEnabled: true,
    stream: true,
    supportFetchAPI: true,
    bypassCSP: true
  }
}

/**
 * @description 解析远端预览图请求的资产定位。
 * @param pathname 协议 URL 路径，形如 `/remote/<角色id>/<资产类型>`。
 * @returns 角色标识与资产类型；格式不合法时返回 null。
 */
function resolveRemoteMediaAsset(
  pathname: string
): { characterId: string; asset: RemoteCharacterMediaAsset } | null {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length !== 3 || parts[0] !== 'remote') {
    return null
  }
  const [characterId, asset] = [parts[1], parts[2]]
  if (!REMOTE_MEDIA_ASSETS.has(asset)) {
    return null
  }
  return { characterId, asset: asset as RemoteCharacterMediaAsset }
}

/**
 * @description 注册角色媒体协议的请求处理。
 * @returns 无返回值。
 * @remarks 本地角色图片按 `character/<id>/<相对路径>` 解析；聊天附件按
 *   `chat/<ownerId>/<sessionId>/<resourceId>.<ext>` 解析；远端预览按
 *   `remote/<id>/<资产类型>` 经取图缓存读取；其余路由返回 404。
 */
export function registerCharacterMediaProtocol(): void {
  protocol.handle(CHARACTER_MEDIA_SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.host !== CHARACTER_MEDIA_HOST) {
      return new Response('Not found', { status: 404 })
    }
    const pathname = decodeURIComponent(url.pathname)

    const remoteAsset = resolveRemoteMediaAsset(pathname)
    if (remoteAsset) {
      try {
        const bytes = await readRemotePreviewImage(remoteAsset.characterId, remoteAsset.asset)
        return new Response(new Uint8Array(bytes), {
          headers: { 'content-type': 'image/png', 'cache-control': 'max-age=300' }
        })
      } catch {
        return new Response('Remote preview unavailable', { status: 404 })
      }
    }

    const filePath =
      resolveCharacterMediaPath(getCharactersRoot(), pathname) ??
      resolveChatAttachmentMediaPath(getChatHistoryRoot(), pathname)
    if (!filePath) {
      return new Response('Invalid media path', { status: 400 })
    }
    try {
      await access(filePath, constants.R_OK)
      return await net.fetch(pathToFileURL(filePath).toString())
    } catch (error) {
      void logger.warn('main', 'media-serve-failed', 'Failed to serve media file', {
        filePath,
        error: error instanceof Error ? error.message : String(error)
      })
      return new Response('Not found', { status: 404 })
    }
  })
}
