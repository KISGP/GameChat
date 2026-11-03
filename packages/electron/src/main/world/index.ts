import type { WorldManifest, WorldSyncProgress, WorldSyncResult, WorldSyncStatus } from '@gamechat/type'
import type { GithubRepository, WorldSearchResult } from '@gamechat/core'
import {
  createWorldSyncService,
  WorldSearchService,
  type WorldSyncService,
  type WorldSyncStatus as CoreWorldSyncStatus
} from '@gamechat/core'
import { logger } from '../logging/index'
import { createSingleFlight } from '@gamechat/core'
import { createGithubRequestContext } from '../download/github/index'
import { getAppDataRoot } from '../utils/path'
import { getWorldIndexPath, getWorldRoot } from './paths'

/** World 资料的远端仓库定位；由应用启动配置注入，未配置即使用时报错。 */
let worldRepository: GithubRepository | null = null

/**
 * @description 设置 World 域的远端仓库定位。
 * @param options World 仓库坐标。
 * @returns 无返回值。
 * @remarks 由标准主进程启动链在首次访问 World 域之前调用。
 */
export function configureWorldDomain(options: { repository: GithubRepository }): void {
  worldRepository = options.repository
}

/**
 * @description 读取已设置的 World 仓库定位。
 * @returns 应用声明的 World 仓库坐标。
 * @throws 启动链未配置时抛出。
 */
function requireWorldRepository(): GithubRepository {
  if (!worldRepository) {
    throw new Error('World repository is not configured; provide it through startChatAppMain.')
  }
  return worldRepository
}

/**
 * @description 把 core 同步状态映射为渲染层契约的同步状态。
 * @param status core 返回的同步状态。
 * @returns 渲染层可消费的同步状态。
 * @remarks core 清单为单文件派生索引，渲染层清单字段按空文件集映射，版本信息保持原样。
 */
function toSharedStatus(status: CoreWorldSyncStatus): WorldSyncStatus {
  const localManifest: WorldManifest | null = status.localManifest
    ? {
        version: status.localManifest.version,
        downloadedAt: status.localManifest.downloadedAt,
        files: [],
        totalBytes: 0
      }
    : null
  return {
    rootPath: status.rootPath,
    installed: status.installed,
    localManifest,
    remoteVersion: status.remoteVersion,
    updateAvailable: status.updateAvailable
  }
}

/**
 * @description 聚合 World 背景资料检索与同步能力。
 * @remarks world.json 派生索引以同步的整目录交换提交为唯一写者；同步尝试结束后无论成败都
 *   失效检索快照，使下一次读取反映磁盘内容。import 本模块零副作用，单例经 getWorldService。
 */
export class WorldService {
  private readonly syncService: WorldSyncService
  private readonly searchService: WorldSearchService
  private readonly syncFlight = createSingleFlight<WorldSyncResult>()

  /**
   * @description 创建 World 服务：装配 core 同步引擎与检索服务。
   */
  constructor() {
    const appDataRoot = getAppDataRoot()
    this.syncService = createWorldSyncService({
      appDataRoot,
      log: logger,
      repository: requireWorldRepository(),
      createGithubContext: () => createGithubRequestContext()
    })
    this.searchService = new WorldSearchService({
      indexPath: getWorldIndexPath(),
      log: logger
    })
  }

  /**
   * @description 按自然语言查询检索背景剧情场景与名词解释。
   * @param query 模型从用户话提炼的查询文本。
   * @returns 检索结果；索引不可用或零命中时对应数组为空。
   */
  search(query: string): Promise<WorldSearchResult> {
    return this.searchService.search(query)
  }

  /**
   * @description 返回当前本地 World 资料的同步状态。
   * @returns 当前 World 同步状态。
   */
  async getSyncStatus(): Promise<WorldSyncStatus> {
    return toSharedStatus(await this.syncService.getStatus())
  }

  /**
   * @description 查询远端 World 资料版本并与本地版本比较。
   * @returns 包含远端版本和更新标记的同步状态。
   * @remarks 远端查询失败时 core 降级为未查询状态，不向上抛出。
   */
  async checkSync(): Promise<WorldSyncStatus> {
    return toSharedStatus(await this.syncService.check())
  }

  /**
   * @description 同步 World 资料并刷新检索快照。
   * @param onProgress 可选的同步进度回调。
   * @returns 同步完成后的 World 状态。
   * @remarks 同步以 single-flight 方式执行：运行期间重复触发共享同一次同步，不重复下载。
   *   core 同步引擎按单文件整目录交换提交，进度回调在开始时通知零字节状态，下载期间随
   *   接收字节持续通知；总字节数取自响应 content-length，缺失时为 null。
   *   同步尝试结束后无论成败都失效检索快照——提交阶段已可能改动磁盘，失败路径同样必须
   *   让下一次读取重新扫描。
   */
  sync(onProgress?: (progress: WorldSyncProgress) => void): Promise<WorldSyncResult> {
    return this.syncFlight.run(async () => {
      const before = await this.syncService.getStatus()
      onProgress?.({ receivedBytes: 0, totalBytes: null })
      try {
        const result = await this.syncService.synchronize(onProgress)
        const outcome =
          before.localManifest === null
            ? 'downloaded'
            : before.localManifest.version === result.version
              ? 'unchanged'
              : 'updated'
        return {
          rootPath: getWorldRoot(),
          installed: true,
          localManifest: {
            version: result.version,
            downloadedAt: result.downloadedAt,
            files: [],
            totalBytes: 0
          },
          remoteVersion: result.version,
          updateAvailable: false,
          outcome
        }
      } finally {
        this.invalidate()
      }
    })
  }

  /**
   * @description 返回本地索引文件路径（world.json）。
   * @returns world.json 的绝对路径。
   */
  getIndexPath(): string {
    return this.syncService.getIndexPath()
  }

  /**
   * @description 返回检索服务实例，供世界工具包与聊天宿主绑定使用。
   * @returns 与本服务共享快照失效的检索服务。
   */
  getSearchService(): WorldSearchService {
    return this.searchService
  }

  /**
   * @description 清除检索快照并关停同步域，供应用退出链调用。
   * @remarks core 同步引擎无进行中任务的取消面，本方法只清检索快照。
   */
  shutdown(): void {
    this.invalidate()
  }

  /**
   * @description 清除检索快照，使下一次读取反映磁盘内容。
   */
  invalidate(): void {
    this.searchService.invalidate()
  }
}

/** 进程内共享的 World 服务；首次获取时构造。 */
let worldService: WorldService | null = null

/**
 * @description 获取进程内共享的 World 服务。
 * @returns 惰性构造并缓存的 WorldService 单例。
 * @remarks import 本模块零副作用；服务在首次获取时才构造。
 */
export function getWorldService(): WorldService {
  if (!worldService) {
    worldService = new WorldService()
  }
  return worldService
}

/**
 * @description 返回背景资料检索服务，供聊天宿主绑定与世界工具包使用。
 * @returns 进程内共享的检索服务实例。
 */
export function getWorldSearch(): WorldSearchService {
  return getWorldService().getSearchService()
}
