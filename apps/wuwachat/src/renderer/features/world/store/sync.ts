import { WorldSyncProgress, WorldSyncResult } from '@gamechat/type'
import { toast } from 'sonner'
import { create } from 'zustand'
import { download, onDownloadProgress } from '@renderer/services/world'
import { trackError } from '@renderer/app/telemetry'

type WorldSyncStore = {
  phase: 'idle' | 'downloading'
  progress: WorldSyncProgress | null
  errorMessage: string
  startSync: () => Promise<WorldSyncResult | null>
}

let unsubscribeProgress: (() => void) | null = null

/**
 * @description 订阅应用级 world 下载进度，使进度状态不受设置 Tab 生命周期影响。
 * @returns 无返回值。
 * @remarks 订阅仅创建一次，并由应用进程持续持有。
 */
function ensureProgressSubscription(): void {
  if (unsubscribeProgress) {
    return
  }

  unsubscribeProgress = onDownloadProgress((progress) => {
    useWorldSyncStore.setState({ progress })
  })
}

export const useWorldSyncStore = create<WorldSyncStore>((set, get) => ({
  phase: 'idle',
  progress: null,
  errorMessage: '',
  /**
   * @description 启动一次 world 资料同步，同步完成时按结果以 toast 提示。
   * @returns 同步成功时返回携带最新状态的结果；已有同步流程进行中或同步失败时为 null。
   * @remarks 每次点击都真实执行同步，不按版本比较拦截；首次下载、版本变化与版本未变
   *   分别提示下载完成、更新完成与已是最新。失败信息经 toast 弹出并写入 errorMessage
   *   供悬浮查看，不向上抛出。主进程侧经 single-flight 合并并发触发。
   */
  startSync: async (): Promise<WorldSyncResult | null> => {
    if (get().phase !== 'idle') {
      return null
    }

    ensureProgressSubscription()
    set({ phase: 'downloading', progress: null, errorMessage: '' })
    try {
      const result = await download()
      if (result.outcome === 'downloaded') {
        toast.success('资料下载完成')
      } else if (result.outcome === 'updated') {
        toast.success('资料更新完成')
      } else {
        toast.success('资料已是最新')
      }
      return result
    } catch (error) {
      trackError('download-world-failed', 'Failed to download world data:', error)
      const message = error instanceof Error ? error.message : String(error)
      set({ errorMessage: message })
      toast.error(`资料操作失败：${message}`)
      return null
    } finally {
      set({ phase: 'idle' })
    }
  }
}))
