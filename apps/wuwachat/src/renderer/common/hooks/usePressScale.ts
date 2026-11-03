import { useEffect, type RefObject } from 'react'
import { gsap } from 'gsap'
import { useMotionPreference } from '@renderer/app/hooks/useMotionPreference'

/**
 * @description 按压时目标元素缩放到的比例，所有尺寸按钮共用同一值。
 */
const PRESS_SCALE = 0.95

/**
 * @description 按下收缩补间的时长（秒）。
 */
const PRESS_IN_DURATION = 0.12

/**
 * @description 松开回弹补间的时长（秒）。
 */
const PRESS_OUT_DURATION = 0.3

/**
 * @description 为元素提供按压缩放反馈：主键按下时缩小到固定比例，松开或指针移出时带过冲回弹到原大小。
 * @param targetRef 目标元素引用，缩放 transform 直接写入该元素的内联样式。
 * @param enabled 是否启用按压反馈，缺省启用。
 * @returns 无返回值。
 * @remarks 仅响应主键 pointerdown，键盘激活不触发；pointerup、pointercancel、pointerleave 均视为松开，避免按住拖出后卡在缩小态；连点时由 overwrite 打断在飞补间；卸载时清理监听、终止补间并复位 transform。目标元素的 transform 由本 hook 独占写入，调用点不得再以 className transform 类定位该元素。系统或用户偏好减少动态效果时不挂监听、不缩放。
 */
export function usePressScale(targetRef: RefObject<HTMLElement | null>, enabled = true): void {
  const { shouldAnimate } = useMotionPreference()

  useEffect(() => {
    const element = targetRef.current
    if (!enabled || !shouldAnimate || !element) {
      return
    }

    const press = (): void => {
      gsap.to(element, {
        scale: PRESS_SCALE,
        duration: PRESS_IN_DURATION,
        ease: 'power2.out',
        overwrite: 'auto'
      })
    }

    const release = (): void => {
      gsap.to(element, {
        scale: 1,
        duration: PRESS_OUT_DURATION,
        ease: 'back.out(1.7)',
        overwrite: 'auto'
      })
    }

    const handlePointerDown = (event: PointerEvent): void => {
      if (event.button === 0) {
        press()
      }
    }

    element.addEventListener('pointerdown', handlePointerDown)
    element.addEventListener('pointerup', release)
    element.addEventListener('pointercancel', release)
    element.addEventListener('pointerleave', release)

    return () => {
      element.removeEventListener('pointerdown', handlePointerDown)
      element.removeEventListener('pointerup', release)
      element.removeEventListener('pointercancel', release)
      element.removeEventListener('pointerleave', release)
      gsap.killTweensOf(element)
      gsap.set(element, { scale: 1 })
    }
  }, [enabled, shouldAnimate, targetRef])
}
