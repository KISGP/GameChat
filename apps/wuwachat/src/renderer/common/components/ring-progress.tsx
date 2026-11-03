import type { ReactElement } from 'react'

/**
 * @description 环形进度的圆周长（半径 6），用于按比例换算描边偏移。
 */
const RING_CIRCUMFERENCE = 2 * Math.PI * 6

/**
 * @description 渲染环形进度图标：总量未知时短弧自转，已知后按进度顺时针填充。
 * @param percent 已完成百分比（0–100）；总量未知时为 null，渲染自转短弧。
 * @returns 环形进度元素。
 * @remarks 描边经 stroke-current 继承所在容器的文字色，适配实底与描边两种按钮形态；
 *   进度文本一律不显示，进度本身即唯一信息。
 */
export function RingProgress({ percent }: { percent: number | null }): ReactElement {
  const track = (
    <circle cx="8" cy="8" r="6" fill="none" strokeWidth="2" className="stroke-current opacity-25" />
  )
  if (percent === null) {
    return (
      <svg className="size-4 animate-spin" viewBox="0 0 16 16" aria-hidden="true">
        {track}
        <circle
          cx="8"
          cy="8"
          r="6"
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE / 4}
          transform="rotate(-90 8 8)"
        />
      </svg>
    )
  }
  return (
    <svg className="size-4" viewBox="0 0 16 16" aria-hidden="true">
      {track}
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={RING_CIRCUMFERENCE * (1 - percent / 100)}
        transform="rotate(-90 8 8)"
        className="stroke-current transition-[stroke-dashoffset] duration-200"
      />
    </svg>
  )
}
