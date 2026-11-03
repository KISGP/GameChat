import { mkdir } from 'fs/promises'
import { shell } from 'electron'
import { normalizeMemorySettingsStore } from '@gamechat/schema'
import { createMemoryService, getMemoryRoot, type MemoryService } from '@gamechat/core'
import { logger } from '../logging/index'
import { getAppDataRoot } from '../utils/path'
import { getUnifiedSettingsStore } from '../settings/index'

/** 记忆域宿主适配：core 记忆服务加记忆目录打开能力。 */
export type AppMemoryService = MemoryService & {
  /** @description 在系统文件管理器中打开记忆存储目录。 */
  openMemoryDirectory: () => Promise<void>
}

/** 进程内共享的记忆服务；首次获取时构造。 */
let memoryService: AppMemoryService | null = null

/**
 * @description 获取进程内共享的记忆服务。
 * @returns 惰性构造并缓存的记忆服务单例。
 * @remarks import 本模块零副作用；服务在首次获取时才构造。
 *   记忆设置分区与统一设置存储引擎共用同一份 settings.json，读写都经该引擎完成。
 */
export function getMemoryService(): AppMemoryService {
  if (!memoryService) {
    const appDataRoot = getAppDataRoot()
    const coreService = createMemoryService({
      appDataRoot,
      log: logger,
      settings: {
        get: async () => (await getUnifiedSettingsStore().get()).memory,
        save: async (store) =>
          getUnifiedSettingsStore().update('memory', normalizeMemorySettingsStore(store))
      }
    })
    memoryService = {
      ...coreService,
      /**
       * @description 用系统默认应用打开记忆存储目录。
       * @returns 无返回值。
       * @remarks 目录按需创建；`shell.openPath` 返回非空错误串时记录日志并抛出，
       *   由 IPC 层向上传播给渲染层。
       */
      openMemoryDirectory: async () => {
        const root = getMemoryRoot(appDataRoot)
        await mkdir(root, { recursive: true })
        const openErrorMessage = await shell.openPath(root)
        if (openErrorMessage) {
          await logger.error(
            'memory',
            'memory-directory-open-failed',
            'Failed to open memory directory',
            { root, error: openErrorMessage }
          )
          throw new Error(openErrorMessage)
        }
      }
    }
  }
  return memoryService
}
