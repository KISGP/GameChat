import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

type ModelSelectionState = {
  /** 上次选择的模型条目标识；尚未选择或所选模型已被删除时为 null。 */
  selectedModelId: string | null
  selectModel: (modelId: string | null) => void
}

/**
 * @description 管理聊天输入框的模型选择记忆。
 * @remarks 供应商配置本身不持有「当前模型」概念；这里只保存上次使用过的模型条目 ID，
 *   经 localStorage 持久化跨启动记忆。所选条目被删除后由消费方解析为 null 回到未选态。
 */
export const useModelSelectionStore = create<ModelSelectionState>()(
  persist(
    (set) => ({
      selectedModelId: null,
      /**
       * @description 记录聊天输入框当前选择的模型条目。
       * @param modelId 模型条目标识；清除选择时传 null。
       * @returns 无返回值。
       */
      selectModel: (modelId) => set({ selectedModelId: modelId })
    }),
    {
      name: 'wuwachat-model-selection',
      storage: createJSONStorage(() => localStorage)
    }
  )
)
