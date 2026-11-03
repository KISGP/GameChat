import { FLOW_STANDARD_ID, type FlowPackageSummary } from '@gamechat/type'
import { create } from 'zustand'
import { toast } from 'sonner'
import { trackUiEvent } from '@renderer/app/telemetry'
import { getIpcErrorMessage } from '@renderer/common/lib/error-message'
import { listFlows } from '@renderer/services/flows'
import { getUnifiedSettings, saveFlowsSettings } from '@renderer/services/settings'

/** 流程设置 store：通用流程的列表与当前选择。 */
type FlowsStore = {
  /** 已安装流程摘要（含内置 standard，列表首位）。 */
  flows: FlowPackageSummary[]
  /** 当前生效流程标识。 */
  currentFlowId: string
  /** 首次列表与设置装载是否完成。 */
  loaded: boolean
  loadFlows: () => Promise<void>
  setCurrentFlow: (flowId: string) => Promise<void>
}

/** 流程设置 store 实例。 */
export const useFlowsStore = create<FlowsStore>((set, get) => ({
  flows: [],
  currentFlowId: FLOW_STANDARD_ID,
  loaded: false,
  /**
   * @description 装载流程列表与当前流程设置。
   * @returns 装载完成后的 Promise。
   * @remarks 设置页流程 Tab 每次挂载时调用；失败时保留未装载态并提示。
   */
  loadFlows: async (): Promise<void> => {
    try {
      const [flows, unified] = await Promise.all([listFlows(), getUnifiedSettings()])
      set({
        flows,
        currentFlowId: unified.flows.currentFlowId,
        loaded: true
      })
    } catch (cause) {
      toast.error(`流程列表加载失败：${getIpcErrorMessage(cause)}`)
      set({ loaded: true })
    }
  },
  /**
   * @description 切换当前流程并持久化。
   * @param flowId 目标流程标识；`standard` 表示内置标准流程。
   * @returns 保存完成后的 Promise。
   * @remarks 乐观更新后按主进程返回的规范化结果收敛；变更在下一次回复生效。
   */
  setCurrentFlow: async (flowId): Promise<void> => {
    const previous = get().currentFlowId
    set({ currentFlowId: flowId })
    try {
      const saved = await saveFlowsSettings({ currentFlowId: flowId })
      set({ currentFlowId: saved.currentFlowId })
      trackUiEvent('current-flow-changed', 'User changed the current flow', {
        flowId
      })
    } catch (cause) {
      set({ currentFlowId: previous })
      toast.error(`保存失败：${getIpcErrorMessage(cause)}`)
    }
  }
}))
