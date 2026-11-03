import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ReactElement } from 'react'
import { GenerationParams, ModelProvider } from '@gamechat/type'
import { getApplicableGenerationParamFields } from '@gamechat/schema'
import { ModelParamsFields } from './ParamsFields'

/**
 * @description 渲染当前供应商默认生成参数的可折叠配置区。
 * @param props 折叠状态、供应商取值以及参数更新回调。
 * @returns 供应商默认生成参数配置区块；当前接入格式无生效参数字段时返回 null，不渲染区块。
 */
export function ProviderDefaultParamsSection({
  open,
  provider,
  onToggle,
  onUpdate
}: {
  open: boolean
  provider: ModelProvider
  onToggle: () => void
  onUpdate: (patch: Partial<GenerationParams>) => void
}): ReactElement | null {
  const applicableParamFields = getApplicableGenerationParamFields(provider.apiFormat)
  if (applicableParamFields.length === 0) {
    return null
  }

  return (
    <section className="overflow-hidden rounded border border-white/10 bg-black/20">
      <button
        type="button"
        onClick={onToggle}
        className="flex h-10 w-full items-center justify-between px-3 text-left text-sm text-white/70 transition-colors hover:bg-white/5 hover:text-white/90"
      >
        <span className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="size-4 text-white/50" />
          ) : (
            <ChevronRight className="size-4 text-white/50" />
          )}
          默认生成参数
        </span>
      </button>

      {open && (
        <div className="border-t border-white/10 p-3">
          <ModelParamsFields
            temperature={provider.defaultParams.temperature}
            reasoningEffort={provider.defaultParams.reasoningEffort}
            showEffort={applicableParamFields.includes('reasoningEffort')}
            showTemperature={applicableParamFields.includes('temperature')}
            onTemperatureChange={(raw) => onUpdate({ temperature: Number(raw) })}
            onReasoningEffortChange={(effort) => {
              if (effort) onUpdate({ reasoningEffort: effort })
            }}
          />
        </div>
      )}
    </section>
  )
}
