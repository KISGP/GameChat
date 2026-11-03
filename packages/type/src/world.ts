export type WorldPackageFile = {
  path: string
  url: string
  sizeBytes: number
}

export type WorldManifest = {
  version: string
  downloadedAt: string
  files: WorldPackageFile[]
  totalBytes: number
}

export type WorldSyncStatus = {
  rootPath: string
  installed: boolean
  localManifest: WorldManifest | null
  remoteVersion: string | null
  updateAvailable: boolean | null
}

export type WorldSyncResult = WorldSyncStatus & {
  outcome: 'downloaded' | 'updated' | 'unchanged'
}

export type WorldSyncProgress = {
  receivedBytes: number
  totalBytes: number | null
}
