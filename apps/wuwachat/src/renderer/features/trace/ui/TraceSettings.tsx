import { useState, type ReactElement } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { DEFAULT_TRACE_BASE_URL } from '@gamechat/schema'
import { Switch } from '@renderer/common/components/switch'
import { Input } from '@renderer/common/components/input'
import { Button } from '@renderer/common/components/button'
import { SettingItem } from '@renderer/common/components/SettingItem'
import { useAppSettingsStore } from '@renderer/store/app-settings'

/**
 * @description 渲染 Langfuse 追踪配置面板，供开发者工具区管理追踪上报。
 * @returns 追踪设置页内容。
 */
export function TraceSettingsTab(): ReactElement {
  const trace = useAppSettingsStore((state) => state.settings.trace)
  const updateTraceSettings = useAppSettingsStore((state) => state.updateTraceSettings)
  const [showSecretKey, setShowSecretKey] = useState(false)

  return (
    <div className="h-full space-y-2 overflow-y-auto px-4">
      <SettingItem
        title="启用 Langfuse"
        expandedItems={[
          <p key="description" className="text-muted-foreground">
            开启后，聊天运行与模型调用会上报到 Langfuse Cloud，用于调试与分析。默认关闭。
          </p>
        ]}
      >
        <Switch
          id="trace-enabled"
          checked={trace.enabled}
          onCheckedChange={(enabled) => void updateTraceSettings({ enabled })}
          aria-label="启用 Langfuse"
        />
      </SettingItem>
      <SettingItem
        title="服务地址"
        expandedItems={[
          <p key="description" className="text-muted-foreground">
            Langfuse Cloud 区域地址。默认为欧盟主站 {DEFAULT_TRACE_BASE_URL}
            ，可改为日本区域 jp.cloud.langfuse.com 或美国区域 us.cloud.langfuse.com。
          </p>
        ]}
      >
        <Input
          type="url"
          defaultValue={trace.baseUrl}
          placeholder={DEFAULT_TRACE_BASE_URL}
          disabled={!trace.enabled}
          onBlur={(event) => {
            const baseUrl = event.currentTarget.value.trim() || DEFAULT_TRACE_BASE_URL
            event.currentTarget.value = baseUrl
            void updateTraceSettings({ baseUrl })
          }}
          className="w-72"
          aria-label="Langfuse 服务地址"
        />
      </SettingItem>
      <SettingItem
        title="Public Key"
        expandedItems={[
          <p key="description" className="text-muted-foreground">
            在 Langfuse 项目设置的 API Keys 中创建，以 pk-lf- 开头。
          </p>
        ]}
      >
        <Input
          type="text"
          defaultValue={trace.publicKey}
          placeholder="pk-lf-..."
          disabled={!trace.enabled}
          autoComplete="off"
          spellCheck={false}
          onBlur={(event) => {
            const publicKey = event.currentTarget.value.trim()
            event.currentTarget.value = publicKey
            void updateTraceSettings({ publicKey })
          }}
          className="w-72"
          aria-label="Langfuse Public Key"
        />
      </SettingItem>
      <SettingItem
        title="Secret Key"
        expandedItems={[
          <p key="description" className="text-muted-foreground">
            在 Langfuse 项目设置的 API Keys 中创建，以 sk-lf-
            开头。保存后随应用设置持久化，日志输出会按敏感键名脱敏。
          </p>
        ]}
      >
        <span className="relative block">
          <Input
            type={showSecretKey ? 'text' : 'password'}
            defaultValue={trace.secretKey}
            placeholder="sk-lf-..."
            disabled={!trace.enabled}
            autoComplete="new-password"
            spellCheck={false}
            onBlur={(event) => {
              const secretKey = event.currentTarget.value.trim()
              event.currentTarget.value = secretKey
              void updateTraceSettings({ secretKey })
            }}
            className="w-72 pr-10"
            aria-label="Langfuse Secret Key"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={showSecretKey ? '隐藏 Secret Key' : '显示 Secret Key'}
            onClick={() => setShowSecretKey((value) => !value)}
            className="absolute inset-y-0 right-2 my-auto text-white/45 hover:text-white/80"
          >
            {showSecretKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
        </span>
      </SettingItem>
    </div>
  )
}
