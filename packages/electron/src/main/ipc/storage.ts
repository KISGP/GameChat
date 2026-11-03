import { getStorageUsageSnapshot, openStorageLocation } from '../storage/index'
import type { StorageLocationTarget } from '@gamechat/type'
import { handleLogged } from './logged-handler'

/**
 * @description 注册应用存储分析相关 IPC handler。
 */
export function registerStorageIpc(): void {
  handleLogged('storage:getUsage', (_event, refresh?: boolean) =>
    getStorageUsageSnapshot(refresh === true)
  )
  handleLogged('storage:openLocation', (_event, target: StorageLocationTarget) =>
    openStorageLocation(target)
  )
}
