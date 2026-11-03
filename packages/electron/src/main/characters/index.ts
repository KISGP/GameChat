import { shell } from 'electron'
import { join } from 'path'
import type { CharacterPromptDocument, CharacterRegistry, CharacterSummary } from '@gamechat/type'
import { CharacterSettings } from '@gamechat/type'
import type { ChatEmoticonDefinition, ChatEmoticonImage } from '@gamechat/schema'
import {
  createCharacterService,
  createCharacterSyncService,
  resolveEmoticonPath,
  type CharacterService,
  type CharacterSyncService,
  type CharacterSyncLocalDeps,
  type GithubRepository,
  type LocalCharacterInfo
} from '@gamechat/core'
import { logger } from '../logging/index'
import { createKeyedLazyPromise, createSerialQueue, pathExists, readImageDataUrl, readJsonFile, writeJsonFileAtomic } from '@gamechat/core'
import { broadcastToAllWindows } from '../../broadcast'
import {
  CHARACTER_DOWNLOAD_PROGRESS_CHANNEL,
  CHARACTER_REGISTRY_CHANGED_CHANNEL
} from '@gamechat/schema'
import { createGithubRequestContext } from '../download/github/index'
import { getAppDataRoot } from '../utils/path'
import {
  getCharacterDirectoryPath,
  getCharacterInfoPath
} from './paths'
import { configureRemotePreviewCache, configureRemotePreviewRepository, invalidateRemotePreviewCache } from './remote-preview'

/** 角色界面状态（可见性、置顶与音色覆盖）的应用侧存储文件名。 */
const CHARACTER_UI_STATE_FILE_NAME = 'characters-ui-state.json'

/** 默认角色界面状态：可见、未置顶、未配置音色覆盖。 */
function createDefaultCharacterUiState(): CharacterSettings {
  return { visible: true, pinned: false, tts: {} }
}

/**
 * @description 规范化角色界面状态存储文档：逐项补齐默认值，损坏项按默认值处理。
 * @param value 从磁盘读取的未知文档。
 * @returns 按角色标识索引的界面状态表。
 */
function normalizeCharacterUiState(value: unknown): Record<string, CharacterSettings> {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const states: Record<string, CharacterSettings> = {}
  for (const [characterId, item] of Object.entries(raw)) {
    const entry = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    const tts = entry.tts && typeof entry.tts === 'object' ? (entry.tts as Record<string, unknown>) : {}
    const fish = tts.fish && typeof tts.fish === 'object' ? (tts.fish as Record<string, unknown>) : {}
    const referenceId = typeof fish.referenceId === 'string' ? fish.referenceId.trim() : ''
    states[characterId] = {
      visible: entry.visible !== false,
      pinned: entry.pinned === true,
      tts: referenceId ? { fish: { referenceId } } : {}
    }
  }
  return states
}

/**
 * @description 角色界面状态存储：可见性、置顶与 Fish Audio 音色覆盖的应用侧持久化。
 * @remarks core 角色服务的用户配置写在角色目录内且无写入口，本存储承担这四个字段的唯一写方；
 *   读取侧把磁盘内容视为不可信输入，损坏项按默认值处理。全部写操作经同一串行队列，
 *   避免并发 IPC 请求互相覆盖。
 */
class CharacterUiStateStore {
  private states: Record<string, CharacterSettings> | null = null
  private readonly writeQueue = createSerialQueue()

  /**
   * @description 确保状态表已从磁盘加载。
   * @returns 加载完成后的 Promise。
   */
  private async ensureLoaded(): Promise<Record<string, CharacterSettings>> {
    if (!this.states) {
      const filePath = join(getAppDataRoot(), CHARACTER_UI_STATE_FILE_NAME)
      const parsed = await readJsonFile<unknown>(filePath)
      this.states = parsed === null ? {} : normalizeCharacterUiState(parsed)
    }
    return this.states
  }

  /**
   * @description 返回当前内存中的状态表快照；未加载时返回空表。
   * @returns 按角色标识索引的界面状态表。
   * @remarks 供注册表装配同步读取；未加载时按默认状态装配，不影响正确性。
   */
  snapshot(): Record<string, CharacterSettings> {
    return this.states ?? {}
  }

  /**
   * @description 读取单个角色的界面状态。
   * @param characterId 角色标识。
   * @returns 该角色的界面状态；未配置过时返回默认值。
   */
  async get(characterId: string): Promise<CharacterSettings> {
    const states = await this.ensureLoaded()
    return states[characterId] ?? createDefaultCharacterUiState()
  }

  /**
   * @description 原子持久化当前状态表。
   * @returns 写入完成后的 Promise。
   */
  private async persist(): Promise<void> {
    await writeJsonFileAtomic(
      join(getAppDataRoot(), CHARACTER_UI_STATE_FILE_NAME),
      this.states ?? {}
    )
  }

  /**
   * @description 按角色更新界面状态并落盘。
   * @param characterId 角色标识。
   * @param patch 待合并的界面状态字段。
   * @returns 更新后的界面状态。
   * @remarks 合并写入经串行队列执行，写盘失败时向上抛出，内存保持旧值。
   */
  async update(
    characterId: string,
    patch: (current: CharacterSettings) => CharacterSettings
  ): Promise<CharacterSettings> {
    return this.writeQueue.enqueue(async () => {
      const states = await this.ensureLoaded()
      const next = patch(states[characterId] ?? createDefaultCharacterUiState())
      states[characterId] = next
      await this.persist()
      return next
    }).promise
  }

  /**
   * @description 删除单个角色的界面状态记录。
   * @param characterId 角色标识。
   * @returns 删除完成后的 Promise。
   * @remarks 供角色删除流程清理残留记录，避免状态表无限增长。
   */
  async remove(characterId: string): Promise<void> {
    await this.writeQueue.enqueue(async () => {
      const states = await this.ensureLoaded()
      if (!(characterId in states)) {
        return
      }
      delete states[characterId]
      await this.persist()
    }).promise
  }
}

/**
 * @description 把界面状态叠加到角色注册表的本地条目上。
 * @param registry 装配完成的注册表。
 * @returns 本地条目已反映界面状态的注册表。
 * @remarks 可见性、置顶与音色覆盖以应用侧存储为唯一事实来源，覆盖角色目录内的默认配置。
 */
function applyUiState(registry: CharacterRegistry): CharacterRegistry {
  const states = uiStateStore.snapshot()
  return {
    ...registry,
    local: registry.local.map((entry) => {
      const state = states[entry.id]
      return state ? { ...entry, visible: state.visible, settings: state } : entry
    })
  }
}

/** 进程内共享的角色界面状态存储。 */
const uiStateStore = new CharacterUiStateStore()

/** 角色远端仓库定位；由应用启动配置注入，未配置即使用时报错。 */
let characterRepository: GithubRepository | null = null

/**
 * @description 设置角色域的远端仓库定位。
 * @param options 角色仓库坐标。
 * @returns 无返回值。
 * @remarks 由标准主进程启动链在首次访问角色域之前调用；同步服务与远端预览共用同一坐标。
 */
export function configureCharacterDomain(options: { repository: GithubRepository }): void {
  characterRepository = options.repository
  configureRemotePreviewRepository(options.repository)
}

/**
 * @description 读取已设置的角色仓库定位。
 * @returns 应用声明的角色仓库坐标。
 * @throws 启动链未配置时抛出。
 */
function requireCharacterRepository(): GithubRepository {
  if (!characterRepository) {
    throw new Error('Character repository is not configured; provide it through startChatAppMain.')
  }
  return characterRepository
}

/** 进程内共享的本地角色服务与同步服务；首次获取时构造。 */
let localCharacterService: CharacterService | null = null
let characterSyncService: CharacterSyncService | null = null

/**
 * @description 获取进程内共享的本地角色服务。
 * @returns 惰性构造并缓存的本地角色服务单例。
 * @remarks import 本模块零副作用；服务在首次获取时才构造。
 */
function getLocalCharacterService(): CharacterService {
  if (!localCharacterService) {
    localCharacterService = createCharacterService({
      appDataRoot: getAppDataRoot(),
      log: logger,
      // 角色目录写操作（新建、更新、删除）后经同步服务重建并广播注册表。
      onRegistryChanged: () => {
        void getCharacterSyncService().buildAndPublish()
      }
    })
  }
  return localCharacterService
}

/**
 * @description 获取进程内共享的角色同步服务。
 * @returns 惰性构造并缓存的同步服务单例。
 * @remarks import 本模块零副作用；服务在首次获取时才构造。
 *   远端仓库定位与来源链上下文在装配时固定，注册表广播前叠加应用侧界面状态。
 */
function getCharacterSyncService(): CharacterSyncService {
  if (!characterSyncService) {
    const local: CharacterSyncLocalDeps = {
      loadRecords: () => getLocalCharacterService().loadRecords(),
      readInfo: (characterId) => getLocalCharacterService().readInfo(characterId),
      writeInfo: (characterId: string, info: LocalCharacterInfo) =>
        getLocalCharacterService().writeInfo(characterId, info)
    }
    characterSyncService = createCharacterSyncService({
      log: logger,
      repository: requireCharacterRepository(),
      appDataRoot: getAppDataRoot(),
      local,
      createGithubContext: () => createGithubRequestContext(),
      onRegistryChanged: (registry) => {
        broadcastToAllWindows(
          CHARACTER_REGISTRY_CHANGED_CHANNEL,
          applyUiState(registry)
        )
      },
      // 远端预览图磁盘缓存被清空后，协议侧按键缓存必须同步失效。
      onRemoteMediaInvalidated: () => invalidateRemotePreviewCache(),
      onDownloadProgress: (progress) => {
        broadcastToAllWindows(CHARACTER_DOWNLOAD_PROGRESS_CHANNEL, progress)
      }
    })
    configureRemotePreviewCache(characterSyncService.remoteCache)
  }
  return characterSyncService
}

/**
 * @description 获取进程内共享的角色同步服务（应用退出链与下载编排使用）。
 * @returns 同步服务单例。
 */
export function getCharacterService(): CharacterSyncService {
  return getCharacterSyncService()
}

/**
 * @description 启动或复用一次后台角色同步（single-flight），并返回同步后的注册表。
 * @returns 同步完成后的角色注册表。
 */
export async function synchronizeCharacters(): Promise<CharacterRegistry> {
  return applyUiState(await getCharacterSyncService().synchronize())
}

/**
 * @description 返回包含当前后台同步状态的角色注册表。
 * @returns 角色注册表快照。
 */
export async function getCharacterRegistry(): Promise<CharacterRegistry> {
  return applyUiState(await getCharacterSyncService().getSyncedRegistry())
}

/**
 * @description 校验本地角色已安装（存在 info.json）。
 * @param characterId 待检查的本地角色标识。
 * @returns 角色存在时 resolve；不存在时以错误 reject。
 */
async function assertCharacterExists(characterId: string): Promise<void> {
  if (!(await pathExists(getCharacterInfoPath(characterId)))) {
    throw new Error(`Character not found: ${characterId}`)
  }
}

/**
 * @description 更新本地角色在聊天页角色栏中的可见状态。
 * @param characterId 本地角色标识。
 * @param visible 是否在聊天页角色栏显示该角色。
 * @returns 更新后的角色注册表。
 */
export async function setCharacterVisibility(
  characterId: string,
  visible: boolean
): Promise<CharacterRegistry> {
  await assertCharacterExists(characterId)
  await uiStateStore.update(characterId, (current) => ({ ...current, visible }))
  return applyUiState(await getCharacterSyncService().buildAndPublish())
}

/**
 * @description 更新本地角色在聊天页侧栏中的置顶状态。
 * @param characterId 本地角色标识。
 * @param pinned 是否将该角色置顶。
 * @returns 更新后的角色注册表。
 */
export async function setCharacterPinned(
  characterId: string,
  pinned: boolean
): Promise<CharacterRegistry> {
  await assertCharacterExists(characterId)
  await uiStateStore.update(characterId, (current) => ({ ...current, pinned }))
  return applyUiState(await getCharacterSyncService().buildAndPublish())
}

/**
 * @description 读取指定角色的用户配置。
 * @param characterId 本地角色标识。
 * @returns 规范化后的角色配置。
 */
export async function getCharacterSettings(characterId: string): Promise<CharacterSettings> {
  await assertCharacterExists(characterId)
  return uiStateStore.get(characterId)
}

/**
 * @description 更新指定角色的 Fish Audio 音色覆盖。
 * @param characterId 本地角色标识。
 * @param referenceId Fish Audio 音色引用标识；空值会清除覆盖。
 * @returns 更新后的角色配置。
 */
export async function setCharacterFishVoice(
  characterId: string,
  referenceId: string
): Promise<CharacterSettings> {
  await assertCharacterExists(characterId)
  const value = referenceId.trim()
  return uiStateStore.update(characterId, (current) => {
    const next = { ...current, tts: { ...current.tts } }
    if (value) {
      next.tts.fish = { referenceId: value }
    } else {
      delete next.tts.fish
    }
    return next
  })
}

/**
 * @description 返回指定本地角色的摘要信息。
 * @param characterId 角色标识。
 * @returns 角色摘要；角色不存在时抛出。
 */
export async function getCharacterSummaryById(characterId: string): Promise<CharacterSummary> {
  return getLocalCharacterService().getSummary(characterId)
}

/**
 * @description 读取指定本地角色的 Prompt 文档。
 * @param characterId 角色标识。
 * @returns Prompt 文档；角色不存在时 prompt 为空串。
 */
export async function getCharacterPrompt(characterId: string): Promise<CharacterPromptDocument> {
  return getLocalCharacterService().getPromptRecord(characterId)
}

/**
 * @description 保存用户修改后的角色 Prompt。
 * @param characterId 角色标识。
 * @param promptText 完整 Prompt 文本。
 * @returns 保存后的 Prompt 文档。
 * @remarks 直接覆盖式保存（原子写）并刷新注册表；角色更新同样会覆盖 prompt，重置角色即重跑更新。
 */
export async function saveCharacterPrompt(
  characterId: string,
  promptText: string
): Promise<CharacterPromptDocument> {
  await assertCharacterExists(characterId)
  await getLocalCharacterService().update(characterId, { persona: promptText })
  return { characterId, prompt: promptText }
}

/**
 * @description 返回角色信息中携带的 Fish Audio 仓库预设音色 ID。
 * @param characterId 本地角色标识。
 * @returns 预设音色 ID；角色未安装或未提供时返回 undefined。
 * @remarks 这是「仓库预设」通道；用户在设置中保存的覆盖值走应用侧界面状态存储，
 *   两者在 TTS 域按「用户覆盖 > 仓库预设」的优先级合并。
 */
export async function getCharacterTtsFishPreset(
  characterId: string
): Promise<string | undefined> {
  const info = await getLocalCharacterService().readInfo(characterId)
  return info?.tts?.fish
}

/**
 * @description 读取指定角色的表情图片清单。
 * @param characterId 角色标识。
 * @returns 表情图片清单；单个文件缺失时返回占位状态。
 * @remarks 表情定义来自角色 info.json，图片按标识懒读取并缓存；文件缺失只标记不可用，不阻断其余表情。
 */
export async function getCharacterEmoticons(characterId: string): Promise<ChatEmoticonImage[]> {
  return characterEmoticonCache.get(characterId)
}

/**
 * @description 把一个角色的表情定义读取为带 Data URL 的图片清单。
 * @param characterId 角色标识。
 * @returns 表情图片清单；角色不存在时返回空数组。
 */
async function loadCharacterEmoticonImages(characterId: string): Promise<ChatEmoticonImage[]> {
  const definitions = await getLocalCharacterService().getEmoticons(characterId)
  return Promise.all(
    definitions.map(async (definition: ChatEmoticonDefinition) => {
      const filePath = resolveEmoticonPath(getAppDataRoot(), characterId, definition.file)
      if (!(await pathExists(filePath))) {
        await logger.warn(
          'main',
          'character-emoticon-missing',
          'Character emoticon file is missing',
          { characterId, file: definition.file }
        )
        return { id: definition.id, description: definition.description, unavailable: true }
      }
      try {
        return {
          id: definition.id,
          description: definition.description,
          dataUrl: await readImageDataUrl(filePath)
        }
      } catch (error) {
        await logger.warn('main', 'character-emoticon-read-failed', 'Failed to read emoticon image', {
          characterId,
          file: definition.file,
          error: error instanceof Error ? error.message : String(error)
        })
        return { id: definition.id, description: definition.description, unavailable: true }
      }
    })
  )
}

/** 角色表情图片的按键缓存：按角色标识懒读取，写入路径经注册表广播后由渲染层重新拉取。 */
const characterEmoticonCache = createKeyedLazyPromise(
  (characterId: string): Promise<ChatEmoticonImage[]> => loadCharacterEmoticonImages(characterId)
)

/**
 * @description 将一个远端角色加入 FIFO 下载或更新队列。
 * @param characterId 远端角色标识。
 * @returns 更新后的角色注册表。
 * @remarks 下载失败后的重试与首次下载、更新共用本入队通道，无独立重试流程。
 */
export async function downloadCharacter(characterId: string): Promise<CharacterRegistry> {
  return applyUiState(await getCharacterSyncService().queueDownload(characterId))
}

/**
 * @description 取消尚未开始或已在飞的角色下载任务。
 * @param characterId 需要取消的角色标识。
 * @returns 更新后的角色注册表。
 */
export async function cancelCharacterDownload(characterId: string): Promise<CharacterRegistry> {
  return applyUiState(await getCharacterSyncService().cancelDownload(characterId))
}

/**
 * @description 删除本地角色：角色目录移入系统回收站，再经角色服务清理残余并刷新注册表。
 * @param characterId 本地角色标识。
 * @returns 删除后的角色注册表。
 * @remarks 会话数据与群聊约束由聊天域在调用前校验与处理，本函数只负责角色文件与界面状态；
 *   先取消在飞下载再移除目录，避免残余写入复活已删除的角色；目录不存在时跳过回收站步骤，
 *   角色服务的清理与注册表广播照常执行。
 */
export async function deleteCharacter(characterId: string): Promise<CharacterRegistry> {
  await getCharacterSyncService().cancelDownload(characterId)
  const directory = getCharacterDirectoryPath(characterId)
  if (await pathExists(directory)) {
    await shell.trashItem(directory)
  }
  await getLocalCharacterService().remove(characterId)
  await uiStateStore.remove(characterId)
  characterEmoticonCache.invalidate(characterId)
  return applyUiState(await getCharacterSyncService().buildAndPublish())
}
