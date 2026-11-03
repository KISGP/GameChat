import { WorldSyncProgress } from '@gamechat/type'
/**
 * @description 读取 World 资料同步状态。
 * @returns 当前资料版本和同步状态的 Promise。
 */
export function getWorldStatus(): ReturnType<typeof window.world.getStatus> {
  return window.world.getStatus()
}
/**
 * @description 下载 World 资料更新。
 * @returns 下载结果的 Promise。
 */
export function download(): ReturnType<typeof window.world.download> {
  return window.world.download()
}
/**
 * @description 订阅 World 资料下载进度。
 * @param listener 接收下载进度快照的回调。
 * @returns 用于取消订阅的清理函数。
 * @remarks 调用方应在不再显示进度时执行返回的清理函数。
 */
export function onDownloadProgress(
  listener: (progress: WorldSyncProgress) => void
): ReturnType<typeof window.world.onDownloadProgress> {
  return window.world.onDownloadProgress(listener)
}
