import { ChevronDown, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { ModelParamOverrides, ModelProvider, ProviderModel, ReasoningEffort } from '@gamechat/type'
import { createModelEntry, getApplicableGenerationParamFields } from '@gamechat/schema'
import { recommendContextWindow } from '../lib/model-recommendations'
import { Dialog, DialogContent, DialogTitle } from '@renderer/common/components/dialog'
import { Checkbox } from '@renderer/common/components/checkbox'
import { Input } from '@renderer/common/components/input'
import { Button } from '@renderer/common/components/button'
import { ModelParamsFields } from './ParamsFields'
import { ModelSelectorField } from './SelectorField'

/** 模型编辑目标：新建空白模型或编辑既有条目。 */
export type ModelEditTarget = { mode: 'create' } | { mode: 'edit'; modelId: string }

/** 最大输出 tokens 的常用预设容量，label 为界面展示的短标签。 */
const MAX_TOKENS_PRESETS: ReadonlyArray<{ tokens: number; label: string }> = [
  { tokens: 4096, label: '4K' },
  { tokens: 8192, label: '8K' },
  { tokens: 16384, label: '16K' },
  { tokens: 32768, label: '32K' },
  { tokens: 64000, label: '64K' }
]

type ModelEditDialogProps = {
  provider: ModelProvider
  target: ModelEditTarget
  /** 保存回调，接收按当前草稿构造的完整模型条目。 */
  onSave: (model: ProviderModel) => void
  onClose: () => void
}

/**
 * @description 解析正整数容量输入（上下文窗口与最大输出共用）。
 * @param raw 输入框原始字符串。
 * @returns 空输入返回 undefined 表示未配置；合法正整数返回数值；非法输入返回 null。
 */
function parsePositiveIntInput(raw: string): number | undefined | null {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const value = Number(trimmed)
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

/**
 * @description 渲染单个模型条目的编辑弹窗：集中编辑模型 ID、图片能力、窗口容量与参数覆盖。
 * @param props 所属供应商、编辑目标与保存、关闭回调。
 * @returns 模型编辑弹窗。
 * @remarks 打开时从目标条目创建本地草稿，输入期间不写供应商 Store；保存一次性提交，
 *   取消、遮罩或 Escape 关闭时草稿直接丢弃。打开时焦点落在面板本体而非首个输入框；
 *   新建条目的标识在保存时生成，取消不产生空模型。
 */
export function ModelEditDialog({
  provider,
  target,
  onSave,
  onClose
}: ModelEditDialogProps): ReactElement {
  const source =
    target.mode === 'edit' ? provider.models.find((item) => item.id === target.modelId) : undefined
  const [modelName, setModelName] = useState(source?.model ?? '')
  const [supportsImages, setSupportsImages] = useState(source?.supportsImages ?? false)
  const [contextWindowRaw, setContextWindowRaw] = useState(
    typeof source?.contextWindow === 'number' ? String(source.contextWindow) : ''
  )
  const [maxTokensRaw, setMaxTokensRaw] = useState(
    typeof source?.maxTokens === 'number' ? String(source.maxTokens) : ''
  )
  const [paramOverrides, setParamOverrides] = useState<ModelParamOverrides>(
    source?.paramOverrides ?? {}
  )
  const [temperatureOmitted, setTemperatureOmitted] = useState(
    source?.paramOverrides?.temperature === null
  )
  const [overridesOpen, setOverridesOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  const applicableParamFields = getApplicableGenerationParamFields(provider.apiFormat)
  const catalogOptions = provider.modelCatalog?.models || []
  const parsedContextWindow = parsePositiveIntInput(contextWindowRaw)
  const parsedMaxTokens = parsePositiveIntInput(maxTokensRaw)
  const trimmedModelName = modelName.trim()
  const canSave =
    trimmedModelName.length > 0 &&
    typeof parsedContextWindow === 'number' &&
    parsedMaxTokens !== null
  const overrideCount = Object.keys(paramOverrides).length

  /**
   * @description 更新模型 ID 草稿；命中推荐表且窗口为空时自动填入推荐值。
   * @param value 新的模型 ID。
   * @remarks 手动填写的非空窗口值不被覆盖；从目录选中模型同样经过此回调触发推荐。
   */
  const updateModelName = (value: string): void => {
    setModelName(value)
    const recommended = recommendContextWindow(value)
    if (recommended !== null && contextWindowRaw.trim() === '') {
      setContextWindowRaw(String(recommended))
    }
  }

  /**
   * @description 更新草稿中的 Temperature 参数覆盖，留空时清除该覆盖。
   * @param raw 输入框原始字符串。
   * @returns 无返回值。
   * @remarks 「不发送」状态开启时输入框被禁用，本回调不会被触发。
   */
  const updateTemperature = (raw: string): void => {
    setParamOverrides((current) => {
      const next = { ...current }
      if (raw === '') delete next.temperature
      else next.temperature = Number(raw)
      return next
    })
  }

  /**
   * @description 切换 Temperature 的「不发送」覆盖状态。
   * @param omit 是否显式不向 API 发送 Temperature。
   * @returns 无返回值。
   * @remarks 开启时写入 null 覆盖以区别于继承；关闭时清除该覆盖回到继承供应商默认。
   */
  const updateTemperatureOmitted = (omit: boolean): void => {
    setTemperatureOmitted(omit)
    setParamOverrides((current) => {
      const next = { ...current }
      if (omit) next.temperature = null
      else delete next.temperature
      return next
    })
  }

  /**
   * @description 更新草稿中的思考等级覆盖；选择继承时清除该覆盖。
   * @param effort 新的思考等级；null 表示清除覆盖、继承供应商默认。
   * @returns 无返回值。
   */
  const updateReasoningEffort = (effort: ReasoningEffort | null): void => {
    setParamOverrides((current) => {
      const next = { ...current }
      if (effort === null) delete next.reasoningEffort
      else next.reasoningEffort = effort
      return next
    })
  }

  /**
   * @description 按当前草稿构造完整模型条目并上交保存。
   * @returns 无返回值。
   * @remarks 编辑目标沿用原条目标识；新建目标的标识由共享工厂生成。窗口容量为必填项，
   *   缺失或非法时由保存禁用拦截。
   */
  const handleSave = (): void => {
    if (!canSave) return
    const extras = {
      supportsImages,
      ...(parsedContextWindow !== undefined ? { contextWindow: parsedContextWindow } : {}),
      ...(parsedMaxTokens !== undefined ? { maxTokens: parsedMaxTokens } : {}),
      ...(Object.keys(paramOverrides).length > 0 ? { paramOverrides: { ...paramOverrides } } : {})
    }
    const entry: ProviderModel =
      target.mode === 'edit'
        ? { ...createModelEntry(trimmedModelName, extras), id: target.modelId }
        : createModelEntry(trimmedModelName, extras)
    onSave(entry)
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          panelRef.current?.focus()
        }}
      >
        <div ref={panelRef} tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
          <header className="flex flex-col gap-1 border-b border-white/10 px-5 py-4 pr-12">
            <DialogTitle>{target.mode === 'edit' ? '编辑模型' : '添加模型'}</DialogTitle>
          </header>

          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
            <section className="flex flex-col gap-3">
              <ModelSelectorField
                model={modelName}
                placeholder="模型 ID"
                modelOptions={catalogOptions}
                onChange={updateModelName}
              />
              <label className="flex w-fit cursor-pointer items-center gap-2 rounded border border-white/10 bg-black/20 px-3 py-2">
                <Checkbox
                  checked={supportsImages}
                  onCheckedChange={(checked) => setSupportsImages(checked === true)}
                  aria-label="图片"
                />
                <span className="text-xs text-white/70">图片</span>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-white/55">Context Window</span>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={contextWindowRaw}
                  placeholder="例如 131072"
                  onChange={(event) => setContextWindowRaw(event.target.value)}
                />
                {parsedContextWindow === null ? (
                  <span className="text-xs text-red-300">请输入大于零的整数 token 容量。</span>
                ) : parsedContextWindow === undefined ? (
                  <span className="text-xs text-red-300">
                    上下文窗口为必填项，预算管理依赖该值。
                  </span>
                ) : (
                  <span className="text-xs text-white/35">
                    该模型一次请求可容纳的总上下文容量。
                  </span>
                )}
              </label>
              {provider.apiFormat === 'anthropic' && (
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs text-white/55">最大输出</span>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={maxTokensRaw}
                    placeholder="未配置"
                    onChange={(event) => setMaxTokensRaw(event.target.value)}
                  />
                  <div className="flex flex-wrap gap-1">
                    {MAX_TOKENS_PRESETS.map((preset) => (
                      <button
                        key={preset.tokens}
                        type="button"
                        onClick={() => setMaxTokensRaw(String(preset.tokens))}
                        title={`${preset.tokens.toLocaleString('en-US')} tokens`}
                        className={`h-6 cursor-pointer rounded border px-2 text-xs transition-colors ${
                          parsedMaxTokens === preset.tokens
                            ? 'border-[#e8c690]/50 bg-[#e8c690]/15 text-[#f2dfbd]'
                            : 'border-white/10 text-white/50 hover:bg-white/5 hover:text-white/80'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  {parsedMaxTokens === null ? (
                    <span className="text-xs text-red-300">请输入大于零的整数 token 容量。</span>
                  ) : (
                    <span className="text-xs text-white/35">单次回复的最大输出容量。</span>
                  )}
                </label>
              )}
            </section>

            {applicableParamFields.length > 0 && (
              <section className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setOverridesOpen((open) => !open)}
                  className="flex w-full items-center justify-between text-left text-xs text-white/45 transition-colors hover:text-white/70"
                  aria-expanded={overridesOpen}
                >
                  <span className="flex items-center gap-1.5">
                    {overridesOpen ? (
                      <ChevronDown className="size-3.5" />
                    ) : (
                      <ChevronRight className="size-3.5" />
                    )}
                    参数覆盖
                  </span>
                  <span className="text-xs text-white/35">
                    {overrideCount > 0 ? `已覆盖 ${overrideCount} 项` : '继承供应商默认'}
                  </span>
                </button>
                {overridesOpen && (
                  <div className="pl-1">
                    <ModelParamsFields
                      temperature={paramOverrides.temperature ?? undefined}
                      reasoningEffort={paramOverrides.reasoningEffort}
                      showEffort={applicableParamFields.includes('reasoningEffort')}
                      showTemperature={applicableParamFields.includes('temperature')}
                      temperatureOmitted={temperatureOmitted}
                      onTemperatureOmittedChange={updateTemperatureOmitted}
                      showInheritEffort
                      temperaturePlaceholder={String(provider.defaultParams.temperature)}
                      onTemperatureChange={updateTemperature}
                      onReasoningEffortChange={updateReasoningEffort}
                    />
                  </div>
                )}
              </section>
            )}
          </div>

          <footer className="flex justify-end gap-2 border-t border-white/10 bg-black/30 px-5 py-3">
            <Button variant="quiet" size="lg" onClick={onClose}>
              取消
            </Button>
            <Button
              variant="brand"
              size="lg"
              onClick={handleSave}
              disabled={!canSave}
              className="bg-primary/15 hover:bg-primary/25 min-w-20"
            >
              保存
            </Button>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  )
}
