import { type ReactElement, type ReactNode } from 'react'
import { Switch } from '@renderer/common/components/switch'
import { Section } from '@renderer/common/components/Section'
import { SettingItem } from '@renderer/common/components/SettingItem'
import { Button } from '@renderer/common/components/button'
import { RingProgress } from '@renderer/common/components/ring-progress'
import { useAppSettingsStore } from '@renderer/store/app-settings'
import { useUpdateStore } from '@renderer/store/update'

/**
 * @description 渲染通用设置中的更新分组：当前版本、自动检查开关，以及承载全部更新阶段状态的检查更新行。
 * @returns 更新设置分组元素。
 */
export function UpdateSettings(): ReactElement {
  const snapshot = useUpdateStore((state) => state.snapshot)
  const checkNow = useUpdateStore((state) => state.checkNow)
  const startDownload = useUpdateStore((state) => state.startDownload)
  const cancelDownload = useUpdateStore((state) => state.cancelDownload)
  const install = useUpdateStore((state) => state.install)
  const autoCheck = useAppSettingsStore((state) => state.settings.update.autoCheck)
  const updateUpdateCheckSettings = useAppSettingsStore((state) => state.updateUpdateCheckSettings)

  const phase = snapshot?.phase
  const currentVersion = snapshot?.currentVersion
  const supported = snapshot?.supported ?? false

  /**
   * @description 在系统浏览器打开当前快照对应的发布页。
   */
  function openReleasePage(): void {
    if (!snapshot) {
      return
    }

    window.open(snapshot.releaseUrl, '_blank', 'noopener,noreferrer')
  }

  /**
   * @description 依据更新阶段渲染「检查更新」行标题下方的常显说明。
   * @returns 阶段说明文本；空闲或检查中等无可说明的阶段返回 undefined。
   * @remarks 下载中的进度由按钮内环形进度承载，不重复展示文字说明。
   */
  function renderPhaseDescription(): ReactNode {
    if (phase?.status === 'available') {
      return `发现新版本 v${phase.version}，下载需手动开始，完成后也要手动重启才会安装。`
    }
    if (phase?.status === 'downloaded') {
      return `更新 v${phase.version} 已就绪，点击「立即重启并安装」完成更新。`
    }
    if (phase?.status === 'error') {
      return phase.message
    }
    return undefined
  }

  /**
   * @description 依据更新阶段渲染「检查更新」行右侧操作控件。
   * @returns 阶段对应的操作控件。
   */
  function renderPhaseControls(): ReactNode {
    if (phase?.status === 'checking') {
      return (
        <Button size="sm" variant="quiet" disabled>
          检查中…
        </Button>
      )
    }

    if (phase?.status === 'available') {
      return (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={openReleasePage}>
            查看更新内容
          </Button>
          <Button size="sm" onClick={startDownload}>
            下载更新
          </Button>
        </div>
      )
    }

    if (phase?.status === 'downloading') {
      return (
        <div className="flex items-center gap-2">
          <Button size="sm" disabled>
            <RingProgress percent={phase.percent} />
            下载中...
          </Button>
          <Button size="sm" variant="ghost" onClick={cancelDownload}>
            取消
          </Button>
        </div>
      )
    }

    if (phase?.status === 'downloaded') {
      return (
        <Button size="sm" onClick={install}>
          立即重启并安装
        </Button>
      )
    }

    if (phase?.status === 'error') {
      return (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={openReleasePage}>
            打开发布页
          </Button>
          <Button size="sm" variant="quiet" onClick={() => void checkNow()}>
            重新检查
          </Button>
        </div>
      )
    }

    return (
      <Button
        size="sm"
        variant="quiet"
        disabled={!supported}
        onClick={() => void checkNow()}
      >
        检查
      </Button>
    )
  }

  return (
    <Section title="更新">
      <SettingItem title="当前版本">
        <span className="text-sm text-white/55">
          {currentVersion ? `v${currentVersion}` : '读取中…'}
        </span>
      </SettingItem>
      {supported ? null : (
        <SettingItem title="当前平台不支持应用内更新，请手动下载安装包">
          <Button size="sm" variant="quiet" onClick={openReleasePage}>
            打开发布页
          </Button>
        </SettingItem>
      )}
      <SettingItem title="自动检查更新">
        <Switch
          id="update-auto-check"
          checked={autoCheck}
          disabled={!supported}
          onCheckedChange={(enabled) => void updateUpdateCheckSettings({ autoCheck: enabled })}
        />
      </SettingItem>
      <SettingItem title="检查更新" description={renderPhaseDescription()}>
        {renderPhaseControls()}
      </SettingItem>
    </Section>
  )
}
