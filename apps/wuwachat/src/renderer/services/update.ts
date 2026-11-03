import { UpdaterSnapshot } from '@gamechat/type'

/**
 * @description 读取当前更新快照。
 * @returns 应用版本与更新阶段的 Promise。
 */
export function getUpdateState(): ReturnType<typeof window.update.getState> {
  return window.update.getState()
}

/**
 * @description 手动触发一次更新检查。
 * @returns 检查完成后的更新快照 Promise。
 */
export function checkForUpdate(): ReturnType<typeof window.update.check> {
  return window.update.check()
}

/**
 * @description 下载已发现的新版本安装包。
 * @returns 下载完成后的更新快照 Promise。
 */
export function downloadUpdate(): ReturnType<typeof window.update.download> {
  return window.update.download()
}

/**
 * @description 取消进行中的更新下载。
 * @returns 取消请求发出时的更新快照 Promise。
 */
export function cancelUpdateDownload(): ReturnType<typeof window.update.cancel> {
  return window.update.cancel()
}

/**
 * @description 退出应用并安装已下载的更新。
 * @returns 安装流程启动后的 Promise。
 */
export function installUpdate(): ReturnType<typeof window.update.install> {
  return window.update.install()
}

/**
 * @description 订阅主进程推送的更新状态快照。
 * @param listener 接收更新快照的回调。
 * @returns 用于取消订阅的清理函数。
 */
export function onUpdateState(
  listener: (snapshot: UpdaterSnapshot) => void
): ReturnType<typeof window.update.onState> {
  return window.update.onState(listener)
}
