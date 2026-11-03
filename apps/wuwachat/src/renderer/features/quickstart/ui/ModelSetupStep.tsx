import { useState, type ReactElement } from 'react'
import { Eye, EyeOff, Wifi, X } from 'lucide-react'
import { ApiFormat } from '@gamechat/type'
import { API_FORMAT_OPTIONS, createModelEntry } from '@gamechat/schema'
import { cn, isValidUrl } from '@renderer/common/lib/cn'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/common/components/select'
import { Button } from '@renderer/common/components/button'
import { ModelSelectorField } from '@renderer/features/model/ui/SelectorField'
import { useProviderConnectionTest } from '@renderer/features/model/hooks/useProviderConnectionTest'
import { useProvidersStore } from '@renderer/store/providers'

type ModelSetupStepProps = {
  /** 供应商与模型条目写入成功后回传模型条目标识的回调。 */
  onCompleted: (modelEntryId: string) => void
  /** 跳过模型配置并退出向导。 */
  onSkip: () => void
}

/**
 * @description 表单输入控件共用的深色样式，与设置页表单控件保持一致。
 */
const FIELD_CLASS =
  'w-full rounded-lg border border-white/15 bg-black/35 px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-white/40 focus:border-[#e8c690]'

/**
 * @description 从 Base URL 提取主机名作为供应商显示名。
 * @param baseUrl 用户填写的服务地址。
 * @returns URL 主机名；解析失败时返回通用名称。
 */
function deriveProviderName(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname
  } catch {
    return '模型供应商'
  }
}

/**
 * @description 渲染首启向导的模型配置步：填写连接信息、测试并获取模型列表后保存新供应商与模型条目。
 * @param props 组件 props。
 * @returns 模型配置步内容。
 * @remarks 连接信息与测试生命周期由共享连接草稿 hook 管理：任一连接字段变更都会丢弃既有
 *   测试结果与模型目录；测试与完成均不要求 API Key，无 Key 的本地端点同样可配置。
 */
export function ModelSetupStep({ onCompleted, onSkip }: ModelSetupStepProps): ReactElement {
  const {
    apiFormat,
    baseUrl,
    apiKey,
    testing,
    testResult,
    catalogModels,
    modelCatalog,
    canTest,
    setDraft,
    testConnection,
    cancelTest
  } = useProviderConnectionTest({ apiFormat: 'chat-completions', baseUrl: '', apiKey: '' })
  const [showApiKey, setShowApiKey] = useState(false)
  const [modelId, setModelId] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const canComplete = isValidUrl(baseUrl) && modelId.trim().length > 0

  /**
   * @description 测试当前连接，成功返回目录且未手填模型名时自动预选第一个模型。
   * @returns 无返回值。
   */
  async function handleTest(): Promise<void> {
    const result = await testConnection()
    if (result?.ok) {
      const models = result.models ?? []
      setModelId((current) => current || models[0] || '')
    }
  }

  /**
   * @description 校验表单并把新供应商与所选模型条目写入供应商配置。
   * @returns 无返回值。
   * @remarks 供应商名称取 Base URL 主机名；持久化由供应商 Store 的防抖保存链完成，
   *   模型目录在连接信息之后单独写入以免被连接字段提交路径清除；提交后锁定入口，
   *   向导退场动画期间的重复点击不会重复建供应商。
   */
  function handleComplete(): void {
    if (submitted) {
      return
    }
    if (!canComplete) {
      setSubmitError('请填写有效的 Base URL，并选择或填写模型名。')
      return
    }
    setSubmitted(true)
    const trimmedBaseUrl = baseUrl.trim()
    const modelEntry = createModelEntry(modelId.trim())
    const providers = useProvidersStore.getState()
    const providerId = providers.addProvider()
    providers.updateProvider(providerId, {
      name: deriveProviderName(trimmedBaseUrl),
      apiFormat,
      baseUrl: trimmedBaseUrl,
      apiKey: apiKey.trim()
    })
    providers.addProviderModel(providerId, modelEntry)
    if (modelCatalog) {
      providers.updateProvider(providerId, { modelCatalog })
    }
    onCompleted(modelEntry.id)
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5 pb-2">
      <div>
        <label
          className="mb-1.5 block text-sm font-medium text-white/70"
          htmlFor="quickstart-api-format"
        >
          接入格式
        </label>
        <Select
          value={apiFormat}
          onValueChange={(value) => {
            setDraft({ apiFormat: value as ApiFormat })
          }}
        >
          <SelectTrigger id="quickstart-api-format" className={FIELD_CLASS}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {API_FORMAT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <label
          className="mb-1.5 block text-sm font-medium text-white/70"
          htmlFor="quickstart-base-url"
        >
          Base URL
        </label>
        <input
          id="quickstart-base-url"
          type="text"
          value={baseUrl}
          onChange={(event) => {
            setDraft({ baseUrl: event.target.value })
          }}
          placeholder="https://api.example.com"
          spellCheck={false}
          className={FIELD_CLASS}
        />
      </div>

      <div>
        <label
          className="mb-1.5 block text-sm font-medium text-white/70"
          htmlFor="quickstart-api-key"
        >
          API Key
        </label>
        <div className="relative">
          <input
            id="quickstart-api-key"
            type={showApiKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(event) => {
              setDraft({ apiKey: event.target.value })
            }}
            placeholder="sk-..."
            spellCheck={false}
            autoComplete="off"
            className={cn(FIELD_CLASS, 'pr-10')}
          />
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setShowApiKey((current) => !current)}
            aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'}
            className="absolute inset-y-0 right-2 my-auto rounded-sm text-white/50 hover:text-white/80"
          >
            {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        {testing ? (
          <Button variant="danger" size="lg" onClick={() => void cancelTest()}>
            <X className="size-4" />
            取消测试
          </Button>
        ) : (
          <Button
            variant="quiet"
            size="lg"
            onClick={() => void handleTest()}
            disabled={!canTest}
            className="border-white/20"
          >
            <Wifi className="size-4" />
            测试并获取模型
          </Button>
        )}
        {testResult && (
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-right text-xs',
              testResult.ok ? 'text-green-400' : 'text-red-300'
            )}
            title={testResult.message}
          >
            {testResult.message}
            {typeof testResult.latencyMs === 'number' ? ` / ${testResult.latencyMs}ms` : ''}
          </span>
        )}
      </div>

      <ModelSelectorField
        model={modelId}
        placeholder="例如 deepseek-chat，测试失败时可手动填写"
        modelOptions={catalogModels}
        onChange={setModelId}
      />
      {testResult?.ok && catalogModels.length === 0 && (
        <div className="mt-1.5 text-xs text-white/45">服务未返回模型列表，可手动填写模型名。</div>
      )}

      {(submitError || (testResult && !testResult.ok)) && (
        <div className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs leading-relaxed text-red-200">
          {submitError ??
            `连接失败：${testResult?.message ?? '未知错误'}，可直接手动填写模型名完成配置。`}
        </div>
      )}

      <Button
        variant="primary"
        size="lg"
        onClick={handleComplete}
        disabled={!canComplete || submitted}
        className="mt-1 w-full font-semibold"
      >
        完成配置
      </Button>
      <Button variant="quiet" size="lg" onClick={onSkip} className="w-full">
        跳过，暂不配置模型
      </Button>
    </div>
  )
}
