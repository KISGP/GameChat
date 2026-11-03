/**
 * @description 本地角色存储：info.json 与 settings.json 的读写、规范化与进程内缓存。
 * @remarks settings 缓存按角色标识独立失效，唯一写入方是 writeSettings；
 *   磁盘数据按不可信输入处理，损坏文档整体拒绝并记日志。
 */
import type { CharacterSettings } from '@gamechat/type'
import { createKeyedLazyPromise, readJsonFile, writeJsonFileAtomic } from '../../infra'
import type { LogAdapter } from '../../adapters'
import { getCharacterInfoPath, getCharacterSettingsPath } from '../paths'
import { normalizeLocalCharacterInfo, type LocalCharacterInfo } from '../types'

/** 本地角色存储的宿主依赖。 */
export type CharacterStorageDeps = {
  /** 应用数据根目录。 */
  appDataRoot: string
  /** 日志出口。 */
  log: LogAdapter
}

/** 本地角色存储：角色信息与用户配置的读写面。 */
export type CharacterStorage = {
  /** 读取角色的本地 info.json 并校验归属；缺失、损坏或 id 不匹配时返回 null。 */
  readInfo: (id: string) => Promise<LocalCharacterInfo | null>
  /** 原子写入角色本地信息。 */
  writeInfo: (id: string, info: LocalCharacterInfo) => Promise<void>
  /** 读取角色用户配置；缺失或损坏时返回默认值，进程内缓存。 */
  readSettings: (id: string) => Promise<CharacterSettings>
  /** 写入角色用户配置并使进程内缓存失效。 */
  writeSettings: (id: string, settings: CharacterSettings) => Promise<void>
}

/**
 * @description 将磁盘中的未知角色配置规范化为运行时配置。
 * @param value 从角色 settings.json 读取的未知值。
 * @returns 带默认值的角色配置。
 */
function normalizeCharacterSettings(value: unknown): CharacterSettings {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const rawTts = raw.tts && typeof raw.tts === 'object' ? (raw.tts as Record<string, unknown>) : {}
  const rawFish =
    rawTts.fish && typeof rawTts.fish === 'object' ? (rawTts.fish as Record<string, unknown>) : {}
  const referenceId = typeof rawFish.referenceId === 'string' ? rawFish.referenceId.trim() : ''
  return {
    visible: raw.visible !== false,
    pinned: raw.pinned === true,
    tts: referenceId ? { fish: { referenceId } } : {}
  }
}

/**
 * @description 创建新角色的默认用户配置。
 * @returns 默认可见、未置顶且未配置音色覆盖的角色配置。
 */
export function createDefaultCharacterSettings(): CharacterSettings {
  return { visible: true, pinned: false, tts: {} }
}

/**
 * @description 创建本地角色存储实例。
 * @param deps 宿主依赖：应用数据根目录与日志出口。
 * @returns 角色信息与用户配置的读写面。
 */
export function createCharacterStorage(deps: CharacterStorageDeps): CharacterStorage {
  /** 进程内共享的角色用户配置缓存，按角色标识独立失效。 */
  const settingsCache = createKeyedLazyPromise(async (id: string) => {
    const parsed = await readJsonFile<unknown>(getCharacterSettingsPath(deps.appDataRoot, id))
    return parsed === null ? createDefaultCharacterSettings() : normalizeCharacterSettings(parsed)
  })

  return {
    readInfo: async (id) => {
      const parsed = await readJsonFile<unknown>(getCharacterInfoPath(deps.appDataRoot, id))
      if (!parsed) return null
      const info = normalizeLocalCharacterInfo(parsed, id)
      if (!info) {
        deps.log.warn(
          'characters',
          'character-info-invalid',
          'Character info.json is missing or has an unsupported format',
          { characterId: id }
        )
      }
      return info
    },

    writeInfo: async (id, info) => {
      await writeJsonFileAtomic(getCharacterInfoPath(deps.appDataRoot, id), info)
    },

    readSettings: (id) => settingsCache.get(id),

    writeSettings: async (id, settings) => {
      await writeJsonFileAtomic(getCharacterSettingsPath(deps.appDataRoot, id), settings)
      settingsCache.invalidate(id)
    }
  }
}
