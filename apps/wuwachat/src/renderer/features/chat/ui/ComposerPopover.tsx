import { useRef, type ReactElement, type ReactNode } from 'react'
import { useGSAP } from '@gsap/react'
import { gsap } from 'gsap'
import { useMotionPreference } from '@renderer/app/hooks/useMotionPreference'
import { cn } from '@renderer/common/lib/cn'

gsap.registerPlugin(useGSAP)

type ComposerPopoverProps = {
  /** 定位与尺寸类，由调用方按锚点位置传入。 */
  className?: string
  /** 浮层内容。 */
  children: ReactNode
}

/**
 * @description 渲染聊天输入框区域的浅色浮层面板：统一表面样式与 GSAP 驱动的入场动效。
 * @param props 定位尺寸类与内容。
 * @returns 浮层面板节点。
 */
export function ComposerPopover({ className, children }: ComposerPopoverProps): ReactElement {
  const { shouldAnimate } = useMotionPreference()
  const panelRef = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const panel = panelRef.current
      if (!panel || !shouldAnimate) {
        return
      }
      gsap.from(panel, {
        autoAlpha: 0,
        scale: 0.95,
        y: 8,
        duration: 0.15,
        ease: 'power2.out',
        transformOrigin: '50% 100%',
        overwrite: 'auto'
      })
    },
    { dependencies: [shouldAnimate], scope: panelRef }
  )

  return (
    <div
      ref={panelRef}
      className={cn(
        'rounded-lg border-2 border-[#e5e7eb] bg-white shadow-[0_14px_32px_rgba(0,0,0,0.12)]',
        className
      )}
    >
      {children}
    </div>
  )
}
