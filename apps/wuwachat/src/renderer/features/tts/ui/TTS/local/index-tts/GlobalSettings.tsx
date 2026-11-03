import { useState, type ReactElement } from 'react'
import { toast } from 'sonner'
import { PlugZap } from 'lucide-react'
import { Input } from '@renderer/common/components/input'
import { Button } from '@renderer/common/components/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/common/components/select'
import { LocalTtsEngine } from '@gamechat/type'
import { testLocalTtsConnection } from '@renderer/services/tts'
import { getIpcErrorMessage } from '@renderer/common/lib/error-message'

type IndexTtsGlobalSettingsProps = {
  settings: { engine: LocalTtsEngine; baseUrl: string }
  onEngineChange: (engine: LocalTtsEngine) => Promise<void>
  onChange: (patch: { baseUrl: string }) => Promise<void>
}

/**
 * @description 渲染 index-tts 的本地服务地址与连接测试控制。
 * @param props 当前 index-tts 配置和保存回调。
 * @returns index-tts 全局设置区域。
 */
export function IndexTtsGlobalSettings({
  settings,
  onEngineChange,
  onChange
}: IndexTtsGlobalSettingsProps): ReactElement {
  const [isTesting, setIsTesting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  /**
   * @description 请求主进程测试当前保存的 index-tts 服务地址。
   */
  const handleTestConnection = async (): Promise<void> => {
    setIsTesting(true)
    setNotice(null)
    try {
      const result = await testLocalTtsConnection()
      setNotice(result.message)
    } catch (testError) {
      toast.error(getIpcErrorMessage(testError))
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-xs text-white/55">本地引擎</span>
          <Select
            value={settings.engine}
            onValueChange={(value) => {
              if (value === 'index-tts') void onEngineChange(value)
            }}
          >
            <SelectTrigger className="h-10 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="index-tts">index-tts</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-xs text-white/55">index-tts 服务地址</span>
          <Input
            value={settings.baseUrl}
            onChange={(event) => void onChange({ baseUrl: event.currentTarget.value })}
            placeholder="http://127.0.0.1:7860"
            inputMode="url"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <Button
          variant="brand"
          onClick={() => void handleTestConnection()}
          disabled={isTesting}
          className="border-primary/45 bg-primary/8 hover:border-primary/75 hover:bg-primary/16 gap-1.5 px-3 text-xs hover:text-[#fff1cf] disabled:border-white/10 disabled:bg-white/5 disabled:text-white/30"
        >
          <PlugZap className="size-3.5" aria-hidden="true" />
          {isTesting ? '测试中...' : '测试连接'}
        </Button>
        {notice && (
          <span aria-live="polite" className="text-xs text-[#e8c690]/80">
            {notice}
          </span>
        )}
      </div>
    </div>
  )
}
