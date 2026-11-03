import { useState, type ReactElement } from 'react'
import { GachaUrlRequest } from '@gamechat/type'
import { toast } from 'sonner'
import { trackError, trackUiEvent } from '@renderer/app/telemetry'
import { Button } from '@renderer/common/components/button'
import { Card } from '@renderer/common/components/card'
import { Input } from '@renderer/common/components/input'
import { Textarea } from '@renderer/common/components/textarea'
import { SettingItem } from '@renderer/common/components/SettingItem'
import { getIpcErrorMessage } from '@renderer/common/lib/error-message'
import { getGachaUrl } from '@renderer/services/tools'

export function ToolsTab(): ReactElement {
  const [isLoading, setIsLoading] = useState(false)
  const [manualPath, setManualPath] = useState('')
  const [url, setUrl] = useState<string | null>(null)
  const [isManualOpen, setIsManualOpen] = useState(false)

  /**
   * @description 触发一次抽卡链接获取请求，结果经 toast 反馈，成功链接展示在结果卡片。
   * @param request 可选请求参数；为空时走自动扫描。
   * @returns 用于等待请求完成的 Promise。
   * @remarks 失败且需要手动路径时自动展开卡片折叠区露出手动输入框。
   */
  const runLookup = async (request?: GachaUrlRequest): Promise<void> => {
    try {
      setIsLoading(true)

      const nextResult = await getGachaUrl(request)

      if (nextResult.ok) {
        setUrl(nextResult.url)
        setManualPath('')
        toast.success(nextResult.message)
        return
      }

      setUrl(null)
      toast.error(nextResult.message)

      if (nextResult.requiresManualPath) {
        setIsManualOpen(true)
      }
    } catch (error) {
      trackError('resolve-gacha-url-failed', 'Failed to resolve gacha URL', error)
      setUrl(null)
      toast.error(getIpcErrorMessage(error))
      setIsManualOpen(true)
    } finally {
      setIsLoading(false)
    }
  }

  /**
   * @description 发起自动扫描请求。
   * @returns 用于等待请求完成的 Promise。
   */
  const handleAutoLookup = async (): Promise<void> => {
    trackUiEvent('tools-gacha-url-auto', 'User started automatic gacha URL lookup')
    await runLookup()
  }

  /**
   * @description 使用用户输入的安装目录重新尝试提取抽卡链接。
   * @returns 用于等待请求完成的 Promise。
   */
  const handleManualLookup = async (): Promise<void> => {
    const nextManualPath = manualPath.trim()

    if (!nextManualPath) {
      toast.error('请输入游戏安装目录后再重试。')
      return
    }

    trackUiEvent('tools-gacha-url-manual', 'User retried gacha URL lookup with a manual path', {
      pathLength: nextManualPath.length
    })
    await runLookup({ gamePath: nextManualPath })
  }

  return (
    <div className="px-4">
      <div className="space-y-3">
        <SettingItem
          title="抽卡链接"
          open={isManualOpen}
          onOpenChange={setIsManualOpen}
          expandedItems={[
            <p key="description" className="text-muted-foreground">
              自动扫描本机日志并提取鸣潮抽卡记录链接；如果自动获取失败，可以手动填写游戏安装目录重试。
            </p>,
            <div
              key="manual-path"
              className="flex flex-col gap-3 py-1.5 md:flex-row md:items-start"
            >
              <Input
                value={manualPath}
                onChange={(event) => setManualPath(event.target.value)}
                placeholder="例如：C:\\Wuthering Waves\\Wuthering Waves Game"
                className="flex-1"
              />
              <Button
                type="button"
                variant="quiet"
                className="md:self-start"
                disabled={isLoading}
                onClick={() => void handleManualLookup()}
              >
                {isLoading ? '重试中...' : '手动重试'}
              </Button>
            </div>
          ]}
        >
          <Button
            type="button"
            variant="quiet"
            disabled={isLoading}
            onClick={() => void handleAutoLookup()}
          >
            {isLoading ? '获取中...' : '获取链接'}
          </Button>
        </SettingItem>

        {url && (
          <Card className="p-4">
            <div className="mb-2 text-sm text-white/75">抽卡链接</div>
            <Textarea
              readOnly
              value={url}
              rows={4}
              className="resize-none border-white/10 bg-black/35 font-mono text-xs leading-5 text-white/90"
            />
          </Card>
        )}
      </div>
    </div>
  )
}
