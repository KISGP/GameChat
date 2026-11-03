import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { usePressScale } from '@renderer/common/hooks/usePressScale'
import { cn } from '@renderer/common/lib/cn'

/**
 * @description 按钮变体的类名生成器，集中承载应用内全部按钮形态的视觉规则。
 * @remarks variant 与项目按钮形态一一对应：primary 为金实底主操作，brand 为金描边次级操作，quiet 为白幽灵次级操作，ghost 为无底悬停操作，danger 为危险操作，link 为链接式文字操作。颜色一律经主题 token 或其透明度表达，深色基准的具体色值集中在 app/styles/main.css。
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,opacity] outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-primary-foreground hover:bg-[color-mix(in_oklch,var(--primary),white_15%)]',
        brand: 'border-primary/50 text-primary hover:bg-primary/10',
        quiet:
          'border-border bg-foreground/5 text-foreground/70 hover:bg-foreground/10 hover:text-foreground aria-expanded:bg-foreground/10 aria-expanded:text-foreground',
        ghost:
          'hover:bg-foreground/10 hover:text-foreground aria-expanded:bg-foreground/10 aria-expanded:text-foreground',
        danger: 'border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20',
        link: 'text-primary underline-offset-4 hover:underline'
      },
      size: {
        default:
          'h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        xs: "h-6 gap-1 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-2.5 text-[0.8rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-9 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3',
        icon: 'size-8',
        'icon-xs': "size-6 [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-7',
        'icon-lg': 'size-9'
      }
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default'
    }
  }
)

/**
 * @description 应用内唯一的按钮组件，按 variant 与 size 组合渲染标准按钮形态。
 * @remarks 全应用按钮统一入口；豁免保留原生的形态清单见 AGENTS.md Renderer 章节。className 经 tailwind-merge 合并，允许按调用点覆盖几何与配色。按压时经 usePressScale 播放 GSAP 缩放反馈，带 aria-haspopup 的弹出层触发钮不参与；缩放 transform 由该 hook 独占写入按钮内联样式，调用点不得在 className 里给按钮追加 transform 定位类。
 */
function Button({
  className,
  variant = 'primary',
  size = 'default',
  ref,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants>): React.ReactElement {
  const pressRef = React.useRef<HTMLButtonElement | null>(null)
  const setRefs = React.useCallback(
    (node: HTMLButtonElement | null) => {
      pressRef.current = node
      if (typeof ref === 'function') {
        ref(node)
      } else if (ref) {
        ref.current = node
      }
    },
    [ref]
  )
  usePressScale(pressRef, !props['aria-haspopup'])

  return (
    <button
      ref={setRefs}
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
