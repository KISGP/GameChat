import { useEffect, useState, type ReactElement } from 'react'
import { toast } from 'sonner'
import { CircleAlert } from 'lucide-react'
import { WorldSyncStatus } from '@gamechat/type'
import { SettingItem } from '@renderer/common/components/SettingItem'
import { Button } from '@renderer/common/components/button'
import { RingProgress } from '@renderer/common/components/ring-progress'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/common/components/tooltip'
import { useWorldSyncStore } from '@renderer/features/world/store/sync'
import { Spinner } from '@renderer/common/components/spinner'
import { getWorldStatus } from '@renderer/services/world'
import { trackError } from '@renderer/app/telemetry'
import { getIpcErrorMessage } from '@renderer/common/lib/error-message'

/**
 * @description 渲染 world 资料下载页面。
 * @returns 资料设置 Tab 内容。
 */
export function WorldTab(): ReactElement {
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<WorldSyncStatus | null>(null)
  const { phase, progress, errorMessage, startSync } = useWorldSyncStore()
  const downloadPercent =
    progress && progress.totalBytes !== null && progress.totalBytes > 0
      ? Math.min(100, Math.round((progress.receivedBytes / progress.totalBytes) * 100))
      : null

  /**
   * @description 执行一次资料同步，并用同步结果刷新本地状态展示。
   * @returns 无返回值。
   * @remarks 同步失败时 store 已记录错误信息，此处保持原状态不变。
   */
  async function handleSync(): Promise<void> {
    const result = await startSync()
    if (result) {
      setStatus(result)
    }
  }

  useEffect(() => {
    /**
     * @description 读取本地 world 资料状态初始化页面。
     */
    const loadStatus = async (): Promise<void> => {
      try {
        setLoading(true)
        setStatus(await getWorldStatus())
      } catch (error) {
        trackError('load-world-status-failed', 'Failed to load world status:', error)
        toast.error(getIpcErrorMessage(error))
      } finally {
        setLoading(false)
      }
    }
    void loadStatus()
  }, [])

  return (
    <div className="mx-auto h-full overflow-y-auto px-4 pb-4">
      <SettingItem
        title="背景资料"
        expandedItems={[
          <p key="description" className="text-muted-foreground">
            下载或更新 WuWaChatWorld 的远端资料。
          </p>
        ]}
      >
        <div className="flex items-center gap-2">
          {errorMessage && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger render={<span className="flex" />}>
                  <CircleAlert className="size-4 text-red-300" aria-hidden="true" />
                </TooltipTrigger>
                <TooltipContent>资料操作失败：{errorMessage}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <Button
            variant="primary"
            onClick={() => void handleSync()}
            disabled={loading || phase !== 'idle'}
          >
            {loading && <Spinner className="size-4" />}
            {!loading && phase === 'downloading' && <RingProgress percent={downloadPercent} />}
            {loading
              ? '读取状态...'
              : phase === 'downloading'
                ? '下载中...'
                : status?.installed
                  ? '更新'
                  : '下载资料'}
          </Button>
        </div>
      </SettingItem>
    </div>
  )
}
