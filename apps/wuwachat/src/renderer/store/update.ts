import { create } from 'zustand'
import { toast } from 'sonner'
import { UpdaterSnapshot } from '@gamechat/type'
import {
  cancelUpdateDownload,
  checkForUpdate,
  downloadUpdate,
  getUpdateState,
  installUpdate,
  onUpdateState
} from '@renderer/services/update'
import { trackError, trackUiEvent } from '@renderer/app/telemetry'
import { getIpcErrorMessage } from '@renderer/common/lib/error-message'

type UpdateStore = {
  /** 最近一次主进程推送的更新快照；启动同步完成前为 null。 */
  snapshot: UpdaterSnapshot | null
  /** 启动时拉取一次快照并订阅主进程推送；进程内只需调用一次。 */
  initialize: () => void
  /** 手动触发更新检查，结果以 toast 反馈。 */
  checkNow: () => Promise<void>
  /** 下载已发现的新版本；进度与结果经广播快照驱动界面。 */
  startDownload: () => void
  /** 取消进行中的下载；阶段由主进程广播回落到 available。 */
  cancelDownload: () => void
  /** 退出应用并安装已下载的更新，失败以 toast 反馈。 */
  install: () => void
  /** 本次会话内被用户延后安装提醒的版本号；跨启动不保留。 */
  installDeferredVersion: string | null
  /** 延后指定版本的安装提醒，本次会话内不再弹出已就绪弹窗。 */
  deferInstall: (version: string) => void
}

let unsubscribeState: (() => void) | null = null
let previousPhaseStatus: UpdaterSnapshot['phase']['status'] | null = null

/**
 * @description 订阅主进程更新状态推送并维护跨阶段提示。
 * @remarks 订阅仅创建一次；下载完成在订阅层统一 toast（附立即安装入口），下载失败由发起方的
 *   reject 提示，界面组件只负责展示快照。
 */
function ensureStateSubscription(): void {
  if (unsubscribeState) {
    return
  }

  unsubscribeState = onUpdateState((snapshot) => {
    const status = snapshot.phase.status
    if (previousPhaseStatus === 'downloading' && status === 'downloaded') {
      toast.success(`新版本 v${snapshot.phase.version} 已下载，可立即重启安装。`, {
        action: { label: '立即安装', onClick: () => useUpdateStore.getState().install() }
      })
    }
    if (previousPhaseStatus === 'downloading' && status === 'error') {
      toast.error(`更新下载失败：${snapshot.phase.message}`)
    }
    previousPhaseStatus = status
    useUpdateStore.setState({ snapshot })
  })
}

export const useUpdateStore = create<UpdateStore>((set) => ({
  snapshot: null,
  installDeferredVersion: null,
  deferInstall: (version) => {
    set({ installDeferredVersion: version })
  },
  initialize: () => {
    ensureStateSubscription()
    void getUpdateState()
      .then((snapshot) => {
        previousPhaseStatus = snapshot.phase.status
        set({ snapshot })
      })
      .catch((error) => {
        trackError('update-state-load-failed', getIpcErrorMessage(error), error)
      })
  },
  checkNow: async () => {
    trackUiEvent('update-check-triggered', 'User triggered an update check', {})
    try {
      const snapshot = await checkForUpdate()
      set({ snapshot })
      if (snapshot.phase.status === 'idle') {
        toast.info(`当前已是最新版本（v${snapshot.currentVersion}）。`)
      }
    } catch (error) {
      toast.error(getIpcErrorMessage(error))
    }
  },
  startDownload: () => {
    void downloadUpdate().catch((error) => {
      toast.error(getIpcErrorMessage(error))
    })
  },
  cancelDownload: () => {
    trackUiEvent('update-download-cancelled', 'User cancelled an update download', {})
    void cancelUpdateDownload()
      .then((snapshot) => {
        set({ snapshot })
      })
      .catch((error) => {
        trackError('update-download-cancel-failed', getIpcErrorMessage(error), error)
      })
  },
  install: () => {
    void installUpdate().catch((error) => {
      toast.error(getIpcErrorMessage(error))
    })
  }
}))
