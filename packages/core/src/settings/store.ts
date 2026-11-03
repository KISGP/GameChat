import { createHash } from 'crypto'
import { rename } from 'fs/promises'
import { join } from 'path'
import type { UnifiedSettings } from '@gamechat/type'
import type { LogAdapter, StorageAdapter } from '../adapters'
import {
  createSerialQueue,
  createSingleLazyPromise,
  pathExists,
  readJsonFile,
  writeJsonFileAtomic
} from '../infra/fs'
import { createDefaultUnifiedSettings, normalizeUnifiedSettings } from './normalize'

/**
 * @description 清除凭据指纹与供应商不匹配的缓存模型目录。
 * @param runtime 已规范化的统一设置。
 * @returns 模型目录与当前凭据一致的统一设置。
 */
function invalidateStaleModelCatalogs(runtime: UnifiedSettings): UnifiedSettings {
  return {
    ...runtime,
    providers: {
      ...runtime.providers,
      providers: runtime.providers.providers.map((provider) => {
        const catalog = provider.modelCatalog
        const apiKeyFingerprint = createHash('sha256').update(provider.apiKey.trim()).digest('hex')
        const catalogMatchesProvider =
          catalog &&
          catalog.apiFormat === provider.apiFormat &&
          catalog.baseUrl === provider.baseUrl.trim() &&
          catalog.apiKeyFingerprint === apiKeyFingerprint

        return catalogMatchesProvider ? provider : { ...provider, modelCatalog: undefined }
      })
    }
  }
}

/** 设置引擎的宿主依赖：路径基准与日志出口。 */
export type SettingsEngineDeps = {
  storage: StorageAdapter
  log: LogAdapter
}

/**
 * @description 管理统一设置的加载、规范化与串行原子写入（壳无关引擎，路径由宿主注入）。
 * @remarks 所有分区写入都通过同一个队列执行，避免并发请求覆盖彼此的文件内容。
 */
export class UnifiedSettingsStore {
  private settings: UnifiedSettings | null = null
  /** 首次磁盘加载的去重入口；加载完成后以 settings 字段为唯一事实来源。 */
  private readonly initialLoad: ReturnType<typeof createSingleLazyPromise<UnifiedSettings>>
  private readonly writeQueue = createSerialQueue()
  private readonly filePath: string
  private readonly log: LogAdapter

  /**
   * @description 创建统一设置存储引擎。
   * @param deps 宿主依赖：存储路径基准与日志出口。
   */
  constructor(deps: SettingsEngineDeps) {
    this.filePath = join(deps.storage.userDataDir(), 'settings.json')
    this.log = deps.log
    this.initialLoad = createSingleLazyPromise(() => this.load())
  }

  /**
   * @description 读取完整统一设置，首次调用时才加载磁盘文件。
   * @returns 当前完整的运行时设置快照。
   */
  async get(): Promise<UnifiedSettings> {
    return this.ensureLoaded()
  }

  /**
   * @description 更新一个设置分区并将新的完整快照串行写入磁盘。
   * @param section 需要替换的设置分区。
   * @param value 已由调用方归一化的分区设置。
   * @returns 写入成功后的分区快照。
   */
  async update<K extends keyof UnifiedSettings>(
    section: K,
    value: UnifiedSettings[K]
  ): Promise<UnifiedSettings[K]> {
    const savedValue = value

    const { promise } = this.writeQueue.enqueue(async () => {
      const current = await this.ensureLoaded()
      const next = { ...current, [section]: savedValue } as UnifiedSettings
      await writeJsonFileAtomic(this.filePath, next)
      this.settings = next
    })
    await promise
    return savedValue
  }

  /**
   * @description 返回内存中的设置快照；尚未加载时触发一次共享的磁盘加载。
   * @returns 已规范化的完整设置快照。
   * @remarks 并发的首次调用共享同一次加载；加载抛错时错误传给调用方，下一次调用会重新加载。
   */
  private async ensureLoaded(): Promise<UnifiedSettings> {
    if (this.settings) {
      return this.settings
    }

    this.settings = await this.initialLoad.get()
    return this.settings
  }

  /**
   * @description 从 settings.json 加载总配置，文件损坏时先备份原文件再回退默认值。
   * @returns 已规范化的设置快照。
   * @remarks 文件缺失（首次运行）直接使用默认值；文件存在但读取或解析失败时先把原文件改名
   *   保留为 `.corrupt-<时间戳>` 备份再降级，避免后续任意一次分区保存把默认值固化、覆盖全部凭据。
   *   备份动作失败只记日志，不阻断降级。历史格式与未知字段由 normalize 丢弃、不做迁移，
   *   随任一次分区保存以内存快照整体覆盖。
   */
  private async load(): Promise<UnifiedSettings> {
    const filePath = this.filePath
    if (!(await pathExists(filePath))) {
      this.log.info(
        'settings',
        'unified-settings-missing',
        'Settings file not found, using defaults',
        {
          filePath
        }
      )
      return createDefaultUnifiedSettings()
    }

    const stored = await readJsonFile<Record<string, unknown>>(filePath)
    if (stored === null) {
      const backupPath = `${filePath}.corrupt-${Date.now()}`
      try {
        await rename(filePath, backupPath)
      } catch (error) {
        this.log.warn(
          'settings',
          'unified-settings-corrupt-backup-failed',
          'Failed to back up corrupt settings file',
          {
            filePath,
            backupPath,
            error: error instanceof Error ? error.message : String(error)
          }
        )
      }
      this.log.error(
        'settings',
        'unified-settings-read-failed',
        'Failed to read unified settings; corrupt file backed up, using defaults',
        { filePath, backupPath }
      )
      return createDefaultUnifiedSettings()
    }

    return invalidateStaleModelCatalogs(normalizeUnifiedSettings(stored))
  }
}
