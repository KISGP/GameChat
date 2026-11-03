/**
 * @description 角色注册表装配：本地记录、远端索引与下载队列状态合成完整注册表。
 * @remarks 角色图片统一以媒体协议 URL 表达：本地角色路径来自 info.json 记录，
 *   未安装的远端角色由协议侧按需经来源链取图并落盘缓存；装配与广播不携带图片字节。
 */
import type {
  CharacterRegistry,
  CharacterSyncStatus,
  LocalCharacterEntry,
  RemoteCharacterEntry
} from '@gamechat/type'
import { pickDisplayText } from './mappers'
import { getCharacterMediaUrl, getRemoteCharacterMediaUrl } from '@gamechat/schema'
import type { LocalCharacterRecord, QueueRuntimeState, RemoteCharacterRecord } from './types'

/**
 * @description 根据本地记录与远端索引构建角色注册表。
 * @param records 本地角色记录。
 * @param remoteRecords 远端索引缓存中的角色记录。
 * @param state 当前下载队列与整表同步状态。
 * @returns 完整角色注册表快照。
 */
export function buildRegistry(
  records: LocalCharacterRecord[],
  remoteRecords: RemoteCharacterRecord[],
  state: QueueRuntimeState
): CharacterRegistry {
  const localIds = new Set(records.map((record) => record.info.id))
  const local: LocalCharacterEntry[] = records.map((record) => {
    const remote = remoteRecords.find((item) => item.id === record.info.id)
    const updateAvailable = Boolean(
      record.info.source === 'preset' &&
        remote?.updateAt &&
        record.info.updateAt !== remote.updateAt
    )
    const syncState = state.syncingIds.has(record.info.id)
      ? ('downloading' as const)
      : state.queuedIds.has(record.info.id)
        ? ('queued' as const)
        : undefined
    const syncStatus: CharacterSyncStatus | undefined =
      updateAvailable || syncState || record.info.remoteUnavailable || record.info.syncError
        ? {
            ...(updateAvailable ? { updateAvailable: true } : {}),
            ...(syncState ? { syncState } : {}),
            remoteUnavailable: Boolean(record.info.remoteUnavailable),
            ...(record.info.syncError ? { syncError: record.info.syncError } : {})
          }
        : undefined
    return {
      id: record.info.id,
      name: record.name,
      description: record.description,
      information: record.information || undefined,
      avatar: getCharacterMediaUrl(record.info.id, record.info.avatar),
      cardBg: getCharacterMediaUrl(record.info.id, record.info.cardBg),
      pixActivity: getCharacterMediaUrl(record.info.id, record.info.pixActivity),
      rolePile: getCharacterMediaUrl(record.info.id, record.info.rolePile),
      source: record.info.source,
      visible: record.visible,
      settings: record.settings,
      ttsFishPreset: record.info.tts?.fish,
      syncStatus
    }
  })
  const remote: RemoteCharacterEntry[] = remoteRecords
    .filter((item) => !localIds.has(item.id))
    .map((item) => ({
      id: item.id,
      name: pickDisplayText(item.name, item.id),
      description: pickDisplayText(item.description) || undefined,
      information: pickDisplayText(item.information) || undefined,
      avatar: getRemoteCharacterMediaUrl(item.id, 'avatar'),
      cardBg: getRemoteCharacterMediaUrl(item.id, 'cardBg'),
      pixActivity: getRemoteCharacterMediaUrl(item.id, 'pixActivity'),
      rolePile: getRemoteCharacterMediaUrl(item.id, 'rolePile'),
      updateAt: item.updateAt,
      syncState: state.syncingIds.has(item.id)
        ? 'downloading'
        : state.queuedIds.has(item.id)
          ? 'queued'
          : item.syncError
            ? 'failed'
            : undefined,
      syncError: item.syncError
    }))
  return {
    local,
    remote,
    refreshedAt: null,
    isSyncing: state.isSyncing,
    syncError: state.syncError || undefined
  }
}
