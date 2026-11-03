import Close from '@renderer/assets/SP_BtnBack.png'
import { cn } from '@renderer/common/lib/cn'
import { type ReactElement } from 'react'

export default function CloseIcon({
  className,
  onClick
}: {
  className?: string
  onClick?: () => void
}): ReactElement {
  return (
    <div
      className={cn(
        'group no-drag pointer-events-auto z-10 size-10 scale-90 cursor-pointer',
        className
      )}
      onClick={onClick}
    >
      <div className="relative size-full">
        <img
          src={Close}
          alt="close"
          className="absolute -top-0.75 -right-0.75 size-6 object-contain transition-transform duration-200 group-hover:translate-x-px group-hover:-translate-y-px"
        />
        <img
          src={Close}
          alt="close"
          className="absolute -right-0.75 -bottom-0.75 size-6 scale-y-[-1] object-contain transition-transform duration-200 group-hover:translate-x-px group-hover:translate-y-px"
        />
        <img
          src={Close}
          alt="close"
          className="absolute -bottom-0.75 -left-0.75 size-6 scale-x-[-1] scale-y-[-1] object-contain transition-transform duration-200 group-hover:-translate-x-px group-hover:translate-y-px"
        />
        <img
          src={Close}
          alt="close"
          className="absolute -top-0.75 -left-0.75 size-6 scale-x-[-1] object-contain transition-transform duration-200 group-hover:-translate-x-px group-hover:-translate-y-px"
        />
      </div>
    </div>
  )
}
