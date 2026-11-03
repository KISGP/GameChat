/** 更新状态推送通道，主进程经 broadcast 推送完整快照。 */
export const UPDATER_STATE_CHANNEL = 'update:state'

/** 更新流程阶段。 */
export type UpdaterPhase =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | {
      status: 'downloading'
      version: string
      /** 下载进度百分比，0 到 100。 */
      percent: number
      /** 当前下载速度，字节每秒。 */
      speedBytesPerSecond: number
    }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; message: string }

/** 更新状态快照：渲染层更新界面的唯一事实来源。 */
export type UpdaterSnapshot = {
  /** 当前安装版的应用版本号。 */
  currentVersion: string
  /** 当前运行环境是否具备自动更新能力；不具备时更新流程整域不可用。 */
  supported: boolean
  /** 发布页地址；快照带目标版本时指向该 tag，否则指向发布列表。 */
  releaseUrl: string
  phase: UpdaterPhase
}
