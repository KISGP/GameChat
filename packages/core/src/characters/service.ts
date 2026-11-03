/**
 * @description 本地角色服务：角色记录的加载、注册表装配、CRUD 与聊天运行时依赖面。
 * @remarks 经 {@link createCharacterService} 构造；角色图片统一以媒体协议 URL 表达，
 *   装配与广播不携带图片字节。远端角色与同步编排不在本服务内。
 */
import { readFile, readdir, rm } from 'fs/promises'
import type { CharacterSummary, CharacterSource } from '@gamechat/type'
import type { ChatEmoticonDefinition } from '@gamechat/schema'
import type { LogAdapter } from '../adapters'
import { writeFileAtomic } from '../infra'
import {
  getCharacterDirectoryPath,
  getCharacterPromptPath,
  getCharactersRoot
} from './paths'
import { normalizeCharacterVersion, pickDisplayText } from './mappers'
import { getCharacterMediaUrl } from '@gamechat/schema'
import type { CharacterPromptRecord } from '../chat/types'
import {
  createCharacterStorage,
  createDefaultCharacterSettings,
  type CharacterStorage
} from './local/storage'
import type { CharacterSettings } from '@gamechat/type'
import type { LocalCharacterInfo, LocalCharacterRecord } from './types'

/** 角色条目（渲染层角色管理与聊天选择的视图）。 */
export type CharacterEntry = {
  id: string
  name: string
  description: string
  information?: string
  /** 头像媒体协议 URL。 */
  avatar: string
  /** 卡片背景媒体协议 URL。 */
  cardBg: string
  /** 活动立绘媒体协议 URL。 */
  pixActivity: string
  /** 立牌图标媒体协议 URL。 */
  rolePile: string
  source: CharacterSource
  visible: boolean
  settings: CharacterSettings
}

/** 新建角色的输入。 */
export type CharacterCreateInput = {
  /** 角色标识（目录名）。 */
  id: string
  /** 角色显示名。 */
  name: string
  /** 角色人设 prompt 全文。 */
  persona: string
  /** 四张图片的角色目录内相对文件名；图片文件由调用方先行落盘。 */
  images: {
    avatar: string
    cardBg: string
    pixActivity: string
    rolePile: string
  }
}

/** 角色服务的宿主依赖。 */
export type CharacterServiceDeps = {
  /** 应用数据根目录。 */
  appDataRoot: string
  /** 日志出口。 */
  log: LogAdapter
  /** 注册表变更广播：写入类操作成功后调用，宿主推送到渲染层。 */
  onRegistryChanged: (entries: CharacterEntry[]) => void
}

/** 本地角色服务。 */
export type CharacterService = {
  /** 列出全部本地角色。 */
  list: () => Promise<CharacterEntry[]>
  /** 从磁盘加载全部本地角色记录（供注册表装配与同步链使用）。 */
  loadRecords: () => Promise<LocalCharacterRecord[]>
  /** 读取单个角色的本地信息文档。 */
  readInfo: (characterId: string) => Promise<LocalCharacterInfo | null>
  /** 写入单个角色的本地信息文档。 */
  writeInfo: (characterId: string, info: LocalCharacterInfo) => Promise<void>
  /** 读取角色摘要（聊天运行时依赖）。 */
  getSummary: (characterId: string) => Promise<CharacterSummary>
  /** 读取角色人设记录（聊天运行时依赖）。 */
  getPromptRecord: (characterId: string) => Promise<CharacterPromptRecord>
  /** 读取角色表情定义（聊天运行时依赖）。 */
  getEmoticons: (characterId: string) => Promise<ChatEmoticonDefinition[]>
  /** 读取角色人设全文。 */
  getPrompt: (characterId: string) => Promise<string>
  /** 新建本地角色。 */
  create: (input: CharacterCreateInput) => Promise<CharacterEntry>
  /** 更新角色名称与人设。 */
  update: (characterId: string, patch: { name?: string; persona?: string }) => Promise<CharacterEntry>
  /** 删除角色及其目录。 */
  remove: (characterId: string) => Promise<void>
  /** 返回角色目录路径（图片落盘基准）。 */
  getDirectoryPath: (characterId: string) => string
}

/**
 * @description 创建本地角色服务实例。
 * @param deps 宿主依赖：应用数据根目录、日志出口与注册表变更广播。
 * @returns 角色服务实例。
 * @remarks 每次读取都从磁盘加载，角色管理界面的写入经 onRegistryChanged 广播后
 *   由渲染层重新拉取；聊天依赖面按标识单点读取。
 */
export function createCharacterService(deps: CharacterServiceDeps): CharacterService {
  const storage: CharacterStorage = createCharacterStorage({
    appDataRoot: deps.appDataRoot,
    log: deps.log
  })

  /**
   * @description 从磁盘加载全部本地角色记录。
   * @returns 角色记录数组；目录不存在时为空数组。
   */
  async function loadRecords(): Promise<LocalCharacterRecord[]> {
    let names: string[]
    try {
      const entries = await readdir(getCharactersRoot(deps.appDataRoot), { withFileTypes: true })
      names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    } catch {
      return []
    }
    const records: LocalCharacterRecord[] = []
    for (const name of names) {
      const record = await loadRecord(name)
      if (record) {
        records.push(record)
      }
    }
    return records
  }

  /**
   * @description 加载单个角色的完整记录。
   * @param id 角色标识。
   * @returns 角色记录；info.json 缺失或损坏时返回 null。
   */
  async function loadRecord(id: string): Promise<LocalCharacterRecord | null> {
    const info = await storage.readInfo(id)
    if (!info) {
      return null
    }
    const settings = await storage.readSettings(id)
    const prompt = await readPrompt(id)
    return {
      info,
      name: pickDisplayText(info.name, id),
      description: pickDisplayText(info.description),
      information: pickDisplayText(info.information),
      visible: settings.visible,
      settings,
      emoticons: info.emoticons,
      prompt
    }
  }

  /**
   * @description 读取角色人设全文。
   * @param id 角色标识。
   * @returns 人设文本；文件缺失时返回空串。
   */
  async function readPrompt(id: string): Promise<string> {
    try {
      return await readFile(getCharacterPromptPath(deps.appDataRoot, id), 'utf8')
    } catch {
      return ''
    }
  }

  /**
   * @description 将角色记录装配为渲染层条目。
   * @param record 角色记录。
   * @returns 角色条目（图片为媒体协议 URL）。
   */
  function toEntry(record: LocalCharacterRecord): CharacterEntry {
    return {
      id: record.info.id,
      name: record.name,
      description: record.description,
      ...(record.information ? { information: record.information } : {}),
      avatar: getCharacterMediaUrl(record.info.id, record.info.avatar),
      cardBg: getCharacterMediaUrl(record.info.id, record.info.cardBg),
      pixActivity: getCharacterMediaUrl(record.info.id, record.info.pixActivity),
      rolePile: getCharacterMediaUrl(record.info.id, record.info.rolePile),
      source: record.info.source,
      visible: record.visible,
      settings: record.settings
    }
  }

  /**
   * @description 加载记录、装配条目并广播注册表变更。
   * @returns 角色条目数组。
   */
  async function listAndPublish(): Promise<CharacterEntry[]> {
    const entries = (await loadRecords()).map(toEntry)
    deps.onRegistryChanged(entries)
    return entries
  }

  return {
    list: () => loadRecords().then((records) => records.map(toEntry)),

    loadRecords,

    readInfo: (characterId) => storage.readInfo(characterId),

    writeInfo: (characterId, info) => storage.writeInfo(characterId, info),

    getSummary: async (characterId) => {
      const record = await loadRecord(characterId)
      if (!record) {
        throw new Error(`Character not found: ${characterId}`)
      }
      return {
        id: record.info.id,
        name: record.name,
        ...(record.description ? { description: record.description } : {}),
        avatar: getCharacterMediaUrl(record.info.id, record.info.avatar),
        cardBg: getCharacterMediaUrl(record.info.id, record.info.cardBg),
        pixActivity: getCharacterMediaUrl(record.info.id, record.info.pixActivity),
        rolePile: getCharacterMediaUrl(record.info.id, record.info.rolePile)
      }
    },

    getPromptRecord: async (characterId) => ({
      characterId,
      prompt: await readPrompt(characterId)
    }),

    getEmoticons: async (characterId) => {
      const record = await loadRecord(characterId)
      return record?.emoticons ?? []
    },

    getPrompt: readPrompt,

    create: async (input) => {
      const name = input.name.trim()
      if (!name) {
        throw new Error('Character name is required')
      }
      if (await storage.readInfo(input.id)) {
        throw new Error(`Character already exists: ${input.id}`)
      }
      const info: LocalCharacterInfo = {
        id: input.id,
        updateAt: normalizeCharacterVersion(new Date().toISOString()),
        source: 'custom',
        name: { cn: name },
        description: { cn: '' },
        avatar: input.images.avatar,
        cardBg: input.images.cardBg,
        pixActivity: input.images.pixActivity,
        rolePile: input.images.rolePile,
        prompt: 'prompt.md',
        emoticons: []
      }
      await storage.writeInfo(input.id, info)
      await storage.writeSettings(input.id, createDefaultCharacterSettings())
      await writeFileAtomic(getCharacterPromptPath(deps.appDataRoot, input.id), input.persona)
      const entries = await listAndPublish()
      const entry = entries.find((item) => item.id === input.id)
      if (!entry) {
        throw new Error(`Character create failed: ${input.id}`)
      }
      return entry
    },

    update: async (characterId, patch) => {
      const record = await loadRecord(characterId)
      if (!record) {
        throw new Error(`Character not found: ${characterId}`)
      }
      if (patch.name !== undefined) {
        const name = patch.name.trim()
        if (!name) {
          throw new Error('Character name is required')
        }
        const info: LocalCharacterInfo = {
          ...record.info,
          name: { ...record.info.name, cn: name }
        }
        await storage.writeInfo(characterId, info)
      }
      if (patch.persona !== undefined) {
        await writeFileAtomic(getCharacterPromptPath(deps.appDataRoot, characterId), patch.persona)
      }
      const entries = await listAndPublish()
      const entry = entries.find((item) => item.id === characterId)
      if (!entry) {
        throw new Error(`Character update failed: ${characterId}`)
      }
      return entry
    },

    remove: async (characterId) => {
      await rm(getCharacterDirectoryPath(deps.appDataRoot, characterId), {
        recursive: true,
        force: true
      })
      await listAndPublish()
    },

    getDirectoryPath: (characterId) => {
      return getCharacterDirectoryPath(deps.appDataRoot, characterId)
    }
  }
}
