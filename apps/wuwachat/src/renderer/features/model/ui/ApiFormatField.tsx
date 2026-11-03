import type { ReactElement } from 'react'
import { ModelProvider } from '@gamechat/type'
import { API_FORMAT_LABELS, API_FORMAT_OPTIONS } from '@gamechat/schema'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/common/components/select'

/**
 * @description 渲染供应商接入格式选择字段：触发框显示当前格式短标签，下拉列出全部接入格式。
 * @param props 当前供应商与接入格式变更回调。
 * @returns 接入格式选择字段。
 * @remarks 选项清单与短标签映射均来自 @shared/model-settings 的单一事实源；触发框短标签
 *   经 SelectValue children 覆盖实现，与选项的完整文案（含接口路径后缀）相区分。
 */
export function ModelApiFormatField({
  provider,
  onSelectApiFormat
}: {
  provider: ModelProvider
  onSelectApiFormat: (apiFormat: ModelProvider['apiFormat']) => void
}): ReactElement {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-white/55">API 格式</span>
      <Select
        value={provider.apiFormat}
        onValueChange={(value) => {
          // 取值域由下方 SelectItem 的 option.value 保证，只会是两个合法接入格式之一。
          onSelectApiFormat(value as ModelProvider['apiFormat'])
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue>{API_FORMAT_LABELS[provider.apiFormat]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {API_FORMAT_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}
