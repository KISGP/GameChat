import { useEffect, useRef, type RefObject } from 'react'
import { useGSAP } from '@gsap/react'
import { gsap } from 'gsap'
import { useMotionPreference } from '@renderer/app/hooks/useMotionPreference'

gsap.registerPlugin(useGSAP)

/**
 * @description 驱动折叠容器的展开与收起动画，内容高度变化时平滑跟随。
 * @param contentRef 折叠容器元素引用，动画直接写入该元素的内联样式。
 * @param isOpen 当前是否处于展开态。
 * @param bodyRef 撑起内容高度的内层元素引用；提供时监听其尺寸变化并平滑过渡容器高度。
 * @returns 无返回值。
 * @remarks 首次挂载仅按 isOpen 摆定终态不播动画；用户关闭动画或系统偏好减少动态效果时直接跳变到目标态；容器尚未渲染时同步内部状态，待其出现后同样不回放动画。
 */
export function useCollapseTween(
  contentRef: RefObject<HTMLDivElement | null>,
  isOpen: boolean,
  bodyRef?: RefObject<HTMLDivElement | null>
): void {
  const { shouldAnimate } = useMotionPreference()
  const previousOpenRef = useRef<boolean | null>(null)

  useEffect(() => {
    const content = contentRef.current
    const body = bodyRef?.current
    if (!isOpen || !shouldAnimate || !content || !body) {
      return
    }

    const resizeObserver = new ResizeObserver(() => {
      if (content.style.height === 'auto') {
        return
      }

      gsap.to(content, {
        height: content.scrollHeight,
        duration: 0.12,
        ease: 'power2.out',
        overwrite: 'auto',
        onComplete: () => {
          gsap.set(content, { height: 'auto' })
        }
      })
    })
    resizeObserver.observe(body)

    return () => {
      resizeObserver.disconnect()
    }
  }, [bodyRef, contentRef, isOpen, shouldAnimate])

  useGSAP(
    () => {
      const content = contentRef.current
      if (!content) {
        previousOpenRef.current = isOpen
        return
      }

      const shouldPlayTransition =
        shouldAnimate && previousOpenRef.current !== null && previousOpenRef.current !== isOpen
      gsap.killTweensOf(content)

      if (!shouldPlayTransition) {
        gsap.set(content, {
          height: isOpen ? 'auto' : 0,
          autoAlpha: isOpen ? 1 : 0,
          pointerEvents: isOpen ? 'auto' : 'none',
          y: isOpen ? 0 : -6
        })
        previousOpenRef.current = isOpen
        return
      }

      previousOpenRef.current = isOpen
      if (isOpen) {
        gsap.set(content, { height: 'auto', autoAlpha: 1, pointerEvents: 'auto', y: 0 })
        const targetHeight = content.scrollHeight
        gsap.set(content, { height: 0, autoAlpha: 0, pointerEvents: 'auto', y: -6 })
        gsap.to(content, {
          height: targetHeight,
          autoAlpha: 1,
          duration: 0.22,
          ease: 'power2.out',
          overwrite: 'auto',
          y: 0,
          onComplete: () => {
            gsap.set(content, { height: 'auto' })
          }
        })
        return
      }

      const currentHeight = content.getBoundingClientRect().height
      gsap.set(content, { height: currentHeight, pointerEvents: 'none' })
      gsap.to(content, {
        height: 0,
        autoAlpha: 0,
        duration: 0.16,
        ease: 'power2.in',
        overwrite: 'auto',
        y: -6,
        onComplete: () => {
          gsap.set(content, { height: 0 })
        }
      })
    },
    { dependencies: [isOpen, shouldAnimate], scope: contentRef }
  )
}
