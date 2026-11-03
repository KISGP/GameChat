import { cn } from '@renderer/common/lib/cn'

function Input({ className, type, ...props }: React.ComponentProps<'input'>): React.ReactElement {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-9 rounded border border-white/15 bg-black/35 px-3 text-sm text-white transition-colors outline-none placeholder:text-white/30 focus:border-[#e8c690]',
        className
      )}
      {...props}
    />
  )
}

export { Input }
