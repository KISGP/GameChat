import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type {
  FlowDebugCharacter,
  FlowDebugEvent,
  FlowDebugResult,
  FlowDebugToolTrace,
  FlowNodeRawExchange,
  FlowPackage
} from '@gamechat/type'
import { getIpcErrorMessage } from '@renderer/common/lib/error-message'
import { debugStart, debugStop, onDebugEvent } from './services'

/** 调试运行输入：画布草稿与外部输入节点里的运行参数。 */
export type FlowDebugOptions = {
  /** 当前画布归一化后的流程包；草稿不完整时为 null。 */
  flow: FlowPackage | null
  /** 外部输入节点里的测试消息。 */
  userInput: string
  /** 外部输入节点里选择的模型条目标识。 */
  modelId: string
  /** 外部输入节点里的模拟角色清单。 */
  characters: FlowDebugCharacter[]
}

/** 逐条角色回复：一个回合一条，按回合发生顺序排列。 */
export type FlowDebugReply = {
  /** 发言角色标识。 */
  characterId: string
  /** 发言角色显示名；token 先于回合开始事件到达时为空串。 */
  name: string
  /** 本回合已流式累积的回复文本。 */
  text: string
}

/** 快速步骤的执行高亮最小停留时长（毫秒）：判断求值与展示步骤瞬时完成，停留才能被看见。 */
const ACTIVE_MIN_HOLD_MS = 400

/** 调试运行控制器：状态由画布节点与托盘直接消费。 */
export type FlowDebugController = {
  running: boolean
  /** 逐条角色回复：每回合一条，按发生顺序排列。 */
  replies: FlowDebugReply[]
  /** 本次运行已产生的工具调用轨迹。 */
  toolTraces: FlowDebugToolTrace[]
  /** 节点标识到最新文本产出的映射：模型调用与发言意愿节点在卡片上展示。 */
  nodeOutputs: Record<string, string>
  /** 节点标识到原始模型交换序列的映射：预览节点 raw 弹窗展示。 */
  nodeRaws: Record<string, FlowNodeRawExchange[]>
  /** 当前运行错误文本；无错误时为空串。 */
  error: string
  /** 正在执行的节点标识；无节点在执行时为 null。 */
  activeNodeId: string | null
  /** 本次运行已进入过的节点标识，按进入顺序排列；供画布保留执行路径标记。 */
  visitedNodeIds: string[]
  /** 推断出的失败节点标识；未定位到节点或非失败结束时为 null。 */
  failedNodeId: string | null
  /**
   * @description 启动一次调试运行。
   * @returns 无返回值。
   */
  run: () => void
  /**
   * @description 停止在途调试运行。
   * @returns 无返回值。
   */
  stop: () => void
  /**
   * @description 清空上一次运行的输出、工具轨迹与错误。
   * @returns 无返回值。
   */
  reset: () => void
}

/**
 * @description 画布调试运行：用当前画布在临时会话中跑一次回复，并收集流式输出与工具轨迹。
 * @param options 当前种类、画布草稿与外部输入参数。
 * @returns 运行状态与控制方法。
 * @remarks 调试会话只驻留内存，不写真实聊天记录；memory 与状态卡工具在调试运行中不绑定，
 *   其余工具仍执行真实副作用并消耗模型 token。事件按 requestId 过滤，
 *   已取消或历史运行的残留事件不会混入当前运行的输出。
 *   节点进出事件用于画布执行高亮：节点异常时流程引擎不发退出事件，
 *   因此「已进入但未退出」的节点即失败节点。
 */
export function useFlowDebug(options: FlowDebugOptions): FlowDebugController {
  const { flow, userInput, modelId, characters } = options
  const [running, setRunning] = useState(false)
  const [replies, setReplies] = useState<FlowDebugReply[]>([])
  const [toolTraces, setToolTraces] = useState<FlowDebugToolTrace[]>([])
  const [nodeOutputs, setNodeOutputs] = useState<Record<string, string>>({})
  const [nodeRaws, setNodeRaws] = useState<Record<string, FlowNodeRawExchange[]>>({})
  const [error, setError] = useState('')
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null)
  const [visitedNodeIds, setVisitedNodeIds] = useState<string[]>([])
  const [failedNodeId, setFailedNodeId] = useState<string | null>(null)
  /** 当前运行标识镜像：事件过滤用，避免监听器闭包读到过期值。 */
  const requestIdRef = useRef('')
  /** 正在执行节点标识镜像：运行结束时推断失败节点用，避免闭包读到过期值。 */
  const activeNodeIdRef = useRef<string | null>(null)
  /** 执行高亮延迟清除的定时器：退出后保持最小停留，重新进入或运行收尾时取消。 */
  const activeClearTimerRef = useRef<number | null>(null)

  /** 取消在飞的执行高亮清除定时器。 */
  const clearActiveTimer = useCallback((): void => {
    if (activeClearTimerRef.current !== null) {
      window.clearTimeout(activeClearTimerRef.current)
      activeClearTimerRef.current = null
    }
  }, [])

  /** 运行收尾：失败时把「已进入未退出」的节点记为失败节点，成功与中止清除执行高亮。 */
  const finishRun = useCallback(
    (result: FlowDebugResult): void => {
      setRunning(false)
      clearActiveTimer()
      if (result.status === 'error') {
        setError(result.errorMessage ?? '调试运行失败。')
        setFailedNodeId(activeNodeIdRef.current)
      }
      activeNodeIdRef.current = null
      setActiveNodeId(null)
    },
    [clearActiveTimer]
  )

  // 组件卸载时取消在飞的执行高亮清除定时器。
  useEffect(() => clearActiveTimer, [clearActiveTimer])

  useEffect(() => {
    return onDebugEvent((event: FlowDebugEvent) => {
      if (event.requestId !== requestIdRef.current) {
        return
      }
      switch (event.type) {
        case 'run-started':
          setReplies([])
          setToolTraces([])
          setNodeOutputs({})
          setNodeRaws({})
          setError('')
          clearActiveTimer()
          setActiveNodeId(null)
          setVisitedNodeIds([])
          setFailedNodeId(null)
          activeNodeIdRef.current = null
          return
        case 'turn-started':
          // 回合边界即一条新回复；同一角色连续多轮也能正确切开。
          setReplies((previous) => [
            ...previous,
            { characterId: event.characterId, name: event.characterName, text: '' }
          ])
          return
        case 'token':
          // 回合内 token 顺序到达：与最后一 条同角色则追加，否则兜底新开一条（无名字）。
          setReplies((previous) => {
            const last = previous[previous.length - 1]
            if (last && last.characterId === event.characterId) {
              return [
                ...previous.slice(0, -1),
                { ...last, text: last.text + event.text }
              ]
            }
            return [...previous, { characterId: event.characterId, name: '', text: event.text }]
          })
          return
        case 'tool-trace':
          setToolTraces((previous) => [...previous, event.trace])
          return
        case 'node-output':
          // 同一节点在一次运行内可能执行多次（如工具循环里的路由），产出按执行顺序追加而非覆盖；
          // 纯原始交换条目（空文本）不进文本累积，避免混入空段。
          if (event.text) {
            setNodeOutputs((previous) => ({
              ...previous,
              [event.nodeId]: previous[event.nodeId]
                ? `${previous[event.nodeId]}\n\n${event.text}`
                : event.text
            }))
          }
          if (event.raw) {
            setNodeRaws((previous) => ({
              ...previous,
              [event.nodeId]: [...(previous[event.nodeId] ?? []), event.raw as FlowNodeRawExchange]
            }))
          }
          return
        case 'node-enter':
          clearActiveTimer()
          activeNodeIdRef.current = event.nodeId
          setActiveNodeId(event.nodeId)
          setVisitedNodeIds((previous) =>
            previous.includes(event.nodeId) ? previous : [...previous, event.nodeId]
          )
          return
        case 'node-exit':
          if (activeNodeIdRef.current === event.nodeId) {
            // 失败节点推断依据立即失位；界面高亮保留最小停留，瞬时步骤的金色描边才可见。
            activeNodeIdRef.current = null
            clearActiveTimer()
            activeClearTimerRef.current = window.setTimeout(() => {
              activeClearTimerRef.current = null
              setActiveNodeId(null)
            }, ACTIVE_MIN_HOLD_MS)
          }
          return
        case 'run-finished':
          finishRun(event.result)
          return
        default:
          return
      }
    })
  }, [finishRun])

  const run = useCallback((): void => {
    if (!flow) {
      toast.error('画布结构不完整：请检查连线条件、入口与必填步骤。')
      return
    }
    if (!modelId) {
      toast.error('运行需要「外部输入」节点：请从左侧步骤池添加，并在节点内选择模型。')
      return
    }
    if (characters.length < 1) {
      toast.error('调试需要在「外部输入」节点里配置至少一个模拟角色：1 个按单聊运行，2 个以上按群聊运行。')
      return
    }
    if (!userInput.trim()) {
      toast.error('调试需要消息内容：请在外部输入节点填写测试消息。')
      return
    }
    const nextRequestId = `debug-${Date.now().toString(36)}`
    requestIdRef.current = nextRequestId
    setRunning(true)
    setError('')
    void debugStart({
      requestId: nextRequestId,
      flow,
      characters,
      input: userInput.trim(),
      modelId
    })
      .then((result) => {
        if (result.status === 'error') {
          setRunning(false)
          setError(result.errorMessage ?? '调试运行失败。')
        }
      })
      .catch((cause: unknown) => {
        setRunning(false)
        toast.error(`调试启动失败：${getIpcErrorMessage(cause)}`)
      })
  }, [characters, flow, modelId, userInput])

  const stop = useCallback((): void => {
    if (!requestIdRef.current) {
      return
    }
    void debugStop(requestIdRef.current)
  }, [])

  const reset = useCallback((): void => {
    setReplies([])
    setToolTraces([])
    setNodeOutputs({})
    setNodeRaws({})
    setError('')
    setActiveNodeId(null)
    setVisitedNodeIds([])
    setFailedNodeId(null)
  }, [])

  return {
    running,
    replies,
    toolTraces,
    nodeOutputs,
    nodeRaws,
    error,
    activeNodeId,
    visitedNodeIds,
    failedNodeId,
    run,
    stop,
    reset
  }
}
