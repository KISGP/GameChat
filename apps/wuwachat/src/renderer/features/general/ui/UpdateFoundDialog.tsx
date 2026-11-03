import type { ReactElement } from 'react'
import { ArrowRightIcon } from 'lucide-react'
import { Button } from '@renderer/common/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from '@renderer/common/components/dialog'
import { formatDownloadSpeed } from '@renderer/features/general/lib/download-speed'
import { useAppSettingsStore } from '@renderer/store/app-settings'
import { useUpdateStore } from '@renderer/store/update'

/**
 * @description 渲染「当前版本 → 新版本」对照行，用强调色标记待安装版本。
 * @param props 当前版本号与目标版本号。
 * @returns 版本对照行元素。
 */
function VersionTransition({ from, to }: { from: string; to: string }): ReactElement {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-white/40">v{from}</span>
      <ArrowRightIcon className="size-3.5 shrink-0 text-white/25" aria-hidden="true" />
      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
        v{to}
      </span>
    </div>
  )
}

/**
 * @description 渲染应用级更新弹窗：发现新版本时询问是否下载，下载中显示进度与取消入口，完成后提供立即安装入口。
 * @returns 更新弹窗元素；当前阶段被忽略或延后时返回 null。
 */
export function UpdateFoundDialog(): ReactElement | null {
  const snapshot = useUpdateStore((state) => state.snapshot)
  const dismissedVersion = useAppSettingsStore((state) => state.settings.update.dismissedVersion)
  const installDeferredVersion = useUpdateStore((state) => state.installDeferredVersion)
  const deferInstall = useUpdateStore((state) => state.deferInstall)
  const updateUpdateCheckSettings = useAppSettingsStore((state) => state.updateUpdateCheckSettings)
  const startDownload = useUpdateStore((state) => state.startDownload)
  const cancelDownload = useUpdateStore((state) => state.cancelDownload)
  const install = useUpdateStore((state) => state.install)

  const phase = snapshot?.phase
  if (!snapshot || !phase) {
    return null
  }

  if (
    phase.status !== 'available' &&
    phase.status !== 'downloading' &&
    phase.status !== 'downloaded'
  ) {
    return null
  }

  const version = phase.version
  const releaseUrl = snapshot.releaseUrl

  /**
   * @description 记为忽略当前版本并关闭弹窗。
   */
  function dismiss(): void {
    void updateUpdateCheckSettings({ dismissedVersion: version })
  }

  /**
   * @description 在系统浏览器打开该版本的发布页。
   */
  function openReleasePage(): void {
    window.open(releaseUrl, '_blank', 'noopener,noreferrer')
  }

  const suppressed =
    phase.status === 'downloaded'
      ? installDeferredVersion === version
      : dismissedVersion === version
  if (suppressed) {
    return null
  }

  const versionRow = <VersionTransition from={snapshot.currentVersion} to={version} />

  if (phase.status === 'available') {
    return (
      <Dialog open onOpenChange={(open) => !open && dismiss()}>
        <DialogContent className="max-w-sm">
          <header className="flex flex-col gap-1 px-5 pt-4 pr-12 pb-3">
            <DialogTitle>发现新版本</DialogTitle>
            <DialogDescription>新版本已发布，是否现在下载更新？</DialogDescription>
          </header>
          <div className="flex flex-col gap-3 px-5 pb-4">
            {versionRow}
            <p className="text-xs text-white/35">下载完成后需要手动重启才会安装。</p>
          </div>
          <footer className="flex items-center justify-between gap-2 border-t border-white/10 bg-black/30 px-5 py-3">
            <Button size="sm" variant="ghost" onClick={openReleasePage}>
              查看更新内容
            </Button>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={dismiss}>
                忽略
              </Button>
              <Button size="sm" onClick={startDownload}>
                下载更新
              </Button>
            </div>
          </footer>
        </DialogContent>
      </Dialog>
    )
  }

  if (phase.status === 'downloading') {
    const speedText = formatDownloadSpeed(phase.speedBytesPerSecond)
    return (
      <Dialog open onOpenChange={(open) => !open && dismiss()}>
        <DialogContent className="max-w-sm">
          <header className="flex flex-col gap-1 px-5 pt-4 pr-12 pb-3">
            <DialogTitle>正在下载更新</DialogTitle>
            <DialogDescription>可以继续使用应用，下载在后台进行。</DialogDescription>
          </header>
          <div className="flex flex-col gap-3 px-5 pb-4">
            {versionRow}
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(phase.percent)}
              aria-label="更新下载进度"
              className="h-1.5 w-full overflow-hidden rounded-full bg-white/10"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-200"
                style={{ width: `${phase.percent}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs tabular-nums">
              <span className="text-white/35">{speedText || '正在连接…'}</span>
              <span className="text-white/70">{phase.percent.toFixed(0)}%</span>
            </div>
          </div>
          <footer className="flex items-center justify-end gap-2 border-t border-white/10 bg-black/30 px-5 py-3">
            <Button size="sm" variant="ghost" onClick={dismiss}>
              后台下载
            </Button>
            <Button size="sm" variant="quiet" onClick={cancelDownload}>
              取消下载
            </Button>
          </footer>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && deferInstall(version)}>
      <DialogContent className="max-w-sm">
        <header className="flex flex-col gap-1 px-5 pt-4 pr-12 pb-3">
          <DialogTitle>更新已就绪</DialogTitle>
          <DialogDescription>新版本已下载完成，重启后生效。</DialogDescription>
        </header>
        <div className="flex flex-col gap-3 px-5 pb-4">
          {versionRow}
          <p className="text-xs text-white/35">关闭软件不会自动安装，需要时请立即重启安装。</p>
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-white/10 bg-black/30 px-5 py-3">
          <Button size="sm" variant="ghost" onClick={() => deferInstall(version)}>
            稍后
          </Button>
          <Button size="sm" onClick={install}>
            立即重启并安装
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
