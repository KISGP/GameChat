import { readdir, stat } from 'fs/promises'
import { dirname, join, resolve, sep } from 'path'
import { app, shell } from 'electron'
import type { StorageLocationTarget, StorageUsageItem, StorageUsageSnapshot } from '@gamechat/type'
import { logger } from '../logging/index'
import { pathExists } from '@gamechat/core'
import { getAppDataRoot } from '../utils/path'
import { getSessionsPath } from '../chat/paths'
import { getCharactersCachePath, getCharactersRoot } from '../characters/paths'
import { getLogsRoot } from '../logging/paths'
import { getSettingsPath } from '../settings/paths'
import { getWorldRoot } from '../world/paths'

type StorageCategoryDefinition = Omit<StorageUsageItem, 'sizeBytes'> & {
  paths: string[]
}

const STORAGE_CATEGORIES: StorageCategoryDefinition[] = [
  {
    id: 'sessions',
    label: '会话',
    path: getSessionsPath(),
    paths: [getSessionsPath()],
    description: '聊天会话与历史消息数据'
  },
  {
    id: 'characters',
    label: '角色',
    path: getCharactersRoot(),
    paths: [getCharactersRoot()],
    description: '本地角色、头像、卡面与 Prompt'
  },
  {
    id: 'world',
    label: 'World 资料',
    path: getWorldRoot(),
    paths: [getWorldRoot()],
    description: 'Story、Glossary 和其他 World 资料'
  },
  {
    id: 'logs',
    label: '日志',
    path: getLogsRoot(),
    paths: [getLogsRoot()],
    description: '应用运行日志'
  },
  {
    id: 'settings',
    label: '设置',
    path: dirname(getSettingsPath()),
    paths: [getSettingsPath()],
    description: '模型配置、通用设置、记忆设置与界面外观'
  },
  {
    id: 'cache',
    label: '缓存',
    path: getCharactersCachePath(),
    paths: [getCharactersCachePath()],
    description: '角色目录与远程资源缓存'
  }
]

const OTHER_CATEGORY: Omit<StorageUsageItem, 'sizeBytes' | 'path'> = {
  id: 'other',
  label: '其他',
  description: '未归入固定分类的应用数据'
}

/** 单次扫描得到的用量桶：根目录总字节数与各分类字节数。 */
type StorageUsageBuckets = {
  totalBytes: number
  categoryBytes: Map<string, number>
}

/**
 * @description 单次深度优先遍历应用数据根目录，按分类前缀把每个文件的字节数归入对应桶。
 * @returns 根目录总字节数与各分类字节数。
 * @remarks 全部分类与「其他」共用一次遍历；文件按解析后路径与分类路径的精确前缀匹配归类。
 */
async function collectStorageBuckets(): Promise<StorageUsageBuckets> {
  const rootPath = getAppDataRoot()
  const categoryBytes = new Map(STORAGE_CATEGORIES.map((definition) => [definition.id, 0]))
  const classifiedPrefixes = STORAGE_CATEGORIES.flatMap((definition) =>
    definition.paths.map((targetPath) => ({ id: definition.id, prefix: resolve(targetPath) }))
  )
  let totalBytes = 0

  /**
   * @description 递归访问一个目录，把其中的文件字节计入总量与命中分类的桶。
   * @param directoryPath 当前遍历的目录路径。
   */
  const visit = async (directoryPath: string): Promise<void> => {
    const entries = await readdir(directoryPath, { withFileTypes: true })
    await Promise.all(
      entries.map(async (entry) => {
        const entryPath = join(directoryPath, entry.name)
        if (entry.isDirectory()) {
          await visit(entryPath)
          return
        }
        if (!entry.isFile()) {
          return
        }
        const entryStat = await stat(entryPath)
        totalBytes += entryStat.size
        const resolvedPath = resolve(entryPath)
        const bucket = classifiedPrefixes.find(
          ({ prefix }) => resolvedPath === prefix || resolvedPath.startsWith(prefix + sep)
        )
        if (bucket) {
          categoryBytes.set(bucket.id, (categoryBytes.get(bucket.id) ?? 0) + entryStat.size)
        }
      })
    )
  }

  if (await pathExists(rootPath)) {
    await visit(rootPath)
  }
  return { totalBytes, categoryBytes }
}

/** 缓存的最近一次用量快照；应用进程内只保留一份，刷新时整体替换。 */
let cachedSnapshot: StorageUsageSnapshot | null = null

/**
 * @description 读取应用数据目录的存储占用快照，按业务分类返回给设置页。
 * @param refresh 为 true 时忽略缓存并重新扫描，否则优先返回缓存的快照。
 * @returns 当前应用数据目录的存储使用分析。
 * @remarks 全量扫描整个应用数据根目录成本较高，进程内缓存上次结果；扫描失败向上抛出，
 *   由 IPC 层的日志化 handler 统一记录。
 */
export async function getStorageUsageSnapshot(refresh = false): Promise<StorageUsageSnapshot> {
  if (!refresh && cachedSnapshot) {
    return cachedSnapshot
  }
  const rootPath = getAppDataRoot()
  const { totalBytes: scannedTotalBytes, categoryBytes } = await collectStorageBuckets()

  const items: StorageUsageItem[] = [
    ...STORAGE_CATEGORIES.map((definition) => ({
      id: definition.id,
      label: definition.label,
      sizeBytes: categoryBytes.get(definition.id) ?? 0,
      path: definition.path,
      description: definition.description
    })),
    {
      ...OTHER_CATEGORY,
      path: rootPath,
      sizeBytes: Math.max(
        0,
        scannedTotalBytes -
          STORAGE_CATEGORIES.reduce(
            (total, definition) => total + (categoryBytes.get(definition.id) ?? 0),
            0
          )
      )
    }
  ]
  const totalBytes = items.reduce((total, item) => total + item.sizeBytes, 0)

  cachedSnapshot = {
    rootPath,
    userDataPath: app.getPath('userData'),
    installPath: dirname(app.getPath('exe')),
    totalBytes,
    scannedAt: new Date().toISOString(),
    items
  }
  return cachedSnapshot
}

/**
 * @description 按目标枚举解析存储页目录位置，并在系统资源管理器中打开该目录。
 * @param target 目录位置目标：数据根、userData 根目录或应用可执行文件所在目录。
 * @remarks 路径一律由主进程按枚举解析，renderer 不传任意路径；`shell.openPath`
 *   返回非空错误串时记录日志并抛出，由 IPC 层向上传播给渲染层。
 */
export async function openStorageLocation(target: StorageLocationTarget): Promise<void> {
  const targetPath =
    target === 'data-root'
      ? getAppDataRoot()
      : target === 'user-data'
        ? app.getPath('userData')
        : dirname(app.getPath('exe'))
  const openErrorMessage = await shell.openPath(targetPath)
  if (openErrorMessage) {
    await logger.error('main', 'storage-location-open-failed', 'Failed to open storage location', {
      target,
      targetPath,
      error: openErrorMessage
    })
    throw new Error(openErrorMessage)
  }
}
