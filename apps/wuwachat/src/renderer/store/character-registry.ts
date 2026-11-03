import { CharacterDownloadProgress, CharacterRegistry, CharacterSummary } from '@gamechat/type'
import { create } from 'zustand'
import { toast } from 'sonner'
import {
  downloadCharacter,
  getCharacterRegistry,
  onCharacterDownloadProgress,
  syncNowCharacters
} from '@renderer/services/characters'
import { clearCharacterEmoticonCache } from '@renderer/services/emoticons'

const EMPTY_REGISTRY: CharacterRegistry = {
  local: [],
  remote: [],
  refreshedAt: null,
  isSyncing: false
}

type CharacterRegistryStore = {
  registry: CharacterRegistry
  activateChar: CharacterSummary | null
  /** 各角色最近一次下载字节进度；角色不再处于下载态时移除对应键。 */
  downloadProgress: Record<string, CharacterDownloadProgress>
  /**
   * @description 替换当前角色注册表并重新关联激活角色。
   * @param registry 要写入的最新角色注册表。
   * @returns 无返回值。
   */
  setRegistry: (registry: CharacterRegistry) => void
  /**
   * @description 设置当前激活的本地角色。
   * @param char 要激活的角色；传入 null 时清除当前选择。
   * @returns 无返回值。
   */
  setActivateChar: (char: CharacterSummary | null) => void
  /**
   * @description 从主进程读取最新角色注册表。
   * @returns 角色注册表刷新完成后的 Promise。
   */
  refreshRegistry: () => Promise<void>
}

export const useCharacterRegistryStore = create<CharacterRegistryStore>((set, get) => ({
  registry: EMPTY_REGISTRY,
  activateChar: null,
  downloadProgress: {},
  /**
   * @description 替换当前角色注册表并重新关联激活角色。
   * @param registry 要写入的最新角色注册表。
   * @returns 无返回值。
   * @remarks 已激活角色不在最新注册表的本地清单中时置空激活态：激活角色必须是当前
   *   注册表内真实存在的本地角色，不保留已消失角色的陈旧引用。进度表同步裁剪：
   *   仅保留仍处于下载态的角色，结束或取消的角色不保留陈旧进度。
   */
  setRegistry: (registry) =>
    set((current) => {
      const downloadingIds = new Set<string>()
      for (const entry of registry.remote) {
        if (entry.syncState === 'downloading') {
          downloadingIds.add(entry.id)
        }
      }
      for (const entry of registry.local) {
        if (entry.syncStatus?.syncState === 'downloading') {
          downloadingIds.add(entry.id)
        }
      }
      const downloadProgress: Record<string, CharacterDownloadProgress> = {}
      for (const [id, progress] of Object.entries(current.downloadProgress)) {
        if (downloadingIds.has(id)) {
          downloadProgress[id] = progress
        }
      }
      return {
        registry,
        downloadProgress,
        activateChar: registry.local.find((char) => char.id === current.activateChar?.id) ?? null
      }
    }),
  /**
   * @description 设置当前激活的本地角色。
   * @param char 要激活的角色；传入 null 时清除当前选择。
   * @returns 无返回值。
   */
  setActivateChar: (char) => set({ activateChar: char }),
  /**
   * @description 从主进程读取最新角色注册表。
   * @returns 角色注册表刷新完成后的 Promise。
   * @remarks 读取结果经 setRegistry 写入，激活角色的重新关联由该入口统一处理。
   */
  refreshRegistry: async () => {
    get().setRegistry(await getCharacterRegistry())
  }
}))

/** @description 上一次注册表快照中处于失败状态的条目键；键不存在表示该条目刚刚转为失败。 */
let previousFailureKeys = new Set<string>()
/** @description 是否已经消费过首份注册表快照；首份快照只初始化失败键不提示，避免历史遗留失败在启动时集中弹窗。 */
let failureBaselineInitialized = false

/**
 * @description 对比注册表前后快照，把新出现的下载或索引失败以 toast 提示。
 * @param registry 最新的角色注册表。
 * @remarks 失败条目重试期间退出失败态，再次失败时键重新出现并再次提示；
 *   toast 附带「重试」按钮，角色失败直接重新排队下载，索引失败重新整表同步。
 */
function notifyNewSyncFailures(registry: CharacterRegistry): void {
  const nextFailureKeys = new Set<string>()
  const newFailures: Array<{ key: string; message: string; retry: () => void }> = []

  for (const entry of registry.remote) {
    if (entry.syncState !== 'failed' || !entry.syncError) {
      continue
    }
    const key = `remote:${entry.id}`
    nextFailureKeys.add(key)
    if (failureBaselineInitialized && !previousFailureKeys.has(key)) {
      newFailures.push({
        key,
        message: `角色「${entry.name}」下载失败：${entry.syncError}`,
        retry: () => void downloadCharacter(entry.id)
      })
    }
  }
  for (const entry of registry.local) {
    if (!entry.syncStatus?.syncError) {
      continue
    }
    const key = `local:${entry.id}`
    nextFailureKeys.add(key)
    if (failureBaselineInitialized && !previousFailureKeys.has(key)) {
      newFailures.push({
        key,
        message: `角色「${entry.name}」更新失败：${entry.syncStatus.syncError}`,
        retry: () => void downloadCharacter(entry.id)
      })
    }
  }
  if (registry.syncError) {
    nextFailureKeys.add('registry-sync')
    if (failureBaselineInitialized && !previousFailureKeys.has('registry-sync')) {
      newFailures.push({
        key: 'registry-sync',
        message: `角色资料同步失败：${registry.syncError}`,
        retry: () => void syncNowCharacters()
      })
    }
  }

  previousFailureKeys = nextFailureKeys
  failureBaselineInitialized = true
  for (const failure of newFailures) {
    toast.error(failure.message, {
      duration: 8000,
      action: { label: '重试', onClick: failure.retry }
    })
  }
}

/** @description 上一次注册表快照中各本地角色的下载状态；键缺失表示尚无基线。 */
let previousLocalSyncStates = new Map<string, 'queued' | 'downloading' | null>()

/**
 * @description 对比注册表前后快照，在本地角色下载周期结束时清理其表情缓存。
 * @param registry 最新的角色注册表。
 * @remarks 下载与更新都会经历「排队或下载中 → 结束」的状态迁移，以该迁移作为表情缓存的
 *   唯一失效依据，覆盖设置页、向导与失败重试全部触发链；首份快照只建立基线不做清理。
 */
function clearFinishedDownloadEmoticonCaches(registry: CharacterRegistry): void {
  const next = new Map<string, 'queued' | 'downloading' | null>()
  for (const entry of registry.local) {
    const syncState = entry.syncStatus?.syncState ?? null
    next.set(entry.id, syncState)
    const previous = previousLocalSyncStates.get(entry.id)
    if (
      failureBaselineInitialized &&
      previous !== undefined &&
      previous !== null &&
      syncState === null
    ) {
      clearCharacterEmoticonCache(entry.id)
    }
  }
  previousLocalSyncStates = next
}

/** @description 上一次注册表快照中各远端角色的下载状态；键缺失表示尚无基线或已安装。 */
let previousRemoteSyncStates = new Map<string, 'queued' | 'downloading' | 'failed' | undefined>()
/** @description 上一次注册表快照中各本地角色的更新状态；键缺失表示尚无基线。 */
let previousLocalUpdateStates = new Map<string, 'queued' | 'downloading' | null>()

/**
 * @description 对比注册表前后快照，在下载或更新周期结束时以 toast 提示成功。
 * @param registry 最新的角色注册表。
 * @remarks 下载与更新都经历「排队或下载中 → 结束」的状态迁移。远端列表只包含未安装
 *   角色，下载完成的远端条目整体消失：按前快照中仍在排队或下载的键在本快照中消失判定
 *   结束，本地已装即成功提示，未装说明任务被主动取消，静默不提示。首份快照只建立基线。
 */
function notifyFinishedDownloads(registry: CharacterRegistry): void {
  const nextRemoteStates = new Map<string, 'queued' | 'downloading' | 'failed' | undefined>()
  for (const entry of registry.remote) {
    nextRemoteStates.set(entry.id, entry.syncState)
  }
  for (const [id, previous] of previousRemoteSyncStates) {
    if (previous === undefined) {
      continue
    }
    if (nextRemoteStates.has(id)) {
      continue
    }
    const local = registry.local.find((item) => item.id === id)
    if (local) {
      toast.success(`角色「${local.name}」下载完成`)
    }
  }
  previousRemoteSyncStates = nextRemoteStates

  const nextLocalStates = new Map<string, 'queued' | 'downloading' | null>()
  for (const entry of registry.local) {
    const syncState = entry.syncStatus?.syncState ?? null
    nextLocalStates.set(entry.id, syncState)
    const previous = previousLocalUpdateStates.get(entry.id)
    if (
      failureBaselineInitialized &&
      previous !== undefined &&
      previous !== null &&
      syncState === null
    ) {
      toast.success(`角色「${entry.name}」更新完成`)
    }
  }
  previousLocalUpdateStates = nextLocalStates
}

useCharacterRegistryStore.subscribe((state) => {
  clearFinishedDownloadEmoticonCaches(state.registry)
  notifyNewSyncFailures(state.registry)
  notifyFinishedDownloads(state.registry)
})

let unsubscribeDownloadProgress: (() => void) | null = null

/**
 * @description 订阅主进程角色下载进度推送并写入进度表。
 * @returns 无返回值。
 * @remarks 订阅仅创建一次并由本模块持续持有；进度表按角色 ID 分键，进度裁剪由
 *   setRegistry 随注册表快照统一处理。
 */
function ensureDownloadProgressSubscription(): void {
  if (unsubscribeDownloadProgress) {
    return
  }
  unsubscribeDownloadProgress = onCharacterDownloadProgress((progress) => {
    useCharacterRegistryStore.setState((current) => ({
      downloadProgress: { ...current.downloadProgress, [progress.characterId]: progress }
    }))
  })
}

ensureDownloadProgressSubscription()
