import type { ReactElement } from 'react'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList
} from '@renderer/common/components/combobox'

/**
 * @description 渲染模型 ID 输入字段：可自由输入任意 ID，存在模型目录时提供按输入过滤的建议列表。
 * @param props 当前模型 ID、占位文本、目录选项与变更回调。
 * @returns 模型 ID 输入字段。
 * @remarks 输入值受控回写调用方草稿，选中目录条目同样回写，取值不限于目录清单；
 *   目录为空时退化为纯文本输入，不渲染下拉。
 */
export function ModelSelectorField({
  model,
  placeholder,
  modelOptions,
  onChange
}: {
  model: string
  placeholder: string
  modelOptions: string[]
  onChange: (value: string) => void
}): ReactElement {
  const hasModelOptions = modelOptions.length > 0
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-white/55">模型 ID</span>
      <Combobox<string>
        items={modelOptions}
        inputValue={model}
        onInputValueChange={(value) => onChange(value)}
        onValueChange={(value) => {
          if (value !== null) onChange(value)
        }}
      >
        <ComboboxInput
          className="h-9 w-full"
          placeholder={placeholder}
          showTrigger={hasModelOptions}
        />
        {hasModelOptions && (
          <ComboboxContent>
            <ComboboxList>
              {(item: string) => (
                <ComboboxItem key={item} value={item}>
                  {item}
                </ComboboxItem>
              )}
            </ComboboxList>
            <ComboboxEmpty>没有匹配的模型，可直接使用输入的 ID。</ComboboxEmpty>
          </ComboboxContent>
        )}
      </Combobox>
    </label>
  )
}
