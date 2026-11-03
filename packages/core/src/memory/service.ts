/**
 * @description 长期记忆服务：每角色一份 Markdown 的整文档记忆，写前快照、按角色串行写入。
 * @remarks 经 {@link createMemoryService} 构造；记忆文件是人可直接阅读编辑的 Markdown，
 *   读取侧把内容视为不可信文本，仅做修剪不改结构。
 */
import { copyFile, mkdir, readFile, readdir, rm } from 'fs/promises'
import { dirname, join } from 'path'
import type { LogAdapter } from '../adapters'
import {
  createKeyedLazyPromise,
  createSerialQueue,
  createSingleLazyPromise,
  pathExists,
  writeFileAtomic,
  type SerialQueue
} from '../infra'
import { assertPathSegment } from '../infra/path'
import type { MemorySettingsStore } from '@gamechat/type'
import { getCharacterMemoryFilePath, getMemoryVersionsRoot } from './paths'

/** 每个角色保留的记忆版本快照份数（内部常量，非用户设置）。 */
const MEMORY_VERSION_KEEP = 5

/** 记忆服务的宿主依赖。 */
export type MemoryServiceDeps = {
  /** 应用数据根目录。 */
  appDataRoot: string
  /** 日志出口。 */
  log: LogAdapter
  /** 记忆设置分区的读写（经统一设置引擎）。 */
  settings: {
    get: () => Promise<MemorySettingsStore>
    save: (store: MemorySettingsStore) => Promise<MemorySettingsStore>
  }
}

/** 长期记忆服务。 */
export type MemoryService = {
  /** 加载记忆设置快照。 */
  initializeSettings: () => Promise<void>
  /** 返回当前生效的记忆设置（同步读取，供工具门控使用）。 */
  getSettings: () => MemorySettingsStore
  /** 规范化并持久化记忆设置。 */
  saveSettings: (store: MemorySettingsStore) => Promise<MemorySettingsStore>
  /** 读取角色记忆全文。 */
  getCharacterMemory: (characterId: string) => Promise<string>
  /** 全量保存角色记忆。 */
  saveCharacterMemory: (characterId: string, content: string) => Promise<string>
  /** 向角色记忆末尾追加一条。 */
  appendCharacterMemory: (characterId: string, entry: string) => Promise<string>
}

/**
 * @description 创建长期记忆服务实例。
 * @param deps 宿主依赖：数据根目录、日志出口与记忆设置分区读写。
 * @returns 记忆服务实例。
 */
export function createMemoryService(deps: MemoryServiceDeps): MemoryService {
  let settings: MemorySettingsStore = { enabled: true }
  const settingsLoaded = createSingleLazyPromise<void>(async () => {
    settings = await deps.settings.get()
  })
  const cache = createKeyedLazyPromise<string, string>((characterId) =>
    readCharacterMemory(characterId)
  )
  /** 按角色串行化记忆写入的队列，避免并行工具调用对同一文档的读改写竞争。 */
  const writeQueues = new Map<string, SerialQueue>()

  /**
   * @description 确保设置已从统一设置存储加载。
   */
  async function ensureSettingsLoaded(): Promise<void> {
    await settingsLoaded.get()
  }

  /**
   * @description 从磁盘读取角色记忆 Markdown。
   * @param characterId 角色标识。
   * @returns 记忆全文；尚无记忆或读取失败时返回空串。
   */
  async function readCharacterMemory(characterId: string): Promise<string> {
    const filePath = getCharacterMemoryFilePath(deps.appDataRoot, characterId)
    if (!(await pathExists(filePath))) {
      return ''
    }
    try {
      return (await readFile(filePath, 'utf8')).trim()
    } catch (error) {
      void deps.log.error('memory', 'memory-read-failed', 'Failed to read memory markdown; treated as empty', {
        characterId,
        filePath,
        error: error instanceof Error ? error.message : String(error)
      })
      return ''
    }
  }

  /**
   * @description 写盘前把现有记忆文件快照进版本目录，并保留最近若干版。
   * @param characterId 角色标识。
   * @param filePath 记忆文件路径。
   * @returns 无返回值。
   * @remarks 快照失败只记日志，不阻断记忆写入；版本文件以时间戳命名，按字典序 FIFO 清理。
   */
  async function snapshotCharacterMemory(characterId: string, filePath: string): Promise<void> {
    if (!(await pathExists(filePath))) {
      return
    }
    try {
      const versionsRoot = getMemoryVersionsRoot(deps.appDataRoot, characterId)
      await mkdir(versionsRoot, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      await copyFile(filePath, join(versionsRoot, `${stamp}.md`))
      const entries = (await readdir(versionsRoot)).filter((name) => name.endsWith('.md')).sort()
      for (const name of entries.slice(0, Math.max(0, entries.length - MEMORY_VERSION_KEEP))) {
        await rm(join(versionsRoot, name), { force: true })
      }
    } catch (error) {
      void deps.log.warn(
        'memory',
        'memory-version-snapshot-failed',
        'Failed to snapshot memory before write; continuing',
        {
          characterId,
          error: error instanceof Error ? error.message : String(error)
        }
      )
    }
  }

  /**
   * @description 把记忆全文原子写盘并失效读取缓存。
   * @param characterId 角色标识。
   * @param content 已定稿的记忆全文。
   * @returns 写入的记忆全文。
   * @remarks 只应由按角色串行队列内的写入任务调用，保证写盘与缓存失效成对发生。
   */
  async function persistCharacterMemory(characterId: string, content: string): Promise<string> {
    const filePath = getCharacterMemoryFilePath(deps.appDataRoot, characterId)
    await mkdir(dirname(filePath), { recursive: true })
    await snapshotCharacterMemory(characterId, filePath)
    await writeFileAtomic(filePath, content)
    cache.invalidate(characterId)
    return content
  }

  /**
   * @description 返回角色专属的写入串行队列，懒创建。
   * @param characterId 角色标识。
   * @returns 该角色的串行队列。
   */
  function getWriteQueue(characterId: string): SerialQueue {
    let queue = writeQueues.get(characterId)
    if (!queue) {
      queue = createSerialQueue()
      writeQueues.set(characterId, queue)
    }
    return queue
  }

  return {
    initializeSettings: ensureSettingsLoaded,

    getSettings: () => settings,

    saveSettings: async (store) => {
      await ensureSettingsLoaded()
      settings = await deps.settings.save(store)
      return settings
    },

    getCharacterMemory: async (characterId) => {
      assertPathSegment(characterId, 'character id')
      return cache.get(characterId)
    },

    saveCharacterMemory: async (characterId, content) => {
      assertPathSegment(characterId, 'character id')
      const trimmed = content.trim()
      return getWriteQueue(characterId)
        .enqueue(() => persistCharacterMemory(characterId, trimmed))
        .promise
    },

    appendCharacterMemory: async (characterId, entry) => {
      assertPathSegment(characterId, 'character id')
      const trimmedEntry = entry.trim()
      return getWriteQueue(characterId)
        .enqueue(async () => {
          const current = await cache.get(characterId)
          const next = current ? `${current}\n- ${trimmedEntry}` : `- ${trimmedEntry}`
          return persistCharacterMemory(characterId, next)
        })
        .promise
    }
  }
}
