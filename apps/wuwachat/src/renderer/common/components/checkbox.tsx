'use client'

import * as React from 'react'
import { cn } from '@renderer/common/lib/cn'
import { CheckIcon } from 'lucide-react'
import { Checkbox as CheckboxPrimitive, Indicator } from '@radix-ui/react-checkbox'

/**
 * @description 渲染复选框：勾选态为主题金色高亮，支持 focus 与 aria-invalid 状态样式。
 * @param props 透传给 Radix Checkbox Root 的属性。
 * @returns 复选框。
 * @remarks 复选框本体为按钮语义元素，经内部隐藏 input 参与表单；配色与本应用其余控件一致，
 *   采用硬编码深色与金色高亮，不依赖语义 token（应用未激活 .dark 主题类）。
 */
function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive>): React.JSX.Element {
  return (
    <CheckboxPrimitive
      data-slot="checkbox"
      className={cn(
        'peer group-has-focus-visible/field-label:not-data-checked:border-white/15 focus-visible:border-[#e8c690] focus-visible:ring-[#e8c690]/35 aria-invalid:border-red-400/60 aria-invalid:ring-red-400/25 aria-invalid:aria-checked:border-[#e8c690] group-has-[:focus-visible]/field-label:data-checked:border-[#e8c690] border-white/15 bg-black/35 data-checked:border-[#e8c690]/50 data-checked:bg-[#e8c690]/15 data-checked:text-[#e8c690] relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors outline-none group-has-disabled/field:opacity-50 group-has-[:focus-visible]/field-label:ring-0 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3',
        className
      )}
      {...props}
    >
      <Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3.5"
      >
        <CheckIcon />
      </Indicator>
    </CheckboxPrimitive>
  )
}

export { Checkbox }
