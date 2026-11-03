/**
 * @description 编排画布草稿钩子：画布状态、撤销/重做历史与全部画布操作。
 * @remarks 本钩子持有「正在编辑的草稿」整体（节点、连线、入口、流程名与脏标记）；
 *   流程身份（flowId、列表与落盘）由 use-flow-document 承担。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  applyEdgeChanges,
  applyNodeChanges,
  reconnectEdge,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type ReactFlowInstance
} from '@xyflow/react'
import { toast } from 'sonner'
import {
  type FlowPackage,
  type FlowStepConfig,
  type FlowStepType,
  type FlowBranchValue
} from '@gamechat/type'
import {
  createStepId,
  createStepNode,
  CONDITION_ENTRY_SIDES,
  initialEdgeSides,
  layoutGraph,
  nodeCardWidth,
  toCanvas,
  withDefaultPrompt,
  type StepCanvasEdge,
  type StepCanvasNode
} from './flow-model'
import { useCanvasHistory, type CanvasHistory, type CanvasSnapshot } from './use-canvas-history'

/**
 * @description 判断一个 Handle 取值是否为判断节点的入口（顶/左/右）。
 * @param handle 连接事件携带的 Handle 取值。
 * @returns 命中入口取值时为 true。
 */
function isConditionEntryHandle(handle: string | null | undefined): boolean {
  return handle !== null && handle !== undefined && CONDITION_ENTRY_SIDES.includes(handle)
}

/**
 * @description 解析判断节点的入线入口侧。
 * @param sourceNode 起点节点。
 * @param targetNode 判断节点。
 * @param dropped 落手 Handle；命中入口取值时直接采用。
 * @returns 顶/左/右之一：落手优先，其次按起点相对方位（偏左入左侧、偏右入右侧），兜底顶部。
 */
function resolveConditionEntrySide(
  sourceNode: StepCanvasNode | undefined,
  targetNode: StepCanvasNode | undefined,
  dropped: string | null | undefined
): string {
  if (dropped && CONDITION_ENTRY_SIDES.includes(dropped)) {
    return dropped
  }
  if (sourceNode && targetNode) {
    if (sourceNode.position.x < targetNode.position.x) {
      return 'left'
    }
    if (sourceNode.position.x > targetNode.position.x) {
      return 'right'
    }
  }
  return 'top'
}

/**
 * @description 解析一条连线的端点侧别。
 * @param connection React Flow 连接关系。
 * @param nodes 画布节点。
 * @returns 出线侧与入线侧；优先用落手的 Handle，缺失时按两个节点的中心位置补算。
 * @remarks 目标是判断节点时入线归位到顶/左/右入口之一，分支 Handle 只作为出线端点。
 */
function resolveEdgeSides(
  connection: Connection,
  nodes: StepCanvasNode[]
): { sourceHandle: string; targetHandle: string } {
  const sourceNode = nodes.find((node) => node.id === connection.source)
  const targetNode = nodes.find((node) => node.id === connection.target)
  const fallback =
    sourceNode && targetNode
      ? initialEdgeSides(sourceNode, targetNode)
      : { sourceHandle: 'right', targetHandle: 'left' }
  return {
    sourceHandle: connection.sourceHandle ?? fallback.sourceHandle,
    targetHandle:
      targetNode?.data.step.type === 'condition'
        ? resolveConditionEntrySide(sourceNode, targetNode, connection.targetHandle)
        : (connection.targetHandle ?? fallback.targetHandle)
  }
}

/** 判断节点的分支取值顺序：自动分配空闲分支时满足优先。 */
const BRANCH_ORDER: readonly FlowBranchValue[] = ['true', 'false']

/** 分支取值的展示名：可行动提示文案使用。 */
const BRANCH_LABELS: Record<FlowBranchValue, string> = { true: '满足', false: '不满足' }

/**
 * @description 解析判断节点本次连线应走的分支。
 * @param sourceHandle 连接事件携带的出侧 Handle；从分支行拖出时为分支值，其余场景可能缺失。
 * @param sourceId 判断节点标识。
 * @param edges 当前画布连线。
 * @param ignoreEdgeId 重连场景需忽略的原连线标识；建线场景传 undefined。
 * @returns branch 为解析出的分支（两个分支都已占用时为 null）；hint 为需要提示的可行动文案。
 * @remarks 从分支行拖出时精确对应该分支，分支被占即提示；Handle 无法解析（从卡片主体拖出等）
 *   时自动分配空闲分支，满足优先——把拖拽落点误差兜成可用行为而非静默拒绝。
 */
function resolveConditionBranch(
  sourceHandle: string | null | undefined,
  sourceId: string,
  edges: StepCanvasEdge[],
  ignoreEdgeId?: string
): { branch: FlowBranchValue | null; hint: string | null } {
  const used = new Set(
    edges
      .filter((edge) => edge.source === sourceId && edge.id !== ignoreEdgeId)
      .map((edge) => edge.sourceHandle)
  )
  if (sourceHandle === 'true' || sourceHandle === 'false') {
    if (!used.has(sourceHandle)) {
      return { branch: sourceHandle, hint: null }
    }
    return {
      branch: null,
      hint: `${BRANCH_LABELS[sourceHandle]}出口已连线：拖动这条线的端点可换目标，或删线后重连`
    }
  }
  const free = BRANCH_ORDER.find((branch) => !used.has(branch))
  if (!free) {
    return { branch: null, hint: '判断节点的两个出口都已连线：删掉一条线后再连' }
  }
  return { branch: free, hint: null }
}

/** 编排画布草稿控制面：状态字段与全部画布操作。 */
export type FlowCanvasController = {
  /** 草稿流程名；装载流程时随包回写，保存后经 rename 回写归一名。 */
  flowName: string
  /** 用户是否手动编辑过流程名：保存时区分继承名与手输名。 */
  flowNameEdited: boolean
  /** 画布是否有未落盘的修改。 */
  dirty: boolean
  /** 画布步骤节点。 */
  rfNodes: StepCanvasNode[]
  /** 画布连线。 */
  rfEdges: StepCanvasEdge[]
  /** 入口节点标识。 */
  entry: string | null
  /** 单击选中的节点标识（参数面板用）。 */
  selectedNodeKey: string | null
  /** 单击选中的连线标识（高亮与批量删除用）。 */
  selectedEdgeId: string | null
  /** React Flow 实例引用。 */
  flowInstance: ReactFlowInstance<StepCanvasNode, StepCanvasEdge> | null
  /** @description 记录 React Flow 实例。 */
  setFlowInstance: (instance: ReactFlowInstance<StepCanvasNode, StepCanvasEdge>) => void
  /**
   * @description 更新草稿流程名（用户输入路径）：先捕获撤销快照再写值并标记脏状态。
   * @param name 新流程名。
   */
  setFlowName: (name: string) => void
  /**
   * @description 回写流程名但不产生撤销快照、不标记脏状态。
   * @param name 回写的流程名。
   * @remarks 供装载流程回写显示名与保存回写归一名使用。
   */
  rename: (name: string) => void
  /**
   * @description 记录单击选中的节点，并清除连线选中。
   * @param id 节点标识。
   */
  selectNode: (id: string) => void
  /**
   * @description 记录单击选中的连线，并清除节点选中。
   * @param id 连线标识。
   */
  selectEdge: (id: string) => void
  /** @description 清除单击选中态。 */
  clearSelection: () => void
  /**
   * @description 同步 React Flow 的选中集合（Shift 框选与 Ctrl 点选），供批量删除使用。
   * @param selection 当前选中的节点与连线。
   */
  handleSelectionChange: (selection: { nodes: StepCanvasNode[]; edges: StepCanvasEdge[] }) => void
  /**
   * @description 把当前画布快照压入撤销栈。
   * @param force 为 true 时跳过防抖窗口立即捕获。
   */
  capture: (force?: boolean) => void
  /** @description 撤销上一次变更。 */
  undo: () => void
  /** @description 重做上一次撤销的变更。 */
  redo: () => void
  /**
   * @description 添加一个步骤节点；首个节点自动成为入口。
   * @param type 步骤类型。
   */
  addNode: (type: FlowStepType) => void
  /**
   * @description 复制一个节点：克隆步骤配置并偏移摆放。
   * @param key 源节点标识。
   */
  duplicateNode: (key: string) => void
  /**
   * @description 更新指定节点的步骤配置（用户编辑路径）。
   * @param key 节点标识。
   * @param patch 配置补丁。
   */
  patchNodeConfig: (key: string, patch: Partial<FlowStepConfig>) => void
  /**
   * @description 读取节点当前步骤配置。
   * @param key 节点标识。
   * @returns 步骤配置；节点不存在时返回 null。
   */
  getStepConfig: (key: string) => FlowStepConfig | null
  /**
   * @description 静默补写节点默认配置：不产生撤销快照、不标记脏状态。
   * @param key 节点标识。
   * @param patch 配置补丁。
   * @remarks 供装载后自动补默认模型与保底模拟角色槽位使用，避免打开流程即出现「未保存」。
   */
  patchNodeConfigSilent: (key: string, patch: Partial<FlowStepConfig>) => void
  /**
   * @description 连线有效性判定：判断节点顶部入口只进不出，分支 Handle 不接受入线。
   * @param connection React Flow 连接关系（建线时为 Connection，重连时为完整边）。
   * @returns 是否允许该连接。
   * @remarks 供 ReactFlow 的 isValidConnection 使用，拖拽过程中实时拦截无效连接。
   */
  isValidConnection: (connection: Connection | Edge) => boolean
  /**
   * @description 删除一个节点及其全部连线；入口节点被删时入口顺延到首个剩余节点。
   * @param key 节点标识。
   */
  removeNode: (key: string) => void
  /**
   * @description 删除当前选中的全部连线或节点（节点连带其全部连线）。
   * @remarks 单击选中同样进入选中集合，因此本方法同时覆盖单选与多选删除。
   */
  removeSelection: () => void
  /**
   * @description 把某个节点设为流程入口。
   * @param key 节点标识。
   */
  setEntryNode: (key: string) => void
  /**
   * @description 建立连线：自环、重复边与同一节点的第二条无条件出边直接拒绝。
   * @param connection React Flow 新连接。
   */
  handleConnect: (connection: Connection) => void
  /**
   * @description 拖动已有连线端点后重连：复用建线校验，并按新端点重新生成连线标识。
   * @param oldEdge 被拖动的原连线。
   * @param connection 新的连接关系。
   * @remarks 保留原标识会让连线 ID 脱离「端点对」语义，后续新建同对连线时产生重复 ID，
   *   因此重连后统一按新端点重建标识并同步选中态。
   */
  handleReconnect: (oldEdge: StepCanvasEdge, connection: Connection) => void
  /**
   * @description RF 节点变更同步：位置、尺寸与选中态交给库；缩放手势开始时捕获撤销快照，结束标记草稿修改。
   * @param changes React Flow 节点变更。
   */
  handleNodesChange: (changes: NodeChange<StepCanvasNode>[]) => void
  /**
   * @description RF 连线变更同步。
   * @param changes React Flow 连线变更。
   */
  handleEdgesChange: (changes: EdgeChange<StepCanvasEdge>[]) => void
  /** @description 节点拖拽结束：摆位属于草稿内容，标记未保存。 */
  handleDragStop: () => void
  /** @description 按入口层级重新排列节点位置并适配视图。 */
  autoLayout: () => void
  /**
   * @description 把已保存流程包装载为画布草稿：切换种类、回写显示名并重置历史与脏标记。
   * @param pkg 流程包。
   * @param displayName 画布显示的流程名；装载标准流程时由文档层传入副本名。
   * @remarks 坐标取流程包内的摆位记录；不自动补外部输入节点——用户删除后保存的流程保持原样，
   *   缺失由运行前置校验提示。
   */
  applyLoadedFlow: (pkg: FlowPackage, displayName: string) => void
  /** @description 清空画布为未命名草稿：节点、连线、入口、流程名、选中态、脏标记与历史全部重置。 */
  resetDraft: () => void
  /** @description 保存成功后回写：清除脏标记。 */
  markSaved: () => void
}

/**
 * @description 计算新建节点的落点：画布可视区中心按卡片宽度居中。
 * @param instance React Flow 实例；初始化前为 null。
 * @param type 步骤类型（决定卡片宽度）。
 * @returns 流程坐标落点；实例或画布元素缺失时退回固定位置。
 */
function resolveAddPosition(
  instance: ReactFlowInstance<StepCanvasNode, StepCanvasEdge> | null,
  type: FlowStepType
): { x: number; y: number } {
  const pane = document.querySelector('.react-flow__pane')
  if (!instance || !pane) {
    return { x: 80, y: 120 }
  }
  const rect = pane.getBoundingClientRect()
  const center = instance.screenToFlowPosition({
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  })
  return { x: center.x - nodeCardWidth(type) / 2, y: center.y - 48 }
}

/**
 * @description 创建编排画布草稿：状态、历史与操作面。
 * @returns 画布草稿控制面。
 * @remarks flowName 属于草稿状态，随撤销快照回滚；流程身份由文档层持有，本钩子不感知。
 */
export function useFlowCanvas(): FlowCanvasController {
  const [flowName, setFlowNameState] = useState('')
  const [flowNameEdited, setFlowNameEdited] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [rfNodes, setRfNodes] = useState<StepCanvasNode[]>([])
  const [rfEdges, setRfEdges] = useState<StepCanvasEdge[]>([])
  const [entry, setEntry] = useState<string | null>(null)
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [multiNodeIds, setMultiNodeIds] = useState<string[]>([])
  const [multiEdgeIds, setMultiEdgeIds] = useState<string[]>([])
  const [flowInstance, setFlowInstance] = useState<
    ReactFlowInstance<StepCanvasNode, StepCanvasEdge> | null
  >(null)
  /** 画布最新状态镜像：撤销捕获与异步回调读取用。 */
  const stateRef = useRef({ rfNodes, rfEdges, entry })
  useEffect(() => {
    stateRef.current = { rfNodes, rfEdges, entry }
  })
  /** 最新流程名镜像：撤销捕获读取用。 */
  const nameRef = useRef(flowName)
  useEffect(() => {
    nameRef.current = flowName
  })
  /** 本次缩放手势是否已捕获撤销快照。 */
  const resizeCaptureRef = useRef(false)

  const getSnapshot = useCallback((): CanvasSnapshot => {
    const state = stateRef.current
    return {
      nodes: state.rfNodes.map((node) => ({ ...node, data: { ...node.data } })),
      edges: state.rfEdges.map((edge) => ({ ...edge, data: { ...edge.data } })),
      entry: state.entry,
      name: nameRef.current
    }
  }, [])

  const applySnapshot = useCallback((snapshot: CanvasSnapshot): void => {
    setRfNodes(snapshot.nodes)
    setRfEdges(snapshot.edges)
    setEntry(snapshot.entry)
    setFlowNameState(snapshot.name)
    setSelectedNodeKey(null)
    setSelectedEdgeId(null)
    setMultiNodeIds([])
    setMultiEdgeIds([])
    setDirty(true)
  }, [])

  const history: CanvasHistory = useCanvasHistory({ getSnapshot, apply: applySnapshot })
  const { capture, undo, redo, reset: resetHistory } = history

  /** 用户输入路径的流程名更新：先捕获快照再写值并标记脏状态。 */
  const setFlowName = useCallback(
    (name: string): void => {
      capture()
      setFlowNameState(name)
      setFlowNameEdited(true)
      setDirty(true)
    },
    [capture]
  )

  /** 回写流程名但不产生撤销快照、不标记脏状态。 */
  const rename = useCallback((name: string): void => {
    setFlowNameState(name)
    setFlowNameEdited(false)
  }, [])

  const selectNode = useCallback((id: string): void => {
    setSelectedNodeKey(id)
    setSelectedEdgeId(null)
  }, [])

  const selectEdge = useCallback((id: string): void => {
    setSelectedEdgeId(id)
    setSelectedNodeKey(null)
  }, [])

  const clearSelection = useCallback((): void => {
    setSelectedNodeKey(null)
    setSelectedEdgeId(null)
  }, [])

  const handleSelectionChange = useCallback(
    (selection: { nodes: StepCanvasNode[]; edges: StepCanvasEdge[] }): void => {
      setMultiNodeIds(selection.nodes.map((node) => node.id))
      setMultiEdgeIds(selection.edges.map((edge) => edge.id))
    },
    []
  )

  /** 在画布上添加一个步骤节点；首个节点自动成为入口。 */
  const addNode = useCallback(
    (type: FlowStepType): void => {
      capture(true)
      const position = resolveAddPosition(flowInstance, type)
      setRfNodes((previous) => {
        const id = createStepId()
        const node = createStepNode(type, id, position)
        if (previous.length === 0) {
          setEntry(id)
        }
        return [...previous, node]
      })
      setDirty(true)
    },
    [capture, flowInstance]
  )

  /** 复制一个节点：克隆步骤配置并偏移摆放。 */
  const duplicateNode = useCallback(
    (key: string): void => {
      capture(true)
      setRfNodes((previous) => {
        const source = previous.find((node) => node.id === key)
        if (!source) {
          return previous
        }
        const id = createStepId()
        return [
          ...previous,
          {
            id,
            type: 'step' as const,
            width: source.width ?? nodeCardWidth(source.data.step.type),
            ...(source.height ? { height: source.height } : {}),
            position: { x: source.position.x + 32, y: source.position.y + 32 },
            data: {
              step: { ...source.data.step, id, config: { ...source.data.step.config } },
              isEntry: false
            }
          }
        ]
      })
      setDirty(true)
    },
    [capture]
  )

  /** 更新选中节点的步骤配置。 */
  const patchNodeConfig = useCallback(
    (key: string, patch: Partial<FlowStepConfig>): void => {
      capture()
      setRfNodes((previous) =>
        previous.map((item) =>
          item.id === key
            ? {
                ...item,
                data: {
                  ...item.data,
                  step: { ...item.data.step, config: { ...item.data.step.config, ...patch } }
                }
              }
            : item
        )
      )
      setDirty(true)
    },
    [capture]
  )

  /** 读取节点当前步骤配置。 */
  const getStepConfig = useCallback((key: string): FlowStepConfig | null => {
    const node = stateRef.current.rfNodes.find((item) => item.id === key)
    return node?.data.step.config ?? null
  }, [])

  /** 静默补写节点默认配置。 */
  const patchNodeConfigSilent = useCallback(
    (key: string, patch: Partial<FlowStepConfig>): void => {
      setRfNodes((previous) =>
        previous.map((item) =>
          item.id === key
            ? {
                ...item,
                data: {
                  ...item.data,
                  step: { ...item.data.step, config: { ...item.data.step.config, ...patch } }
                }
              }
            : item
        )
      )
    },
    []
  )

  /** 连线有效性判定：判断节点入口（顶/左/右）只进不出，分支 Handle 不接受入线。 */
  const isValidConnection = useCallback((connection: Connection | Edge): boolean => {
    const nodes = stateRef.current.rfNodes
    const sourceNode = nodes.find((node) => node.id === connection.source)
    if (
      sourceNode?.data.step.type === 'condition' &&
      isConditionEntryHandle(connection.sourceHandle)
    ) {
      return false
    }
    const targetNode = nodes.find((node) => node.id === connection.target)
    if (
      targetNode?.data.step.type === 'condition' &&
      (connection.targetHandle === 'true' || connection.targetHandle === 'false')
    ) {
      return false
    }
    return true
  }, [])

  /** 删除一个节点及其全部连线；入口节点被删时入口顺延到首个剩余节点。 */
  const removeNode = useCallback(
    (key: string): void => {
      capture(true)
      setRfNodes((previous) => previous.filter((node) => node.id !== key))
      setRfEdges((previous) =>
        previous.filter((edge) => edge.source !== key && edge.target !== key)
      )
      setSelectedNodeKey((previous) => (previous === key ? null : previous))
      setMultiNodeIds((previous) => previous.filter((id) => id !== key))
      setEntry((previous) => {
        if (previous !== key) {
          return previous
        }
        const remaining = stateRef.current.rfNodes.filter((node) => node.id !== key)
        return remaining[0]?.id ?? null
      })
      setDirty(true)
    },
    [capture]
  )

  /** 删除当前选中的全部连线或节点（节点连带其全部连线）。 */
  const removeSelection = useCallback((): void => {
    if (multiEdgeIds.length > 0) {
      capture(true)
      const idSet = new Set(multiEdgeIds)
      setRfEdges(stateRef.current.rfEdges.filter((edge) => !idSet.has(edge.id)))
      setSelectedEdgeId((previous) => (previous && idSet.has(previous) ? null : previous))
      setMultiEdgeIds([])
      setDirty(true)
      return
    }
    if (multiNodeIds.length > 0) {
      capture(true)
      const idSet = new Set(multiNodeIds)
      setRfNodes(stateRef.current.rfNodes.filter((node) => !idSet.has(node.id)))
      setRfEdges(
        stateRef.current.rfEdges.filter(
          (edge) => !idSet.has(edge.source) && !idSet.has(edge.target)
        )
      )
      setEntry((previous) => {
        if (previous && !idSet.has(previous)) {
          return previous
        }
        const remaining = stateRef.current.rfNodes.filter((node) => !idSet.has(node.id))
        return remaining[0]?.id ?? null
      })
      setSelectedNodeKey((previous) => (previous && idSet.has(previous) ? null : previous))
      setMultiNodeIds([])
      setDirty(true)
    }
  }, [capture, multiEdgeIds, multiNodeIds])

  /** 把某个节点设为流程入口。 */
  const setEntryNode = useCallback(
    (key: string): void => {
      capture(true)
      setEntry(key)
      setDirty(true)
    },
    [capture]
  )

/**
 * @description 建立连线：自环与重复边拒绝；非判断节点仅一条出边，判断节点从满足/不满足分支行
 *   出线、每分支至多一条，分支无法解析时自动分配空闲分支。
 * @param connection React Flow 新连接。
 */
const handleConnect = useCallback(
    (connection: Connection): void => {
      if (!connection.source || !connection.target) {
        return
      }
      if (connection.source === connection.target) {
        toast.warning('不能连接节点自身。')
        return
      }
      const edges = stateRef.current.rfEdges
      const duplicated = edges.some(
        (edge) => edge.source === connection.source && edge.target === connection.target
      )
      if (duplicated) {
        toast.warning('这两个节点之间已有连线。')
        return
      }
      const sourceNode = stateRef.current.rfNodes.find(
        (node) => node.id === connection.source
      )
      const sourceType = sourceNode?.data.step.type
      if (sourceType === 'condition' && isConditionEntryHandle(connection.sourceHandle)) {
        toast.warning('判断节点只能从底部的「满足/不满足」出口出线。')
        return
      }
      let branch: FlowBranchValue | undefined
      if (sourceType === 'condition') {
        const resolved = resolveConditionBranch(
          connection.sourceHandle,
          connection.source,
          edges
        )
        if (resolved.branch === null) {
          if (resolved.hint) {
            toast.warning(resolved.hint)
          }
          return
        }
        branch = resolved.branch
      } else {
        // 非判断节点只允许一条出边。
        const siblingCount = edges.filter((edge) => edge.source === connection.source).length
        if (siblingCount > 0) {
          toast.warning('该节点已有出边：只有判断节点可以分支。')
          return
        }
      }
      capture(true)
      const sides = resolveEdgeSides(connection, stateRef.current.rfNodes)
      const nextEdge: StepCanvasEdge = {
        id: `e-${connection.source}-${connection.target}`,
        source: connection.source as string,
        target: connection.target as string,
        sourceHandle: branch ?? sides.sourceHandle,
        targetHandle: sides.targetHandle,
        data: {}
      }
      setRfEdges((previous) => [...previous, nextEdge])
      setDirty(true)
    },
    [capture]
  )

  /**
   * @description 拖动已有连线端点后重连：复用自环与重复边校验，按新端点重新生成连线标识；
   *   新起点决定分支标记（判断节点分支行，无法解析时自动分配空闲分支）或端点侧别。
   * @param oldEdge 被拖动的原连线。
   * @param connection 新的连接关系。
   * @remarks 保留原标识会让连线 ID 脱离「端点对」语义，后续新建同对连线时产生重复 ID，
   *   因此重连后统一按新端点重建标识并同步选中态。
   */
  const handleReconnect = useCallback(
    (oldEdge: StepCanvasEdge, connection: Connection): void => {
      if (!connection.source || !connection.target) {
        return
      }
      if (connection.source === connection.target) {
        toast.warning('不能连接节点自身。')
        return
      }
      const edges = stateRef.current.rfEdges
      const duplicated = edges.some(
        (edge) =>
          edge.id !== oldEdge.id &&
          edge.source === connection.source &&
          edge.target === connection.target
      )
      if (duplicated) {
        toast.warning('这两个节点之间已有连线。')
        return
      }
      const sourceNode = stateRef.current.rfNodes.find(
        (node) => node.id === connection.source
      )
      const sourceType = sourceNode?.data.step.type
      if (sourceType === 'condition' && isConditionEntryHandle(connection.sourceHandle)) {
        toast.warning('判断节点只能从底部的「满足/不满足」出口出线。')
        return
      }
      let branch: FlowBranchValue | undefined
      if (sourceType === 'condition') {
        const resolved = resolveConditionBranch(
          connection.sourceHandle,
          connection.source,
          edges,
          oldEdge.id
        )
        if (resolved.branch === null) {
          if (resolved.hint) {
            toast.warning(resolved.hint)
          }
          return
        }
        branch = resolved.branch
      } else {
        const siblingCount = edges.filter(
          (edge) => edge.id !== oldEdge.id && edge.source === connection.source
        ).length
        if (siblingCount > 0) {
          toast.warning('该节点已有出边：只有判断节点可以分支。')
          return
        }
      }
      capture(true)
      const sides = resolveEdgeSides(connection, stateRef.current.rfNodes)
      const nextId = `e-${connection.source}-${connection.target}`
      const nextEdges = reconnectEdge(oldEdge, connection, edges).map((edge) =>
        edge.id === oldEdge.id
          ? {
              ...edge,
              id: nextId,
              sourceHandle: branch ?? sides.sourceHandle,
              targetHandle: sides.targetHandle
            }
          : edge
      )
      setRfEdges(nextEdges)
      setSelectedEdgeId(nextId)
      setDirty(true)
    },
    [capture]
  )

  /** RF 节点变更同步：缩放手势开始时捕获撤销快照，结束即视为草稿修改。 */
  const handleNodesChange = useCallback(
    (changes: NodeChange<StepCanvasNode>[]): void => {
      if (changes.some((change) => change.type === 'dimensions' && change.resizing === true)) {
        if (!resizeCaptureRef.current) {
          resizeCaptureRef.current = true
          capture(true)
        }
      }
      if (changes.some((change) => change.type === 'dimensions' && change.resizing === false)) {
        resizeCaptureRef.current = false
        setDirty(true)
      }
      setRfNodes((previous) => applyNodeChanges(changes, previous))
    },
    [capture]
  )

  /** RF 连线变更同步。 */
  const handleEdgesChange = useCallback((changes: EdgeChange<StepCanvasEdge>[]): void => {
    setRfEdges((previous) => applyEdgeChanges(changes, previous))
  }, [])

  /** 节点拖拽结束：摆位属于草稿内容，标记未保存，保存时随流程包落盘。 */
  const handleDragStop = useCallback((): void => {
    setDirty(true)
  }, [])

  /** 按入口层级重新排列节点位置并适配视图。 */
  const autoLayout = useCallback((): void => {
    const state = stateRef.current
    if (!state.entry || state.rfNodes.length === 0) {
      return
    }
    capture(true)
    const positions = layoutGraph({
      entry: state.entry,
      nodes: state.rfNodes.map((node) => node.data.step),
      edges: state.rfEdges.map((edge) => ({
        from: edge.source,
        to: edge.target,
        ...(edge.data?.condition ? { condition: edge.data.condition } : {})
      }))
    })
    const nextNodes = state.rfNodes.map((node) => ({
      ...node,
      position: positions.get(node.id) ?? node.position
    }))
    setRfNodes(nextNodes)
    requestAnimationFrame(() => {
      void flowInstance?.fitView({ padding: 0.15, duration: 200 })
    })
    setDirty(true)
  }, [capture, flowInstance])

  /** 把已保存流程包装载为画布草稿。 */
  const applyLoadedFlow = useCallback(
    (pkg: FlowPackage, displayName: string): void => {
      const { nodes, edges } = toCanvas(pkg.graph)
      setRfNodes(
        nodes.map((node) => ({
          ...node,
          data: { ...node.data, step: withDefaultPrompt(node.data.step) }
        }))
      )
      setRfEdges(edges)
      setEntry(pkg.graph.entry)
      setFlowNameState(displayName)
      setFlowNameEdited(false)
      setSelectedNodeKey(null)
      setSelectedEdgeId(null)
      setMultiNodeIds([])
      setMultiEdgeIds([])
      setDirty(false)
      resetHistory()
    },
    [resetHistory]
  )

  /** 清空画布为未命名草稿。 */
  const resetDraft = useCallback((): void => {
    setRfNodes([])
    setRfEdges([])
    setEntry(null)
    setFlowNameState('')
    setFlowNameEdited(false)
    setSelectedNodeKey(null)
    setSelectedEdgeId(null)
    setMultiNodeIds([])
    setMultiEdgeIds([])
    setDirty(false)
    resetHistory()
  }, [resetHistory])

  /** 保存成功后回写：清除脏标记。 */
  const markSaved = useCallback((): void => {
    setDirty(false)
  }, [])

  // 键盘：撤销/重做优先于删除判定；Shift+1 适配视图；Delete 键批量删除当前选中（输入控件聚焦时除外）。
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) {
          redo()
        } else {
          undo()
        }
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redo()
        return
      }
      if (event.shiftKey && event.key === '1') {
        event.preventDefault()
        void flowInstance?.fitView({ padding: 0.15, duration: 200 })
        return
      }
      if (event.key !== 'Delete' && event.key !== 'Backspace') {
        return
      }
      removeSelection()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [flowInstance, redo, removeSelection, undo])

  return {
    flowName,
    flowNameEdited,
    dirty,
    rfNodes,
    rfEdges,
    entry,
    selectedNodeKey,
    selectedEdgeId,
    flowInstance,
    setFlowInstance,
    setFlowName,
    rename,
    selectNode,
    selectEdge,
    clearSelection,
    handleSelectionChange,
    capture,
    undo,
    redo,
    addNode,
    duplicateNode,
    patchNodeConfig,
    getStepConfig,
    patchNodeConfigSilent,
    removeNode,
    removeSelection,
    setEntryNode,
    handleConnect,
    handleReconnect,
    isValidConnection,
    handleNodesChange,
    handleEdgesChange,
    handleDragStop,
    autoLayout,
    applyLoadedFlow,
    resetDraft,
    markSaved
  }
}
