export type StorageCategoryId =
  | 'sessions'
  | 'characters'
  | 'world'
  | 'logs'
  | 'settings'
  | 'cache'
  | 'other'

export type StorageUsageItem = {
  id: StorageCategoryId
  label: string
  sizeBytes: number
  path: string
  description: string
}

/**
 * @description 存储页可打开目录的目标枚举，主进程据此解析真实路径，renderer 不传任意路径。
 */
export type StorageLocationTarget = 'data-root' | 'user-data' | 'install'

export type StorageUsageSnapshot = {
  rootPath: string
  // userData 根目录，应用数据根目录的父目录
  userDataPath: string
  // 应用可执行文件所在目录，打包版即安装目录
  installPath: string
  totalBytes: number
  scannedAt: string
  items: StorageUsageItem[]
}
