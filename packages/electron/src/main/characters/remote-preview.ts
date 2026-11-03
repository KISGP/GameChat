import { mkdir, readFile } from 'fs/promises'
import { dirname, join } from 'path'
import type { GithubRepository, RemoteIndexCache } from '@gamechat/core'
import {
  fetchRemoteBuffer,
  type RemoteCharacterRecord,
  type RemoteClientDeps
} from '@gamechat/core'
import type { RemoteCharacterMediaAsset } from '@gamechat/schema'
import { logger } from '../logging/index'
import { createKeyedLazyPromise, pathExists, writeFileAtomic } from '@gamechat/core'
import { createGithubRequestContext } from '../download/github/index'
import { getRemoteImagesCacheRoot } from './paths'

/** 远端预览取图的宿主依赖；仓库定位由角色域装配时注入（与同步服务同源）。 */
let remoteClientDeps: RemoteClientDeps | null = null

/**
 * @description 设置远端预览取图使用的仓库定位。
 * @param repository 角色仓库坐标。
 * @returns 无返回值。
 * @remarks 由角色域 configureCharacterDomain 统一调用，保证同步服务与预览取图同源。
 */
export function configureRemotePreviewRepository(repository: GithubRepository): void {
  remoteClientDeps = { log: logger, repository }
}

/**
 * @description 读取远端预览取图的宿主依赖。
 * @returns 已注入的远端客户端依赖。
 * @throws 角色域未完成配置时抛出。
 */
function requireRemoteClientDeps(): RemoteClientDeps {
  if (!remoteClientDeps) {
    throw new Error('Remote character repository is not configured; call configureCharacterDomain first.')
  }
  return remoteClientDeps
}

/** 远端预览资产到索引记录仓库路径的取值映射。 */
const REMOTE_MEDIA_ASSET_PATHS: Record<
  RemoteCharacterMediaAsset,
  (record: RemoteCharacterRecord) => string
> = {
  avatar: (record) => record.avatar,
  cardBg: (record) => record.cardBg,
  pixActivity: (record) => record.pixActivity,
  rolePile: (record) => record.rolePile
}

/**
 * @description 读取远端角色预览图：命中磁盘缓存直接返回，未命中经 GitHub 来源链取图后落盘。
 * @param remoteCache 远端索引缓存句柄，用于定位角色的仓库资源路径。
 * @param key 缓存键，形如 `<角色id>/<资产类型>`。
 * @returns 预览图文件字节。
 * @remarks 索引缓存中没有该角色时抛错；取图失败由按键缓存自动失效，同键下次请求会重试。
 */
async function loadRemotePreviewImage(
  remoteCache: RemoteIndexCache,
  key: string
): Promise<Buffer> {
  const [characterId, asset] = key.split('/') as [string, RemoteCharacterMediaAsset]
  const cachePath = join(getRemoteImagesCacheRoot(), characterId, `${asset}.png`)
  if (await pathExists(cachePath)) {
    return readFile(cachePath)
  }
  const record = remoteCache.get().find((item) => item.id === characterId)
  if (!record) {
    throw new Error(`Remote character not found: ${characterId}`)
  }
  const buffer = await fetchRemoteBuffer(
    requireRemoteClientDeps(),
    REMOTE_MEDIA_ASSET_PATHS[asset](record),
    await createGithubRequestContext()
  )
  await mkdir(dirname(cachePath), { recursive: true })
  await writeFileAtomic(cachePath, buffer)
  return buffer
}

/** 远端预览图按键取图缓存：并发请求共享同一次取图，失败不缓存以便重试。 */
const remotePreviewImages = createKeyedLazyPromise(
  (key: string): Promise<Buffer> => loadRemotePreviewImage(getRemoteCacheHandle(), key)
)

/** 进程内的远端索引缓存句柄；由 characters 门面在装配同步服务时注入。 */
let remoteCacheHandle: RemoteIndexCache | null = null

/**
 * @description 注入远端索引缓存句柄，供预览图取图定位仓库资源路径。
 * @param cache 同步服务持有的远端索引缓存。
 * @returns 无返回值。
 * @remarks 由角色门面在构造同步服务时调用一次；预览图读取发生在协议请求路径，注入必然先于读取。
 */
export function configureRemotePreviewCache(cache: RemoteIndexCache): void {
  remoteCacheHandle = cache
}

/**
 * @description 返回已注入的远端索引缓存句柄。
 * @returns 远端索引缓存句柄。
 * @throws 尚未注入时抛出。
 */
function getRemoteCacheHandle(): RemoteIndexCache {
  if (!remoteCacheHandle) {
    throw new Error('Remote preview cache is not configured')
  }
  return remoteCacheHandle
}

/**
 * @description 失效远端预览图的按键取图缓存。
 * @returns 无返回值。
 * @remarks 清空远端预览图磁盘缓存的写方必须同步调用本函数：按键缓存成功即常驻，
 *   不失效时已解析过的键会继续返回已删除文件的路径，直到进程重启。
 */
export function invalidateRemotePreviewCache(): void {
  remotePreviewImages.invalidate()
}

/**
 * @description 读取一个远端角色预览图字节。
 * @param characterId 远端角色标识。
 * @param asset 预览资产类型。
 * @returns 预览图字节；取图失败时抛错，由协议侧翻译为 404。
 */
export function readRemotePreviewImage(
  characterId: string,
  asset: RemoteCharacterMediaAsset
): Promise<Buffer> {
  return remotePreviewImages.get(`${characterId}/${asset}`).catch((error: unknown) => {
    void logger.warn('main', 'media-remote-fetch-failed', 'Failed to fetch remote character media', {
      characterId,
      asset,
      error: error instanceof Error ? error.message : String(error)
    })
    throw error
  })
}
