/**
 * @description Agent 流程编排窗口：用画布编辑正式流程包（步骤节点 + 判断节点分支），经 flows IPC 存取。
 * @returns 编排画布根页面。
 * @remarks 本组件是 agent-lab 独立入口的根，复用主应用 common 层组件与全局样式；状态与操作
 *   分别由 use-flow-canvas（画布草稿）、use-flow-document（流程存取）与 use-flow-debug（调试运行）
 *   承担，本组件只负责组装与渲染。画布只产出声明式流程包，不执行模型请求。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { FileDown, FileUp, Minus, Moon, Redo2, Save, Square, Sun, Trash2, Undo2, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  type FlowDebugCharacter,
  type FlowNodeRawExchange,
  type FlowStepType
} from '@gamechat/type'
import {
  FLOW_BUILTIN_VARIABLES,
  FLOW_BUILTIN_VARIABLE_DESCRIPTIONS,
  FLOW_FINAL_ANSWER_SECTION_VARIABLES,
  FLOW_SECTION_VARIABLE_DESCRIPTIONS,
  normalizeFlowPackage
} from '@gamechat/schema'
import { Button } from '@renderer/common/components/button'
import { getIpcErrorMessage } from '@renderer/common/lib/error-message'
import { getCharacterPrompt } from './services'
import {
  STEP_CATEGORY_META,
  STEP_META,
  STEP_ORDER,
  collectVariableNames,
  initialEdgeSides,
  toFlowPackage,
  validateFlow,
  type StepCanvasEdge,
  type StepCanvasNode
} from './flow-model'
import {
  StepEditorContext,
  StepNodeCard,
  type StepEditorContextValue
} from './node-ui'
import type { ConditionVariableGroup } from './prompt-textarea'
import { useFlowCanvas } from './use-flow-canvas'
import { useFlowDocument } from './use-flow-document'
import { useReferenceData } from './use-reference-data'
import { useConfirm } from './confirm-dialog'
import { Select } from './select'
import { RunTray } from './run-tray'
import { ContextMenuCard } from './context-menu'
import { useFlowDebug } from './use-flow-debug'

/**
 * @description 画布控制条：React Flow 内置控制钮补上中文操作与快捷键提示。
 * @remarks 控制钮的 aria-label 为固定英文文案，挂载后按它匹配写入中文 title；
 *   适配视图的 Shift+1 快捷键由画布键盘绑定提供，未匹配的按钮不加提示。
 */
function CanvasControls(): ReactElement {
  useEffect(() => {
    const titles: Record<string, string> = {
      'Zoom In': '放大（快捷键：滚轮向上）',
      'Zoom Out': '缩小（快捷键：滚轮向下）',
      'Fit View': '适配视图（快捷键：Shift+1）',
      Lock: '锁定画布交互',
      Unlock: '解锁画布交互'
    }
    const buttons = document.querySelectorAll<HTMLButtonElement>(
      '.react-flow__controls button'
    )
    buttons.forEach((button) => {
      const label = button.getAttribute('aria-label')
      if (label && titles[label]) {
        button.title = titles[label]
      }
    })
  }, [])
  return <Controls />
}

/**
 * @description 用 DFS 标记闭环回边。
 * @param nodes 画布节点。
 * @param edges 画布边。
 * @param entry 入口节点标识。
 * @returns 回边 ID 集合。
 * @remarks 只有指回当前 DFS 栈上节点的边才算回边；捷径边（如 gate → answer）
 *   不会被误判，避免把正向边画成虚线。
 */
function computeBackEdges(
  nodes: StepCanvasNode[],
  edges: StepCanvasEdge[],
  entry: string | null
): Set<string> {
  const backEdges = new Set<string>()
  const state = new Map<string, 'visiting' | 'visited'>()
  const outgoing = new Map<string, StepCanvasEdge[]>()
  for (const edge of edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge])
  }
  const visit = (nodeId: string): void => {
    state.set(nodeId, 'visiting')
    for (const edge of outgoing.get(nodeId) ?? []) {
      const targetState = state.get(edge.target)
      if (targetState === 'visiting') {
        backEdges.add(edge.id)
      } else if (!targetState) {
        visit(edge.target)
      }
    }
    state.set(nodeId, 'visited')
  }
  if (entry && nodes.some((node) => node.id === entry)) {
    visit(entry)
  }
  for (const node of nodes) {
    if (!state.has(node.id)) {
      visit(node.id)
    }
  }
  return backEdges
}

/**
 * @description 组装编排画布页面：装配画布、文档与调试钩子并渲染工具栏、画布与各面板。
 * @returns 编排画布根页面。
 */
export function AgentLabPage(): ReactElement {
  const debugResetRef = useRef<() => void>(() => {})
  const canvas = useFlowCanvas()
  const { confirm, dialog: confirmDialog } = useConfirm()
  const doc = useFlowDocument({ canvas, debugResetRef, confirm })
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeKey: string } | null>(
    null
  )
  const fileInputRef = useRef<HTMLInputElement>(null)

  /** 画布外部输入节点：用户消息、模型与模拟角色都收敛在这一个节点里。 */
  const environmentNode = canvas.rfNodes.find(
    (node) => node.data.step.type === 'environmentInput'
  )
  const debugInput = environmentNode?.data.step.config?.inputText ?? ''
  const debugModelId = environmentNode?.data.step.config?.modelId ?? ''
  /** 模拟角色数量：工具目录按其解析群聊回合（多于一个不绑定图片工具）。 */
  const characterCount = (environmentNode?.data.step.config?.simulatedCharacters ?? []).length
  const reference = useReferenceData(characterCount)

  /** 角色标识到展示名的映射：模拟角色填充过已有角色时沿用其名字。 */
  const characterNames = useMemo(
    () => new Map(reference.characters.map((item) => [item.id, item.name])),
    [reference.characters]
  )

  /** 外部输入节点里的模拟角色，按顺序生成运行内的角色标识。 */
  const debugCharacters = useMemo<FlowDebugCharacter[]>(() => {
    const simulated = environmentNode?.data.step.config?.simulatedCharacters ?? []
    return simulated.map((character, index) => ({
      id: `${environmentNode?.id ?? 'environment-input'}:${index}`,
      name:
        (character.sourceCharacterId
          ? characterNames.get(character.sourceCharacterId)
          : undefined) ?? `角色 ${index + 1}`,
      prompt: character.prompt ?? '',
      ...(character.sourceCharacterId ? { sourceCharacterId: character.sourceCharacterId } : {})
    }))
  }, [characterNames, environmentNode])

  /** 调试用画布草稿：结构不完整时为 null。 */
  const draftFlow = useMemo(
    () =>
      canvas.entry && canvas.rfNodes.length > 0
        ? normalizeFlowPackage(
            toFlowPackage(
              { id: doc.flowId || 'draft', name: canvas.flowName || 'draft' },
              canvas.rfNodes,
              canvas.rfEdges,
              canvas.entry
            )
          )
        : null,
    [canvas.entry, canvas.flowName, canvas.rfEdges, canvas.rfNodes, doc.flowId]
  )

  const debug = useFlowDebug({
    flow: draftFlow,
    userInput: debugInput,
    modelId: debugModelId,
    characters: debugCharacters
  })

  useEffect(() => {
    debugResetRef.current = debug.reset
  }, [debug.reset])

  // 外部输入节点至少保留一个模拟角色槽位，避免运行被空角色列表挡住。
  const patchSilent = canvas.patchNodeConfigSilent
  useEffect(() => {
    if (!environmentNode) {
      return
    }
    const simulated = environmentNode.data.step.config?.simulatedCharacters
    if (simulated && simulated.length > 0) {
      return
    }
    patchSilent(environmentNode.id, { simulatedCharacters: [{}] })
  }, [environmentNode, patchSilent])

  // 外部输入节点未选择模型时，默认填入第一个可用模型，避免运行被空选择挡住。
  const models = reference.models
  useEffect(() => {
    if (!environmentNode || models.length === 0) {
      return
    }
    if (environmentNode.data.step.config?.modelId) {
      return
    }
    patchSilent(environmentNode.id, { modelId: models[0].id })
  }, [environmentNode, models, patchSilent])

  /** 运行前置校验：画布结构、外部输入节点、模型与模拟角色数量，命中即给出可展示原因。 */
  const validation = useMemo(
    () => validateFlow(canvas.rfNodes, canvas.rfEdges, canvas.entry),
    [canvas.entry, canvas.rfEdges, canvas.rfNodes]
  )
  const runReason = useMemo((): string | null => {
    if (debug.running) {
      return null
    }
    if (!draftFlow) {
      return validation.ok ? '画布结构不完整：请检查连线与入口。' : validation.message
    }
    if (!environmentNode) {
      return '缺少「外部输入」节点：请从左侧步骤池添加后再运行。'
    }
    if (!debugModelId) {
      return '请在「外部输入」节点选择模型。'
    }
    return null
  }, [debug.running, draftFlow, validation, environmentNode, debugModelId, debugCharacters])

  /**
   * @description 从已有角色读取提示词并填充到外部输入节点的某个模拟角色。
   * @param nodeId 节点标识。
   * @param index 模拟角色序号。
   * @param characterId 来源角色标识。
   * @returns 无返回值。
   */
  const handleFillCharacter = useCallback(
    (nodeId: string, index: number, characterId: string): void => {
      void getCharacterPrompt(characterId)
        .then((document) => {
          const entries = canvas.getStepConfig(nodeId)?.simulatedCharacters ?? []
          const next = entries.map((entry, itemIndex) =>
            itemIndex === index
              ? {
                  ...entry,
                  prompt: document.prompt || entry.prompt,
                  sourceCharacterId: characterId
                }
              : entry
          )
          canvas.patchNodeConfig(nodeId, {
            simulatedCharacters: next.length > 0 ? next : undefined
          })
        })
        .catch((cause: unknown) =>
          toast.error(`读取角色提示词失败：${getIpcErrorMessage(cause)}`)
        )
    },
    [canvas.getStepConfig, canvas.patchNodeConfig]
  )

  const variableNames = useMemo(() => collectVariableNames(canvas.rfNodes), [canvas.rfNodes])

  /** 展示节点的调试数据映射：内容按上游类型取产出，逐段排列（模型/选人上游一段，角色回复每回合一段）；
      上游类型决定展示形态（执行工具上游显示工具调用轨迹，其余显示文本产出）。 */
  const debugDisplay = useMemo(() => {
    const content: Record<string, string[]> = {}
    const upstream: Record<string, FlowStepType> = {}
    const raws: Record<string, FlowNodeRawExchange[]> = {}
    for (const node of canvas.rfNodes) {
      if (node.data.step.type !== 'display') {
        continue
      }
      const incoming = canvas.rfEdges.find((edge) => edge.target === node.id)
      const source = incoming
        ? canvas.rfNodes.find((item) => item.id === incoming.source)
        : undefined
      if (!source) {
        continue
      }
      const sourceType = source.data.step.type
      upstream[node.id] = sourceType
      const lines: string[] = []
      if (
        sourceType === 'llm' ||
        sourceType === 'intent' ||
        sourceType === 'route' ||
        sourceType === 'selectSpeaker'
      ) {
        const text = debug.nodeOutputs[source.id] ?? ''
        if (text.trim()) {
          lines.push(text)
        }
        const rawsForSource = debug.nodeRaws[source.id]
        if (rawsForSource && rawsForSource.length > 0) {
          raws[node.id] = rawsForSource
        }
      } else if (sourceType === 'finalAnswer') {
        // 每回合一条「角色名：正文」；模型偶发自带名字前缀（模仿历史 [名字]： 格式）时不再叠加。
        for (const reply of debug.replies) {
          if (!reply.text.trim()) {
            continue
          }
          const prefix = reply.name ? `${reply.name}：` : ''
          const latinPrefix = reply.name ? `${reply.name}: ` : ''
          lines.push(
            reply.text.startsWith(prefix) || reply.text.startsWith(latinPrefix)
              ? reply.text
              : `${prefix}${reply.text}`
          )
        }
        const rawsForSource = debug.nodeRaws[source.id]
        if (rawsForSource && rawsForSource.length > 0) {
          raws[node.id] = rawsForSource
        }
      }
      if (lines.length > 0) {
        content[node.id] = lines
      }
    }
    return { content, upstream, raws }
  }, [canvas.rfNodes, canvas.rfEdges, debug.nodeOutputs, debug.nodeRaws, debug.replies])

  /** 是否正在拖线建连：拖线期间画布根挂 is-connecting，点亮全部候选出口。 */
  const [connecting, setConnecting] = useState(false)

  /** 悬停中的连线标识：悬停与选中的连线置顶，共享端点处抓取的永远是用户指到的那条。 */
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null)
  /** 编排窗口的明暗主题：本地偏好，持久化在 localStorage，仅影响本窗口。 */
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    localStorage.getItem('agent-lab:theme') === 'light' ? 'light' : 'dark'
  )
  /** 流程名是否处于编辑态：常态显示文本，点击进入输入框。 */
  const [editingName, setEditingName] = useState(false)

  // 主题应用到根元素：首帧前挂类避免明暗闪烁，偏好写入本地缓存供下次启动恢复；
  // .dark 类同时驱动 dark: 前缀变体，为暗色调色板的明色双写提供开关。
  useLayoutEffect(() => {
    const root = document.documentElement
    root.classList.toggle('light', theme === 'light')
    root.classList.toggle('dark', theme === 'dark')
    localStorage.setItem('agent-lab:theme', theme)
  }, [theme])

  /** 节点类型 → 稳定引用，避免 React Flow 反复重建节点类型。 */
  const nodeTypes = useMemo(() => ({ step: StepNodeCard }), [])

  /** 条件编辑的变量分组：运行时变量、节点输出与终答段，附中文说明。 */
  const conditionVariableGroups = useMemo<ConditionVariableGroup[]>(
    () => [
      {
        label: '运行时变量',
        options: Object.values(FLOW_BUILTIN_VARIABLES).map((value) => ({
          value,
          description: FLOW_BUILTIN_VARIABLE_DESCRIPTIONS[value] ?? ''
        }))
      },
      {
        label: '节点输出',
        options: Object.values(
          canvas.rfNodes.reduce<Record<string, ConditionVariableGroup['options'][number]>>(
            (acc, node) => {
              const name = node.data.step.config?.outputVariable?.trim()
              if (name && !acc[name]) {
                acc[name] = {
                  value: name,
                  description: `由节点「${STEP_META[node.data.step.type].label}」输出`
                }
              }
              return acc
            },
            {}
          )
        )
      },
      {
        label: '终答段',
        options: Object.values(FLOW_FINAL_ANSWER_SECTION_VARIABLES).map((value) => ({
          value,
          description: FLOW_SECTION_VARIABLE_DESCRIPTIONS[value] ?? ''
        }))
      }
    ],
    [canvas.rfNodes]
  )

  /** 节点内编辑器上下文：控制节点在卡片内读写画布状态。 */
  const editorContext = useMemo<StepEditorContextValue>(
    () => ({
      characters: reference.characters,
      models: reference.models,
      availableTools: reference.availableTools,
      debugRunning: debug.running,
      debugToolTraces: debug.toolTraces,
      debugDisplayContent: debugDisplay.content,
      debugDisplayUpstream: debugDisplay.upstream,
      debugDisplayRaw: debugDisplay.raws,
      debugActiveNodeId: debug.activeNodeId,
      debugVisitedNodeIds: debug.visitedNodeIds,
      debugFailedNodeId: debug.failedNodeId,
      variableGroups: conditionVariableGroups,
      onPatchConfig: (nodeId, patch) => canvas.patchNodeConfig(nodeId, patch),
      onRemoveNode: canvas.removeNode,
      onFillCharacter: handleFillCharacter
    }),
    [
      canvas.patchNodeConfig,
      canvas.removeNode,
      debug.running,
      debug.toolTraces,
      debug.activeNodeId,
      debug.visitedNodeIds,
      debug.failedNodeId,
      debugDisplay,
      handleFillCharacter,
      reference.availableTools,
      reference.characters,
      reference.models,
      conditionVariableGroups
    ]
  )

  /** 点击托盘错误文本：视图居中到推断出的失败节点。 */
  const locateFailedNode = useCallback((): void => {
    if (!debug.failedNodeId || !canvas.flowInstance) {
      return
    }
    void canvas.flowInstance.fitView({
      nodes: [{ id: debug.failedNodeId }],
      padding: 1,
      duration: 300
    })
  }, [canvas.flowInstance, debug.failedNodeId])

  /** 渲染用节点：入口标记与用户调整后的高度以画布状态为准注入。 */
  const displayNodes = useMemo(
    () =>
      canvas.rfNodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          isEntry: node.id === canvas.entry,
          ...(node.height ? { nodeHeight: node.height } : {})
        }
      })),
    [canvas.entry, canvas.rfNodes]
  )

  /** 渲染用边：端点侧别固定、按源节点类别着色、选中高亮、回边虚线；悬停与选中置顶，
      多条线共享同一连接点时，端点抓取命中的是用户正在指的那条。 */
  const displayEdges = useMemo(() => {
    const backEdges = computeBackEdges(canvas.rfNodes, canvas.rfEdges, canvas.entry)
    return canvas.rfEdges.map((edge) => {
      const sourceNode = canvas.rfNodes.find((node) => node.id === edge.source)
      const targetNode = canvas.rfNodes.find((node) => node.id === edge.target)
      const sourceType = sourceNode?.data.step.type
      const edgeColor = STEP_CATEGORY_META[STEP_META[sourceType ?? 'llm'].category].edge[theme]
      const isSelected = edge.id === canvas.selectedEdgeId
      const isHovered = edge.id === hoveredEdgeId
      const isBack = backEdges.has(edge.id)
      const fallback =
        sourceNode && targetNode
          ? initialEdgeSides(sourceNode, targetNode)
          : { sourceHandle: 'right', targetHandle: 'left' }
      const handles = {
        sourceHandle: edge.sourceHandle ?? fallback.sourceHandle,
        targetHandle: edge.targetHandle ?? fallback.targetHandle
      }
      const color = isSelected ? '#e8c690' : edgeColor
      return {
        ...edge,
        ...handles,
        zIndex: isSelected ? 20 : isHovered ? 10 : undefined,
        style: {
          stroke: color,
          strokeWidth: isSelected ? 2.5 : 2,
          ...(isBack ? { strokeDasharray: '6 4' } : {}),
          ...(isSelected ? { filter: 'drop-shadow(0 0 3px rgb(232 198 144 / 60%))' } : {})
        },
        markerEnd: { type: MarkerType.ArrowClosed, color }
      }
    })
  }, [canvas.entry, canvas.rfEdges, canvas.rfNodes, canvas.selectedEdgeId, hoveredEdgeId, theme])

  // 右键菜单：点击画布任意处关闭。
  useEffect(() => {
    if (!contextMenu) {
      return
    }
    const close = (): void => setContextMenu(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [contextMenu])

  return (
    <div className="bg-background text-foreground flex h-screen flex-col">
      {/* 工具栏兼任无边框窗口的拖拽区；按钮、下拉与输入框经 no-drag 保留点击。
          不换行：窗口控制按钮 shrink-0 固定在行尾，窄窗口时由中间可收缩控件让位。 */}
      <header
        data-drag-region
        className="border-border bg-background/80 sticky top-0 z-10 flex flex-nowrap items-center gap-2 overflow-hidden border-b px-4 py-2 backdrop-blur"
      >
        <span className="mr-2 shrink-0 text-sm font-semibold tracking-wide">流程画布</span>
        <span className="bg-muted/60 h-5 w-px shrink-0" />
        <Select
          className="no-drag max-w-44 min-w-0"
          value={doc.flowId}
          placeholder="打开流程…"
          options={doc.flowList.map((flow) => ({
            value: flow.id,
            label: flow.name
          }))}
          onChange={(next) => {
            if (next) {
              void doc.openFlowById(next)
            }
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          className="no-drag shrink-0"
          disabled={doc.busy}
          onClick={() => void doc.createBlankFlow()}
        >
          新建
        </Button>
        <div className="flex-1" />
        {editingName ? (
          <input
            autoFocus
            className="no-drag border-border bg-muted/40 w-56 min-w-0 rounded border px-2 py-1 text-xs outline-none focus:border-primary/60"
            placeholder="流程名称"
            title={doc.flowId ? `流程 ID：${doc.flowId}` : '保存后生成流程 ID'}
            value={canvas.flowName}
            onChange={(event) => canvas.setFlowName(event.target.value)}
            onBlur={() => setEditingName(false)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === 'Escape') {
                setEditingName(false)
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="no-drag flex min-w-32 max-w-64 cursor-pointer items-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-xs transition-colors hover:border-border"
            title={doc.flowId ? `点击重命名；流程 ID：${doc.flowId}` : '点击重命名；保存后生成流程 ID'}
            onClick={() => setEditingName(true)}
          >
            <span className={`truncate ${canvas.flowName ? '' : 'text-muted-foreground'}`}>
              {canvas.flowName || '未命名流程'}
            </span>
            {canvas.dirty && <span className="shrink-0 text-amber-500">●</span>}
          </button>
        )}
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon-sm"
          className="no-drag shrink-0"
          title="撤销（Ctrl+Z）"
          onClick={() => canvas.undo()}
        >
          <Undo2 />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="no-drag shrink-0"
          title="重做（Ctrl+Y）"
          onClick={() => canvas.redo()}
        >
          <Redo2 />
        </Button>
        <span className="bg-muted/60 mx-1 h-5 w-px shrink-0" />
        <Button
          variant="brand"
          size="icon-sm"
          className="no-drag shrink-0"
          title="保存"
          disabled={doc.busy || canvas.rfNodes.length === 0}
          onClick={() => void doc.handleSave()}
        >
          <Save />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="no-drag shrink-0"
          title="导入流程 JSON"
          disabled={doc.busy}
          onClick={() => fileInputRef.current?.click()}
        >
          <FileUp />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="no-drag shrink-0"
          title="导出流程 JSON"
          disabled={doc.busy || !doc.flowId}
          onClick={() => void doc.handleExport()}
        >
          <FileDown />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="no-drag shrink-0"
          title="删除流程"
          disabled={doc.busy || !doc.flowId}
          onClick={() => void doc.handleDelete()}
        >
          <Trash2 />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) {
              void doc.handleImport(file)
            }
            event.target.value = ''
          }}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          className="no-drag shrink-0"
          title={theme === 'dark' ? '切换到明色主题' : '切换到暗色主题'}
          onClick={() => setTheme((previous) => (previous === 'dark' ? 'light' : 'dark'))}
        >
          {theme === 'dark' ? <Sun /> : <Moon />}
        </Button>
        <span className="bg-muted/60 h-5 w-px shrink-0" />
        <Button
          variant="ghost"
          size="icon-sm"
          className="no-drag shrink-0"
          title="最小化"
          onClick={() => window.api.minimize()}
        >
          <Minus />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="no-drag shrink-0"
          title="最大化"
          onClick={() => window.api.maximize()}
        >
          <Square />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="no-drag shrink-0"
          title="关闭"
          onClick={() => window.close()}
        >
          <X />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="border-border flex w-60 shrink-0 flex-col border-r">
          <div className="border-border flex flex-col gap-1 border-b p-2">
            <p className="text-muted-foreground mb-1 text-xs font-semibold">步骤</p>
            {STEP_ORDER.map(
              (type: FlowStepType) => {
                const meta = STEP_META[type]
                const category = STEP_CATEGORY_META[meta.category]
                const PoolIcon = meta.icon
                return (
                  <button
                    key={type}
                    type="button"
                    title={meta.hint}
                    className="border-border hover:border-primary/50 hover:bg-primary/5 flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs transition-colors"
                    onClick={() => canvas.addNode(type)}
                  >
                    <span
                      className={`${category.chip} flex h-6 w-6 shrink-0 items-center justify-center rounded-md`}
                    >
                      <PoolIcon size={13} />
                    </span>
                    {meta.label}
                  </button>
                )
              }
            )}
          </div>
          <div className="border-border mt-auto flex items-center gap-1 border-t p-2">
            <Button
              variant="ghost"
              size="sm"
              title="按入口层级重新排列节点"
              onClick={canvas.autoLayout}
            >
              自动布局
            </Button>
          </div>
        </aside>

        <div className="relative min-h-0 min-w-0 flex-1">
          <StepEditorContext.Provider value={editorContext}>
            <ReactFlow<StepCanvasNode, StepCanvasEdge>
              nodes={displayNodes}
              edges={displayEdges}
              nodeTypes={nodeTypes}
              onInit={canvas.setFlowInstance}
              onNodesChange={canvas.handleNodesChange}
              onEdgesChange={canvas.handleEdgesChange}
              onConnect={canvas.handleConnect}
              onReconnect={canvas.handleReconnect}
              isValidConnection={canvas.isValidConnection}
              onSelectionChange={canvas.handleSelectionChange}
              onNodeClick={(_, node) => canvas.selectNode(node.id)}
              onEdgeClick={(_, edge) => canvas.selectEdge(edge.id)}
              onEdgeMouseEnter={(_, edge) => setHoveredEdgeId(edge.id)}
              onEdgeMouseLeave={() => setHoveredEdgeId(null)}
              onPaneClick={canvas.clearSelection}
              onNodeDragStart={() => canvas.capture(true)}
              onNodeDragStop={canvas.handleDragStop}
              onNodeContextMenu={(event, node) => {
                event.preventDefault()
                canvas.selectNode(node.id)
                setContextMenu({ x: event.clientX, y: event.clientY, nodeKey: node.id })
              }}
              colorMode={theme}
              className={connecting ? 'is-connecting' : undefined}
              onConnectStart={() => setConnecting(true)}
              onConnectEnd={() => setConnecting(false)}
              connectionMode={ConnectionMode.Loose}
              snapToGrid
              snapGrid={[8, 8]}
              multiSelectionKeyCode={['Meta', 'Control']}
              selectionKeyCode="Shift"
              deleteKeyCode={null}
              fitView
            >
              <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
              <CanvasControls />
              <MiniMap pannable zoomable />
            </ReactFlow>
          </StepEditorContext.Provider>
          <datalist id="agent-lab-variables">
            {variableNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <RunTray
            running={debug.running}
            ready={runReason === null}
            reason={runReason}
            error={debug.error}
            onLocateError={debug.failedNodeId ? locateFailedNode : undefined}
            onRun={debug.run}
            onStop={debug.stop}
          />
          {canvas.rfNodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="border-border bg-card/70 pointer-events-auto w-80 rounded-2xl border border-dashed p-6 text-center shadow-lg backdrop-blur">
                <p className="text-foreground text-sm font-semibold">开始编排一条回复流程</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  从左侧添加步骤并连线；保存后可在设置「流程」中切换启用
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {contextMenu && (
        <ContextMenuCard
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onDuplicate={canvas.duplicateNode}
          onSetEntry={canvas.setEntryNode}
          onDelete={canvas.removeNode}
        />
      )}
      {confirmDialog}
    </div>
  )
}
