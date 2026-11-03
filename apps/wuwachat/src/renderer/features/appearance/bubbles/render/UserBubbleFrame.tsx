import type { ComponentType, ReactElement, RefObject } from 'react'
import { BOZAI_BUBBLE_ID, DAWEI_BUBBLE_ID, XINYUEHU_BUBBLE_ID } from '../catalog'
import { SpineBubbleFrame } from './SpineBubbleFrame'
import { SpineBubbleFrameBozai } from './SpineBubbleFrameBozai'
import { SpineBubbleFrameDawei } from './SpineBubbleFrameDawei'

/** 气泡帧组件的公共入参。 */
type BubbleFrameComponentProps = {
  // 气泡可视盒元素引用
  boxRef: RefObject<HTMLElement | null>
}

/** 带动态帧的用户气泡样式注册表：键为气泡样式持久化标识。 */
const BUBBLE_FRAME_COMPONENTS: Readonly<Record<string, ComponentType<BubbleFrameComponentProps>>> =
  {
    [XINYUEHU_BUBBLE_ID]: SpineBubbleFrame,
    [DAWEI_BUBBLE_ID]: SpineBubbleFrameDawei,
    [BOZAI_BUBBLE_ID]: SpineBubbleFrameBozai
  }

type UserBubbleFrameProps = {
  // 用户选中的气泡样式标识；无动态帧的样式不渲染任何内容
  bubbleId: string
  // 气泡可视盒元素引用
  boxRef: RefObject<HTMLElement | null>
}

/**
 * @description 用户消息气泡动态帧的统一入口：按气泡样式标识派发到对应的帧组件。
 * @param bubbleId 用户选中的气泡样式标识。
 * @param boxRef 气泡可视盒元素引用。
 * @returns 匹配样式的帧组件；默认 CSS 气泡或未知标识返回 null。
 * @remarks 聊天消息列表与外观设置页的演示气泡都经由本组件装配帧，帧的画布叠层、
 *          加载失败回退与动效偏好由各帧组件与共享渲染服务自理。
 */
export function UserBubbleFrame({ bubbleId, boxRef }: UserBubbleFrameProps): ReactElement | null {
  const Component = BUBBLE_FRAME_COMPONENTS[bubbleId]
  if (!Component) return null
  return <Component boxRef={boxRef} />
}
