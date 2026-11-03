import type { ReactElement } from 'react'
import { ReasoningEffort } from '@gamechat/type'
import { REASONING_EFFORT_OPTIONS } from '@gamechat/schema'
import { Input } from '@renderer/common/components/input'
import { Checkbox } from '@renderer/common/components/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/common/components/select'

/** 参数覆盖 Select 中表示「继承供应商默认」的哨兵值。 */
const INHERIT_EFFORT_VALUE = 'inherit'

type ParamsFieldsProps = {
  temperature?: number
  reasoningEffort?: ReasoningEffort
  /** 是否展示思考等级控件（Anthropic 格式不启用思考等级）。 */
  showEffort: boolean
  /** 是否展示 Temperature 控件（Anthropic 格式接口不接受该参数）。 */
  showTemperature?: boolean
  /** Temperature 是否处于「不发送」状态；缺省表示该控件不支持省略语义。 */
  temperatureOmitted?: boolean
  /** 切换 Temperature「不发送」状态的回调；缺省时不渲染切换入口。 */
  onTemperatureOmittedChange?: (omit: boolean) => void
  /** 是否提供「继承默认」选项清空覆盖（用于模型级参数覆盖）。 */
  showInheritEffort?: boolean
  temperaturePlaceholder?: string
  onTemperatureChange: (raw: string) => void
  onReasoningEffortChange: (effort: ReasoningEffort | null) => void
}

/**
 * @description 渲染生成参数输入组：Temperature 与可选的思考等级。
 * @param props 当前取值、控件开关与各字段的变更回调。
 * @returns 生成参数输入组。
 * @remarks 数值字段以原始字符串上交变更，由调用方决定空值语义（默认参数转数字、覆盖留空即清除）；
 *   Temperature 的「不发送」开关供拒绝自定义温度的模型显式省略该参数，开启时输入框禁用；
 *   控件隐藏时已保存的字段值原样保留，不做清理。
 */
export function ModelParamsFields({
  temperature,
  reasoningEffort,
  showEffort,
  showTemperature = true,
  temperatureOmitted = false,
  onTemperatureOmittedChange,
  showInheritEffort = false,
  temperaturePlaceholder,
  onTemperatureChange,
  onReasoningEffortChange
}: ParamsFieldsProps): ReactElement {
  return (
    <div className="flex flex-col gap-3">
      {showTemperature && (
        <div className="flex flex-col gap-1.5">
          <span className="flex items-center justify-between">
            <span className="text-xs text-white/55">Temperature</span>
            {onTemperatureOmittedChange && (
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-white/55">
                <Checkbox
                  checked={temperatureOmitted}
                  onCheckedChange={(checked) => onTemperatureOmittedChange(checked === true)}
                  className="size-3.5"
                  aria-label="不发送"
                />
                不发送
              </label>
            )}
          </span>
          <Input
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={temperatureOmitted ? '' : (temperature ?? '')}
            placeholder={temperatureOmitted ? '不发送' : temperaturePlaceholder}
            disabled={temperatureOmitted}
            onChange={(event) => onTemperatureChange(event.target.value)}
          />
        </div>
      )}
      {showEffort && (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-white/55">思考等级</span>
          <Select
            value={reasoningEffort ?? (showInheritEffort ? INHERIT_EFFORT_VALUE : undefined)}
            onValueChange={(value) =>
              onReasoningEffortChange(
                showInheritEffort && value === INHERIT_EFFORT_VALUE
                  ? null
                  : (value as ReasoningEffort)
              )
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="继承默认" />
            </SelectTrigger>
            <SelectContent>
              {showInheritEffort && (
                <SelectItem value={INHERIT_EFFORT_VALUE}>继承默认</SelectItem>
              )}
              {REASONING_EFFORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-white/35">
            {showInheritEffort ? '留空时继承供应商默认。' : '仅推理模型支持；自动不会传递该参数。'}
          </span>
        </label>
      )}
    </div>
  )
}
