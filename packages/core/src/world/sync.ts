/**
 * @description World 资料同步：从远端仓库拉取单一派生索引 world.json 并原子落盘。
 * @remarks 载荷为单文件（world.json）；版本取仓库最新 commit，落盘经暂存目录整体交换，
 *   交换中途失败不影响旧资料。经 {@link createWorldSyncService} 构造。
 */
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import type { WorldSyncProgress } from '@gamechat/type'
import type { LogAdapter } from '../adapters'
import { readJsonFile, swapDirectoryAtomic, writeJsonFileAtomic } from '../infra'
import {
  formatGithubChainError,
  requestGithubBuffer,
  requestGithubJson,
  type GithubRepository,
  type GithubRequestContext
} from '../infra/github'

/** 远端仓库中的派生索引文件路径，同步载荷的唯一条目。 */
export const WORLD_REMOTE_INDEX_PATH = 'world.json'

/** 本地 World 资料根目录下的清单文件名。 */
const WORLD_MANIFEST_FILE_NAME = 'manifest.json'

/** World 同步的宿主依赖。 */
export type WorldSyncDeps = {
  /** 应用数据根目录。 */
  appDataRoot: string
  /** 日志出口。 */
  log: LogAdapter
  /** World 资料仓库定位。 */
  repository: GithubRepository
  /** 构造本次操作的 GitHub 来源链上下文。 */
  createGithubContext: () => Promise<GithubRequestContext>
}

/** 本地 world 资料清单。 */
export type WorldManifest = {
  /** 同步时的仓库 commit 版本。 */
  version: string
  /** 同步完成时间（ISO 字符串）。 */
  downloadedAt: string
}

/** World 资料状态。 */
export type WorldSyncStatus = {
  /** 资料根目录路径。 */
  rootPath: string
  /** 本地是否已安装资料。 */
  installed: boolean
  /** 本地清单；未安装时为 null。 */
  localManifest: WorldManifest | null
  /** 远端最新 commit 版本；尚未查询时为 null。 */
  remoteVersion: string | null
  /** 是否有可用更新；远端未查询时为 null。 */
  updateAvailable: boolean | null
}

/** World 同步结果。 */
export type WorldSyncResult = {
  /** 本次同步落入的版本。 */
  version: string
  /** 同步完成时间（ISO 字符串）。 */
  downloadedAt: string
}

/** World 同步服务。 */
export type WorldSyncService = {
  /** 返回本地资料状态（不访问网络）。 */
  getStatus: () => Promise<WorldSyncStatus>
  /** 查询远端版本并与本地比较。 */
  check: () => Promise<WorldSyncStatus>
  /** 拉取最新索引并原子落盘；进度回调随下载字节推进。 */
  synchronize: (onProgress?: (progress: WorldSyncProgress) => void) => Promise<WorldSyncResult>
  /** 返回本地索引文件路径（world.json）。 */
  getIndexPath: () => string
}

/**
 * @description 返回 World 资料根目录。
 * @param appDataRoot 应用数据根目录。
 * @returns 资料根目录。
 */
export function getWorldRoot(appDataRoot: string): string {
  return join(appDataRoot, 'world')
}

/**
 * @description 返回 World 全库派生索引文件路径。
 * @param appDataRoot 应用数据根目录。
 * @returns world.json 绝对路径。
 */
export function getWorldIndexPath(appDataRoot: string): string {
  return join(getWorldRoot(appDataRoot), WORLD_REMOTE_INDEX_PATH)
}

/**
 * @description 查询仓库最新 commit 版本。
 * @param deps 宿主依赖。
 * @param context 来源链上下文。
 * @returns 最新 commit 的 SHA。
 */
async function fetchRemoteVersion(
  deps: WorldSyncDeps,
  context: GithubRequestContext
): Promise<string> {
  const commits = await requestGithubJson<Array<{ sha?: unknown }>>(
    `https://api.github.com/repos/${deps.repository.owner}/${deps.repository.name}/commits?per_page=1`,
    context
  )
  const sha = commits[0]?.sha
  if (typeof sha !== 'string' || !sha.trim()) {
    throw new Error('Remote world repository returned no commit.')
  }
  return sha.trim()
}

/**
 * @description 把同步异常转换为携带中文归因的错误消息。
 * @param error 同步过程中抛出的异常。
 * @param formatChain 来源链聚合错误的汇总格式化函数。
 * @returns 中文归因消息。
 */
function describeSyncError(
  error: unknown,
  formatChain: (error: unknown) => string | null
): string {
  const message = error instanceof Error ? error.message : String(error)
  return `World 资料同步失败：${formatChain(error) ?? message}`
}


/**
 * @description 创建 World 同步服务实例。
 * @param deps 宿主依赖：数据根目录、日志出口、仓库定位与来源链上下文构造。
 * @returns 同步服务实例。
 */
export function createWorldSyncService(deps: WorldSyncDeps): WorldSyncService {
  /**
   * @description 读取本地清单。
   * @returns 有效清单；缺失或损坏时为 null。
   */
  async function readLocalManifest(): Promise<WorldManifest | null> {
    const parsed = await readJsonFile<Partial<WorldManifest>>(
      join(getWorldRoot(deps.appDataRoot), WORLD_MANIFEST_FILE_NAME)
    )
    if (!parsed || typeof parsed.version !== 'string' || typeof parsed.downloadedAt !== 'string') {
      return null
    }
    return { version: parsed.version, downloadedAt: parsed.downloadedAt }
  }

  return {
    getStatus: async () => {
      const localManifest = await readLocalManifest()
      return {
        rootPath: getWorldRoot(deps.appDataRoot),
        installed: localManifest !== null,
        localManifest,
        remoteVersion: null,
        updateAvailable: null
      }
    },

    check: async () => {
      const localManifest = await readLocalManifest()
      try {
        const context = await deps.createGithubContext()
        const remoteVersion = await fetchRemoteVersion(deps, context)
        return {
          rootPath: getWorldRoot(deps.appDataRoot),
          installed: localManifest !== null,
          localManifest,
          remoteVersion,
          updateAvailable: localManifest ? localManifest.version !== remoteVersion : null
        }
      } catch (error) {
        void deps.log.warn('world', 'world-check-failed', 'World update check failed', {
          error: error instanceof Error ? error.message : String(error)
        })
        return {
          rootPath: getWorldRoot(deps.appDataRoot),
          installed: localManifest !== null,
          localManifest,
          remoteVersion: null,
          updateAvailable: null
        }
      }
    },

    synchronize: async (onProgress?: (progress: WorldSyncProgress) => void) => {
      const context = await deps.createGithubContext()
      try {
        const version = await fetchRemoteVersion(deps, context)
        const indexUrl = `https://raw.githubusercontent.com/${deps.repository.owner}/${
          deps.repository.name
        }/${deps.repository.branch}/${WORLD_REMOTE_INDEX_PATH}`
        const bytes = await requestGithubBuffer(indexUrl, context, {
          onProgress: (receivedBytes, totalBytes) => onProgress?.({ receivedBytes, totalBytes })
        })
        const downloadedAt = new Date().toISOString()
        const root = getWorldRoot(deps.appDataRoot)
        const staging = `${root}.staging-${Date.now()}`
        await mkdir(staging, { recursive: true })
        await writeFile(join(staging, WORLD_REMOTE_INDEX_PATH), bytes)
        await writeJsonFileAtomic(join(staging, WORLD_MANIFEST_FILE_NAME), {
          version,
          downloadedAt
        } satisfies WorldManifest)
        await swapDirectoryAtomic(staging, root)
        return { version, downloadedAt }
      } catch (error) {
        throw new Error(describeSyncError(error, formatGithubChainError))
      }
    },

    getIndexPath: () => getWorldIndexPath(deps.appDataRoot)
  }
}
