/**
 * @description 角色同步编排：整表同步（single-flight）、FIFO 下载队列、取消与应用退出关停。
 * @remarks 经 {@link createCharacterSyncService} 构造；全部状态闭包在实例内，模块导入零副作用。
 *   下载基于远端当前状态：任务先刷新两级索引缓存，再按最新条目下载文件并推导本地 info.json，
 *   不依赖可能过期的持久化快照。
 */
import { rm } from 'fs/promises'
import { join } from 'path'
import type { CharacterDownloadProgress, CharacterRegistry } from '@gamechat/type'
import { createSerialQueue, createSingleFlight } from '../../infra'
import {
  describeGithubAttemptFailure,
  formatGithubChainError,
  type GithubRequestContext
} from '../../infra/github'
import { pickDisplayText } from '../mappers'
import type {
  LocalCharacterInfo,
  LocalCharacterRecord,
  QueueRuntimeState,
  RemoteCharacterRecord
} from '../types'
import { fetchRemoteBuffer, type RemoteClientDeps } from '../remote/client'
import { createRemoteIndexCache, type RemoteIndexCache } from '../remote/cache'
import { createLocalCharacterInfo, writeCharacterFiles, type RemoteCharacterBundle } from './writer'
import { buildRegistry } from '../registry'

/** 同步服务的本地角色依赖。 */
export type CharacterSyncLocalDeps = {
  /** 加载全部本地角色记录。 */
  loadRecords: () => Promise<LocalCharacterRecord[]>
  /** 读取单个角色的本地信息文档。 */
  readInfo: (characterId: string) => Promise<LocalCharacterInfo | null>
  /** 写入单个角色的本地信息文档。 */
  writeInfo: (characterId: string, info: LocalCharacterInfo) => Promise<void>
}

/** 同步服务的宿主依赖。 */
export type CharacterSyncDeps = RemoteClientDeps & {
  /** 应用数据根目录。 */
  appDataRoot: string
  /** 本地角色依赖。 */
  local: CharacterSyncLocalDeps
  /** 构造本次操作的 GitHub 来源链上下文。 */
  createGithubContext: () => Promise<GithubRequestContext>
  /** 注册表变更广播。 */
  onRegistryChanged: (registry: CharacterRegistry) => void
  /** 远端预览缓存失效：整表同步成功后调用，使协议侧按需重新取图。 */
  onRemoteMediaInvalidated: () => void
  /** 角色下载字节进度推送；仅在下载任务进行中回调，总字节数未知时为 null。 */
  onDownloadProgress?: (progress: CharacterDownloadProgress) => void
}

/** 单个角色下载任务的取消句柄，覆盖排队与在飞两个阶段。 */
type DownloadCancelHandle = {
  /** 撤出未开始的任务或中止在飞请求；返回 true 表示任务尚未开始即被撤出。 */
  cancel: () => boolean
  /** 任务完整落定后的 Promise；任务失败已由内部记录，仅用于取消方等待落定。 */
  settled: Promise<void>
}

/** 角色同步服务。 */
export type CharacterSyncService = {
  /** 返回当前下载与整表同步状态。 */
  getQueueState: () => QueueRuntimeState
  /** 启动或复用一次后台整表同步（single-flight）。 */
  synchronize: () => Promise<CharacterRegistry>
  /** 返回包含当前同步状态的注册表；同步进行中时复用同步任务。 */
  getSyncedRegistry: () => Promise<CharacterRegistry>
  /** 将一个远端角色加入 FIFO 下载或更新队列。 */
  queueDownload: (id: string) => Promise<CharacterRegistry>
  /** 取消尚未开始或已在飞的角色下载任务，并等待在飞任务完整落定。 */
  cancelDownload: (id: string) => Promise<CharacterRegistry>
  /** 取消全部未开始任务并中止在飞请求，供应用退出链调用。 */
  shutdown: () => void
  /** 构建当前注册表并按需广播。 */
  buildAndPublish: () => Promise<CharacterRegistry>
  /** 远端索引缓存句柄（供协议预览路由查询条目）。 */
  remoteCache: RemoteIndexCache
}

/**
 * @description 携带失败资源标签的角色远端文件获取错误。
 * @remarks 仅在角色域内使用；original 保留底层异常（可能是来源链聚合错误）供归因格式化。
 */
class CharacterResourceError extends Error {
  readonly resourceLabel: string
  readonly original: unknown

  /**
   * @description 创建带资源标签的获取错误。
   * @param resourceLabel 失败资源的中文展示名。
   * @param original 底层抛出的原始异常。
   */
  constructor(resourceLabel: string, original: unknown) {
    super(`Failed to fetch character resource: ${resourceLabel}`)
    this.name = 'CharacterResourceError'
    this.resourceLabel = resourceLabel
    this.original = original
  }
}

/**
 * @description 创建角色同步服务实例。
 * @param deps 宿主依赖：仓库定位、数据根目录、本地角色依赖、来源链上下文构造与广播出口。
 * @returns 同步服务实例。
 */
export function createCharacterSyncService(deps: CharacterSyncDeps): CharacterSyncService {
  const syncingIds = new Set<string>()
  const queuedIds = new Set<string>()
  const cancelHandles = new Map<string, DownloadCancelHandle>()
  const downloadQueue = createSerialQueue()
  const syncFlight = createSingleFlight<CharacterRegistry>()
  const remoteCache = createRemoteIndexCache(deps)
  let lastSyncError = ''
  let activeSync: Promise<CharacterRegistry> | null = null

  /**
   * @description 返回当前下载与整表同步状态。
   * @returns 队列运行态快照。
   */
  function getQueueState(): QueueRuntimeState {
    return {
      syncingIds,
      queuedIds,
      isSyncing: syncFlight.isRunning(),
      syncError: lastSyncError
    }
  }

  /**
   * @description 构建当前注册表并广播。
   * @returns 注册表快照。
   */
  async function buildAndPublish(): Promise<CharacterRegistry> {
    const registry = buildRegistry(
      await deps.local.loadRecords(),
      remoteCache.get(),
      getQueueState()
    )
    registry.refreshedAt = remoteCache.getRefreshedAt()
    deps.onRegistryChanged(registry)
    return registry
  }

  /**
   * @description 拉取一个远端角色文件，失败时包装为带资源标签的错误。
   * @param resourceLabel 失败时用于归因的资源中文名。
   * @param repositoryPath 仓库相对路径。
   * @param context 本次操作固定使用的 GitHub 来源。
   * @param signal 取消信号。
   * @param onProgress 可选的字节进度回调。
   * @returns 文件二进制内容。
   */
  async function fetchLabeledRemoteBuffer(
    resourceLabel: string,
    repositoryPath: string,
    context: GithubRequestContext,
    signal?: AbortSignal,
    onProgress?: (receivedBytes: number, totalBytes: number | null) => void
  ): Promise<Buffer> {
    try {
      return await fetchRemoteBuffer(deps, repositoryPath, context, signal, onProgress)
    } catch (error) {
      throw new CharacterResourceError(resourceLabel, error)
    }
  }

  /**
   * @description 把角色下载异常格式化为可直接展示的中文归因文本。
   * @param entry 失败的远端角色条目；索引缓存被清空等异常情况下可能缺失。
   * @param error 下载过程中抛出的异常。
   * @returns 形如「下载角色「名」失败：头像获取失败（已尝试全部来源（…））」的文本。
   */
  function formatCharacterSyncError(
    entry: RemoteCharacterRecord | undefined,
    error: unknown
  ): string {
    const name = entry ? pickDisplayText(entry.name, entry.id) : '未知角色'
    if (error instanceof CharacterResourceError) {
      const detail = formatGithubChainError(error.original) ?? describeGithubAttemptFailure(error.original)
      return `下载角色「${name}」失败：${error.resourceLabel}获取失败（${detail}）`
    }
    const detail = formatGithubChainError(error) ?? describeGithubAttemptFailure(error)
    return `下载角色「${name}」失败：${detail}`
  }

  /**
   * @description 拉取一个角色的全部远端文件。
   * @param entry 远端索引条目。
   * @param context 本次操作固定使用的 GitHub 来源。
   * @param signal 取消信号。
   * @param onProgress 可选的整体字节进度回调；进度按文件聚合，总字节数取已到达响应的
   *   content-length 之和，存在未报告总量的并发文件时为 null。
   * @returns 内存中的角色文件集；角色未配置语音线时 voice 为 null。
   * @remarks 更新即全量重拉：角色更新频率低，不做逐文件差异判断；参考音色取索引语音线第一条。
   */
  async function fetchCharacterBundle(
    entry: RemoteCharacterRecord,
    context: GithubRequestContext,
    signal?: AbortSignal,
    onProgress?: (receivedBytes: number, totalBytes: number | null) => void
  ): Promise<RemoteCharacterBundle> {
    // 按文件键记录字节进度；并发文件齐全前总量未知，环以自转态表达。
    const fileStates = new Map<string, { receivedBytes: number; totalBytes: number | null }>()
    const report = onProgress
      ? (key: string, receivedBytes: number, totalBytes: number | null) => {
          fileStates.set(key, { receivedBytes, totalBytes })
          let totalReceived = 0
          let totalBytesSum = 0
          let totalKnown = true
          for (const state of fileStates.values()) {
            totalReceived += state.receivedBytes
            if (state.totalBytes === null) {
              totalKnown = false
            } else {
              totalBytesSum += state.totalBytes
            }
          }
          onProgress(totalReceived, totalKnown ? totalBytesSum : null)
        }
      : () => undefined

    const [promptBuffer, avatar, cardBg, pixActivity, rolePile] = await Promise.all([
      fetchLabeledRemoteBuffer(
        'Prompt 文件',
        entry.prompt,
        context,
        signal,
        (receivedBytes, totalBytes) => report('prompt', receivedBytes, totalBytes)
      ),
      fetchLabeledRemoteBuffer(
        '头像',
        entry.avatar,
        context,
        signal,
        (receivedBytes, totalBytes) => report('avatar', receivedBytes, totalBytes)
      ),
      fetchLabeledRemoteBuffer(
        '卡面',
        entry.cardBg,
        context,
        signal,
        (receivedBytes, totalBytes) => report('cardBg', receivedBytes, totalBytes)
      ),
      fetchLabeledRemoteBuffer(
        '活动立绘',
        entry.pixActivity,
        context,
        signal,
        (receivedBytes, totalBytes) => report('pixActivity', receivedBytes, totalBytes)
      ),
      fetchLabeledRemoteBuffer(
        '立牌图标',
        entry.rolePile,
        context,
        signal,
        (receivedBytes, totalBytes) => report('rolePile', receivedBytes, totalBytes)
      )
    ])
    const voice = entry.voices[0] ?? null
    const voiceContent = voice
      ? await fetchLabeledRemoteBuffer(
          `语音「${voice.label}」`,
          `${entry.id}/${voice.file}`,
          context,
          signal,
          (receivedBytes, totalBytes) => report('voice', receivedBytes, totalBytes)
        )
      : null
    const emoticons = await Promise.all(
      entry.emoticons.map(async (definition) => ({
        definition,
        content: await fetchLabeledRemoteBuffer(
          `表情「${definition.id}」`,
          `${entry.id}/emoticons/${definition.file}`,
          context,
          signal,
          (receivedBytes, totalBytes) => report(`emoticon:${definition.id}`, receivedBytes, totalBytes)
        )
      }))
    )
    return {
      prompt: promptBuffer.toString('utf-8'),
      avatar,
      cardBg,
      pixActivity,
      rolePile,
      voice: voiceContent,
      emoticons
    }
  }

  /**
   * @description 执行一个排队角色的下载或更新。
   * @param id 远端角色标识。
   * @param signal 取消信号。
   * @returns 任务完成后的 Promise。
   * @remarks 逐文件原子写入、info.json 最后提交；settings.json 永不在写入集合；
   *   失败记录在索引缓存中并可重试；主动取消不记为失败。
   */
  async function runQueuedCharacterUpdate(id: string, signal: AbortSignal): Promise<void> {
    queuedIds.delete(id)
    syncingIds.add(id)
    await buildAndPublish()
    try {
      const context = await deps.createGithubContext()
      const document = await remoteCache.refresh(context)
      const entry = document.characters.find((item) => item.id === id)
      if (!entry) throw new Error(`Remote character not found: ${id}`)
      const local = await deps.local.readInfo(id)
      if (local?.source === 'custom') return
      const bundle = await fetchCharacterBundle(entry, context, signal, (receivedBytes, totalBytes) =>
        deps.onDownloadProgress?.({ characterId: id, receivedBytes, totalBytes })
      )
      const info = {
        ...createLocalCharacterInfo(entry, local?.source ?? 'preset'),
        remoteUnavailable: false
      }
      await writeCharacterFiles(deps.appDataRoot, id, info, bundle)
      delete entry.syncError
    } catch (error) {
      if (signal.aborted) {
        return
      }
      const entry = remoteCache.get().find((item) => item.id === id)
      const message = formatCharacterSyncError(entry, error)
      if (entry) entry.syncError = message
      void deps.log.warn('characters', 'character-sync-failed', 'Failed to synchronize character', {
        characterId: id,
        error: error instanceof Error ? error.message : String(error)
      })
    } finally {
      cancelHandles.delete(id)
      syncingIds.delete(id)
      await remoteCache.write()
      await buildAndPublish()
    }
  }

  /**
   * @description 同步远端索引，并对已安装预设角色标记/清除远端不可用状态。
   * @returns 同步后的注册表。
   * @remarks 索引刷新成功后清空远端预览图磁盘缓存，并通知协议层失效按键缓存，
   *   使协议侧按需重新取图，避免素材更新后界面长期陈旧。
   */
  async function runSync(): Promise<CharacterRegistry> {
    const context = await deps.createGithubContext()
    const document = await remoteCache.refresh(context)
    await markRemoteAvailability(document.characters, new Set([...syncingIds, ...queuedIds]))
    await rm(join(deps.appDataRoot, 'remote-images'), { recursive: true, force: true })
    deps.onRemoteMediaInvalidated()
    return buildAndPublish()
  }

  /**
   * @description 对已安装预设角色标记/清除远端不可用状态。
   * @param entries 本次拉取到的远端角色记录。
   * @param busyIds 正在排队或下载中的角色标识集合。
   * @returns 无返回值。
   * @remarks 角色重新出现在索引中时自动清除标记；排队或下载中的角色 info.json 即将被
   *   下载任务整体重写，跳过标记避免并发写回旧内容。
   */
  async function markRemoteAvailability(
    entries: RemoteCharacterRecord[],
    busyIds: ReadonlySet<string>
  ): Promise<void> {
    const availableIds = new Set(entries.map((entry) => entry.id))
    const installed = await deps.local.loadRecords()
    await Promise.all(
      installed
        .filter((record) => record.info.source === 'preset')
        .filter((record) => !busyIds.has(record.info.id))
        .filter(
          (record) => availableIds.has(record.info.id) !== Boolean(record.info.remoteUnavailable)
        )
        .map(async (record) => {
          const next = { ...record.info }
          if (availableIds.has(record.info.id)) delete next.remoteUnavailable
          else next.remoteUnavailable = true
          await deps.local.writeInfo(record.info.id, next)
        })
    )
  }

  return {
    getQueueState,

    synchronize: () => {
      const flight = syncFlight.run(async () => {
        try {
          lastSyncError = ''
          const registry = await runSync()
          const finalRegistry = { ...registry, isSyncing: false }
          deps.onRegistryChanged(finalRegistry)
          return finalRegistry
        } catch (error) {
          lastSyncError = `获取角色索引失败：${
            formatGithubChainError(error) ?? describeGithubAttemptFailure(error)
          }`
          void deps.log.warn(
            'characters',
            'character-sync-run-failed',
            'Failed to synchronize character registry',
            { error: error instanceof Error ? error.message : String(error) }
          )
          return buildAndPublish()
        }
      })
      activeSync = flight
      void flight.catch(() => undefined).finally(() => {
        if (activeSync === flight) activeSync = null
      })
      return flight
    },

    getSyncedRegistry: async () => {
      await remoteCache.ensureLoaded()
      return activeSync ?? buildAndPublish()
    },

    queueDownload: async (id) => {
      await remoteCache.ensureLoaded()
      const entry = remoteCache.get().find((item) => item.id === id)
      if (!entry) throw new Error(`Remote character not found: ${id}`)
      if (!syncingIds.has(id) && !queuedIds.has(id)) {
        queuedIds.add(id)
        const controller = new AbortController()
        const { promise, cancel } = downloadQueue.enqueue(() =>
          runQueuedCharacterUpdate(id, controller.signal)
        )
        cancelHandles.set(id, {
          cancel: () => {
            const prevented = cancel()
            if (!prevented) controller.abort()
            return prevented
          },
          settled: promise
        })
        promise.catch(() => undefined)
      }
      return buildAndPublish()
    },

    cancelDownload: async (id) => {
      const wasQueued = queuedIds.delete(id)
      const handle = cancelHandles.get(id)
      cancelHandles.delete(id)
      if (handle) {
        const prevented = handle.cancel()
        if (!prevented) {
          // 在飞任务被中止后等待其完整落定，保证本函数返回后不再有该角色的写盘动作。
          await handle.settled.catch(async (error: unknown) => {
            await deps.log.warn(
              'characters',
              'character-download-settle-failed',
              'Cancelled character download task rejected while settling',
              {
                characterId: id,
                error: error instanceof Error ? error.message : String(error)
              }
            )
          })
        }
      }
      if (wasQueued) return buildAndPublish()
      return buildRegistry(await deps.local.loadRecords(), remoteCache.get(), getQueueState())
    },

    shutdown: () => {
      const pendingIds = [...cancelHandles.keys()]
      pendingIds.forEach((id) => cancelHandles.get(id)?.cancel())
      cancelHandles.clear()
      queuedIds.clear()
    },

    buildAndPublish,

    remoteCache
  }
}
