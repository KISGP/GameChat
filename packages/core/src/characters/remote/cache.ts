/**
 * @description 远端角色索引缓存：内存快照与磁盘持久化两级。
 * @remarks 以远端当前状态驱动的写操作必须先经 {@link refreshRemoteIndexCache} 刷新，
 *   禁止直接消费可能过期的持久化快照；磁盘读取带负结果守卫，整个进程只尝试一次。
 */
import { join } from 'path'
import { readJsonFile, writeJsonFileAtomic } from '../../infra'
import type { GithubRequestContext } from '../../infra/github'
import type { RemoteCharacterRecord } from '../types'
import { fetchRemoteIndex, type RemoteClientDeps } from './client'

/** 索引缓存的宿主依赖。 */
export type RemoteCacheDeps = RemoteClientDeps & {
  /** 应用数据根目录。 */
  appDataRoot: string
}

/** chars-cache.json 持久化文档。 */
export type RemoteCharacterCacheDocument = {
  refreshedAt: string | null
  characters: RemoteCharacterRecord[]
}

/** 远端索引缓存。 */
export type RemoteIndexCache = {
  /** 用新拉取的索引更新内存缓存。 */
  set: (characters: RemoteCharacterRecord[], refreshedAt: string | null) => void
  /** 返回内存中的远端索引角色记录。 */
  get: () => RemoteCharacterRecord[]
  /** 返回最近刷新时间；尚未刷新时为 null。 */
  getRefreshedAt: () => string | null
  /** 确保已尝试加载持久化索引缓存（进程内只读盘一次）。 */
  ensureLoaded: () => Promise<void>
  /** 拉取最新索引并更新内存与磁盘两级缓存。 */
  refresh: (context?: GithubRequestContext) => Promise<{
    characters: RemoteCharacterRecord[]
    refreshedAt: string
  }>
  /** 将内存缓存持久化到磁盘。 */
  write: () => Promise<void>
}

/**
 * @description 创建远端索引缓存实例。
 * @param deps 宿主依赖：仓库定位、数据根目录与日志出口。
 * @returns 索引缓存实例。
 */
export function createRemoteIndexCache(deps: RemoteCacheDeps): RemoteIndexCache {
  let characters: RemoteCharacterRecord[] = []
  let refreshedAt: string | null = null
  let loadAttempted = false

  return {
    set: (nextCharacters, nextRefreshedAt) => {
      characters = nextCharacters
      refreshedAt = nextRefreshedAt
    },

    get: () => characters,

    getRefreshedAt: () => refreshedAt,

    ensureLoaded: async () => {
      if (loadAttempted) return
      loadAttempted = true
      const parsed = await readJsonFile<unknown>(join(deps.appDataRoot, 'chars-cache.json'))
      if (!parsed) return
      const document = parsed as Partial<RemoteCharacterCacheDocument>
      if (!Array.isArray(document.characters)) {
        deps.log.warn(
          'characters',
          'character-index-cache-incompatible',
          'Persisted character index cache has an unsupported format and will be refetched'
        )
        return
      }
      characters = document.characters
      refreshedAt = document.refreshedAt ?? null
    },

    refresh: async (context) => {
      const document = await fetchRemoteIndex(deps, context)
      characters = document.characters
      refreshedAt = document.refreshedAt
      await writeJsonFileAtomic(join(deps.appDataRoot, 'chars-cache.json'), {
        refreshedAt,
        characters
      })
      return document
    },

    write: async () => {
      await writeJsonFileAtomic(join(deps.appDataRoot, 'chars-cache.json'), {
        refreshedAt,
        characters
      })
    }
  }
}
