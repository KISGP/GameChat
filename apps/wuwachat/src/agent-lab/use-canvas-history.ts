/**
 * @description 画布撤销/重做历史栈：快照进出栈、防抖合并与栈清空。
 * @remarks 快照内容与合并语义由消费方决定；undo/redo 先把当前快照压入对侧栈再应用目标快照，
 *   因此 apply 回调必须同步写回快照的全部字段并自管选中态与脏标记。
 */
import { useCallback, useRef } from 'react'
import type { StepCanvasEdge, StepCanvasNode } from './flow-model'

/** 画布快照：节点、连线、入口与流程名。 */
export type CanvasSnapshot = {
  nodes: StepCanvasNode[]
  edges: StepCanvasEdge[]
  entry: string | null
  name: string
}

/** 防抖窗口：窗口内的连续捕获合并为一条撤销记录。 */
const CAPTURE_MERGE_WINDOW_MS = 500

/** 撤销/重做历史栈控制面。 */
export type CanvasHistory = {
  /**
   * @description 把当前画布快照压入撤销栈并清空重做栈。
   * @param force 为 true 时跳过防抖窗口立即捕获；连续文本输入等可合并变更传 false。
   */
  capture: (force?: boolean) => void
  /** @description 撤销上一次变更；撤销栈为空时无操作。 */
  undo: () => void
  /** @description 重做上一次撤销的变更；重做栈为空时无操作。 */
  redo: () => void
  /** @description 清空两侧历史栈；装载新流程或重置画布时调用。 */
  reset: () => void
}

/**
 * @description 创建画布撤销/重做历史栈。
 * @param options 快照读取与应用回调。
 * @param options.getSnapshot 读取当前画布快照；返回前需自行深拷贝节点与连线。
 * @param options.apply 把目标快照写回画布状态。
 * @returns 历史栈控制面。
 * @remarks 本钩子不持有画布状态：getSnapshot 必须基于 ref 等稳定读取最新值，
 *   apply 内部负责清选中态与标记脏状态。
 */
export function useCanvasHistory(options: {
  getSnapshot: () => CanvasSnapshot
  apply: (snapshot: CanvasSnapshot) => void
}): CanvasHistory {
  const { getSnapshot, apply } = options
  /** 撤销栈（变更前快照）。 */
  const undoStack = useRef<CanvasSnapshot[]>([])
  /** 重做栈（撤销前快照）。 */
  const redoStack = useRef<CanvasSnapshot[]>([])
  /** 上一次捕获的时间戳，供防抖窗口判定。 */
  const lastCaptureRef = useRef(0)

  const capture = useCallback(
    (force = false): void => {
      const now = Date.now()
      if (!force && now - lastCaptureRef.current < CAPTURE_MERGE_WINDOW_MS) {
        return
      }
      lastCaptureRef.current = now
      undoStack.current.push(getSnapshot())
      redoStack.current = []
    },
    [getSnapshot]
  )

  const undo = useCallback((): void => {
    const previous = undoStack.current.pop()
    if (!previous) {
      return
    }
    redoStack.current.push(getSnapshot())
    apply(previous)
  }, [apply, getSnapshot])

  const redo = useCallback((): void => {
    const next = redoStack.current.pop()
    if (!next) {
      return
    }
    undoStack.current.push(getSnapshot())
    apply(next)
  }, [apply, getSnapshot])

  const reset = useCallback((): void => {
    undoStack.current = []
    redoStack.current = []
  }, [])

  return { capture, undo, redo, reset }
}
