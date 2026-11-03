import { StorageLocationTarget } from '@gamechat/type'

/**
 * @description 读取本地应用存储用量。
 * @param refresh 为 true 时让主进程绕过缓存重新扫描。
 * @returns 本地应用数据占用信息的 Promise。
 */
export function getUsage(refresh = false): ReturnType<typeof window.storage.getUsage> {
  return window.storage.getUsage(refresh)
}

/**
 * @description 请求主进程在系统资源管理器中打开存储页指定目录。
 * @param target 目录位置目标，真实路径由主进程按枚举解析。
 * @returns 打开完成的 Promise，打开失败时以错误拒绝。
 */
export function openLocation(target: StorageLocationTarget): Promise<void> {
  return window.storage.openLocation(target)
}
