/**
 * @description 编排流程文档钩子：流程身份（标识/列表/忙碌态）与全部存取流转（打开、保存、导入、导出、删除）。
 * @remarks 画布草稿由 use-flow-canvas 持有，本钩子经其控制面读取草稿与装载流程包；
 *   每次装载带序号，过期响应直接丢弃，避免快速「编辑流程」请求互相覆盖画布。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { FLOW_STANDARD_ID, type FlowPackage } from '@gamechat/type'
import { getIpcErrorMessage } from '@renderer/common/lib/error-message'
import {
  deleteFlow,
  exportFlow,
  listFlows,
  loadFlow,
  onOpenFlow,
  saveFlow
} from './services'
import { toFlowPackage, validateFlow } from './flow-model'
import type { FlowCanvasController } from './use-flow-canvas'
import type { ConfirmOptions } from './confirm-dialog'

/** 编排流程文档控制面：流程身份状态与存取流转操作。 */
export type FlowDocumentController = {
  /** 已安装流程包摘要列表。 */
  flowList: Awaited<ReturnType<typeof listFlows>>
  /** 当前打开的流程标识；未保存草稿为空串。 */
  flowId: string
  /** 是否有存取操作在途。 */
  busy: boolean
  /**
   * @description 按标识打开一个已保存流程；画布有未保存修改时先征求确认。
   * @param id 流程标识。
   */
  openFlowById: (id: string) => Promise<void>
  /** @description 新建空白流程；画布有未保存修改时先征求确认。 */
  createBlankFlow: () => Promise<void>
  /** @description 保存当前画布为流程包：本地结构校验 → 归一化终审 → 落盘。 */
  handleSave: () => Promise<void>
  /**
   * @description 从本地 JSON 文件导入流程包：主进程归一化校验后落盘并装载到画布。
   * @param file 导入的 JSON 文件。
   */
  handleImport: (file: File) => Promise<void>
  /** @description 导出当前已保存的流程包。 */
  handleExport: () => Promise<void>
  /** @description 删除当前已保存的流程。 */
  handleDelete: () => Promise<void>
}

/**
 * @description 创建编排流程文档控制面。
 * @param options 钩子依赖。
 * @param options.canvas 画布草稿控制面；读取草稿与装载流程包。
 * @param options.debugResetRef 调试状态重置回调的引用；装载新流程后由文档层触发。
 * @param options.confirm 确认对话框；丢弃草稿类操作先征求确认。
 * @returns 流程文档控制面。
 * @remarks 装载序号在发起请求前递增，响应到达时序号已变化即视为过期丢弃；
 *   全部装载失败都会以 toast 提示，不再静默吞错。
 */
export function useFlowDocument(options: {
  canvas: FlowCanvasController
  debugResetRef: { readonly current: () => void }
  confirm: (dialogOptions: ConfirmOptions) => Promise<boolean>
}): FlowDocumentController {
  const { canvas, debugResetRef, confirm } = options
  const [flowList, setFlowList] = useState<Awaited<ReturnType<typeof listFlows>>>([])
  const [flowId, setFlowId] = useState('')
  const [busy, setBusy] = useState(false)
  /** 装载序号：每次发起装载递增，响应到达时比对，过期即丢弃。 */
  const loadSeqRef = useRef(0)
  /** 首次挂载标记：hash 初始化只执行一次。 */
  const initialLoadRef = useRef(false)

  /** 刷新已安装流程列表。 */
  const refreshFlowList = useCallback(async (): Promise<void> => {
    setFlowList(await listFlows())
  }, [])

  /** 把当前流程标识同步进窗口 hash：重载窗口后仍恢复同一流程；空串清除 hash。 */
  const syncHash = useCallback((flowId: string): void => {
    const current = decodeURIComponent(window.location.hash.replace(/^#/, ''))
    if (current === flowId) {
      return
    }
    const next = flowId ? `#${encodeURIComponent(flowId)}` : ''
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}${next}`)
  }, [])

  /** 装载流程包到画布并回写文档元状态；标准流程不绑定标识，保存副本时以生成标识命名。 */
  const applyLoaded = useCallback(
    (pkg: FlowPackage): void => {
      const isStandard = pkg.id === FLOW_STANDARD_ID
      canvas.applyLoadedFlow(pkg, pkg.name)
      setFlowId(isStandard ? '' : pkg.id)
      syncHash(isStandard ? '' : pkg.id)
      debugResetRef.current()
    },
    [canvas.applyLoadedFlow, debugResetRef, syncHash]
  )

  /** 发起一次装载：序号防竞态，过期响应丢弃；目标缺失时回退默认流程，standard 失败才报错。 */
  const loadLatest = useCallback(
    async (id: string): Promise<void> => {
      const seq = ++loadSeqRef.current
      try {
        let pkg: FlowPackage
        try {
          pkg = await loadFlow(id)
        } catch (cause) {
          if (id === FLOW_STANDARD_ID) {
            throw cause
          }
          pkg = await loadFlow(FLOW_STANDARD_ID)
          if (loadSeqRef.current !== seq) {
            return
          }
          toast.warning(`流程「${id}」不存在或已损坏，已打开默认流程。`)
        }
        if (loadSeqRef.current !== seq) {
          return
        }
        applyLoaded(pkg)
      } catch (cause) {
        if (loadSeqRef.current === seq) {
          toast.error(`打开流程失败：${getIpcErrorMessage(cause)}`)
        }
      }
    },
    [applyLoaded]
  )

  /** 按标识打开一个已保存流程。 */
  const openFlowById = useCallback(
    async (id: string): Promise<void> => {
      if (
        canvas.dirty &&
        !(await confirm({ message: '当前流程有未保存的修改，切换将丢弃。继续？' }))
      ) {
        return
      }
      await loadLatest(id)
    },
    [canvas.dirty, confirm, loadLatest]
  )

  /** 新建空白流程。 */
  const createBlankFlow = useCallback(async (): Promise<void> => {
    if (
      canvas.dirty &&
      !(await confirm({ message: '当前流程有未保存的修改，新建将丢弃。继续？' }))
    ) {
      return
    }
    setFlowId('')
    canvas.resetDraft()
    syncHash('')
  }, [canvas.dirty, canvas.resetDraft, confirm, syncHash])

  /** 保存当前画布为流程包。 */
  const handleSave = useCallback(async (): Promise<void> => {
    const validation = validateFlow(canvas.rfNodes, canvas.rfEdges, canvas.entry)
    if (!validation.ok) {
      toast.error(validation.message)
      return
    }
    const id = flowId || `flow-${Date.now().toString(36)}`
    const name =
      canvas.flowNameEdited && canvas.flowName.trim() ? canvas.flowName.trim() : id
    const pkg = toFlowPackage(
      { id, name },
      canvas.rfNodes,
      canvas.rfEdges,
      canvas.entry as string
    )
    setBusy(true)
    try {
      // 结构合法性由 validateFlow 把关，归一化由主进程保存边界统一执行。
      const saved = await saveFlow(JSON.stringify(pkg))
      setFlowId(saved.id)
      canvas.rename(saved.name)
      canvas.markSaved()
      await refreshFlowList()
      toast.success(`已保存流程：${saved.name}`)
    } catch (cause) {
      toast.error(`保存失败：${getIpcErrorMessage(cause)}`)
    } finally {
      setBusy(false)
    }
  }, [
    canvas.entry,
    canvas.flowName,
    canvas.flowNameEdited,
    canvas.markSaved,
    canvas.rename,
    canvas.rfEdges,
    canvas.rfNodes,
    flowId,
    refreshFlowList
  ])

  /** 从本地 JSON 文件导入流程包。 */
  const handleImport = useCallback(
    async (file: File): Promise<void> => {
      if (
        canvas.dirty &&
        !(await confirm({ message: '当前流程有未保存的修改，导入将丢弃。继续？' }))
      ) {
        return
      }
      setBusy(true)
      try {
        const raw = await file.text()
        const saved = await saveFlow(raw)
        applyLoaded(saved)
        await refreshFlowList()
        toast.success(`已导入流程：${saved.name}`)
      } catch (cause) {
        toast.error(`导入失败：${getIpcErrorMessage(cause)}`)
      } finally {
        setBusy(false)
      }
    },
    [applyLoaded, canvas.dirty, confirm, refreshFlowList]
  )

  /** 导出当前已保存的流程包。 */
  const handleExport = useCallback(async (): Promise<void> => {
    if (!flowId) {
      toast.error('请先保存流程再导出。')
      return
    }
    setBusy(true)
    try {
      const result = await exportFlow(flowId)
      if (!result.canceled && result.path) {
        toast.success(`已导出到 ${result.path}`)
      }
    } catch (cause) {
      toast.error(`导出失败：${getIpcErrorMessage(cause)}`)
    } finally {
      setBusy(false)
    }
  }, [flowId])

  /** 删除当前已保存的流程。 */
  const handleDelete = useCallback(async (): Promise<void> => {
    if (!flowId) {
      return
    }
    if (
      !(await confirm({
        message: `删除流程「${canvas.flowName || flowId}」？此操作不可撤销。`,
        confirmLabel: '删除',
        danger: true
      }))
    ) {
      return
    }
    setBusy(true)
    try {
      await deleteFlow(flowId)
      setFlowId('')
      canvas.resetDraft()
      syncHash('')
      await refreshFlowList()
    } catch (cause) {
      toast.error(`删除失败：${getIpcErrorMessage(cause)}`)
    } finally {
      setBusy(false)
    }
  }, [canvas.flowName, canvas.resetDraft, flowId, refreshFlowList, syncHash])

  // 首次挂载：解析 hash（可选流程标识），拉取列表并按需装载流程。
  useEffect(() => {
    if (initialLoadRef.current) {
      return
    }
    initialLoadRef.current = true
    const rawId = decodeURIComponent(window.location.hash.replace(/^#/, ''))
    void refreshFlowList().catch((cause) => toast.error(getIpcErrorMessage(cause)))
    void loadLatest(rawId || FLOW_STANDARD_ID)
  }, [loadLatest, refreshFlowList])

  // 主窗口请求切换编辑的流程（编排窗口已存在时）：有目标标识才装载。
  useEffect(() => {
    return onOpenFlow((request) => {
      if (!request.flowId) {
        return
      }
      void openFlowById(request.flowId)
    })
  }, [openFlowById])

  return {
    flowList,
    flowId,
    busy,
    openFlowById,
    createBlankFlow,
    handleSave,
    handleImport,
    handleExport,
    handleDelete
  }
}
