import { ApiFormat, GenerationParams, ModelProvider, ProviderModel, ProviderStore } from '@gamechat/type'
import { createProvider, normalizeProviderStore } from '@gamechat/schema'
import { trackError, trackUiEvent } from '@renderer/app/telemetry'
import { saveProviders as persistProviders } from '@renderer/services/settings'
import { create } from 'zustand'

type ProvidersStoreState = {
  store: ProviderStore
  isLoaded: boolean
  saveStatus: 'idle' | 'saving' | 'saved' | 'error'
  saveError: string | null
  hydrateProviders: (store: ProviderStore) => void
  updateProvider: (providerId: string, patch: Partial<ModelProvider>) => void
  updateProviderApiFormat: (providerId: string, apiFormat: ApiFormat) => void
  addProvider: () => string
  removeProvider: (providerId: string) => void
  addProviderModel: (providerId: string, model: ProviderModel) => void
  removeProviderModel: (providerId: string, modelId: string) => void
  updateProviderModel: (
    providerId: string,
    modelId: string,
    patch: Partial<Omit<ProviderModel, 'id'>>
  ) => void
  updateProviderDefaultParams: (providerId: string, patch: Partial<GenerationParams>) => void
  retrySave: () => Promise<void>
}

/** 空供应商集合：零配置是合法终态，加载失败或删除全部供应商后都回落到这里。 */
const EMPTY_STORE: ProviderStore = { providers: [] }
let saveTimer: number | null = null
let pendingProvidersStore: ProviderStore | null = null
let saveRevision = 0

/**
 * @description 将供应商配置提交给主进程统一设置服务，并记录失败状态。
 * @param store 待保存的供应商配置。
 * @param set Zustand 的状态更新函数。
 * @param revision 当前保存请求的版本号。
 * @returns 供应商配置保存尝试结束后的 Promise。
 * @remarks 写入失败时会记录错误并更新 Store，不会向调用方重新抛出异常。
 */
async function saveProviders(
  store: ProviderStore,
  set: (partial: Partial<ProvidersStoreState>) => void,
  revision: number
): Promise<void> {
  if (pendingProvidersStore === store) {
    pendingProvidersStore = null
  }
  try {
    await persistProviders(store)
    if (revision === saveRevision) {
      set({ saveError: null, saveStatus: 'saved' })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    trackError('save-providers-failed', 'Failed to save model providers', error)
    if (revision === saveRevision) {
      set({ saveError: message, saveStatus: 'error' })
    }
  }
}

/**
 * @description 对连续供应商配置变更进行防抖后保存，减少文本输入时的磁盘写入次数。
 * @param store 待保存的供应商配置快照。
 * @param set Zustand 的状态更新函数。
 */
function scheduleProvidersSave(
  store: ProviderStore,
  set: (partial: Partial<ProvidersStoreState>) => void
): void {
  pendingProvidersStore = store
  const revision = ++saveRevision
  set({ saveError: null, saveStatus: 'saving' })
  if (saveTimer != null) {
    window.clearTimeout(saveTimer)
  }

  saveTimer = window.setTimeout(() => {
    saveTimer = null
    trackUiEvent('model-settings-save', 'Saving model provider settings', {
      providerCount: store.providers.length
    })
    void saveProviders(store, set, revision)
  }, 300)
}

/**
 * @description 规范化供应商配置、更新本地 Store，并安排防抖持久化。
 * @param set Zustand 的状态更新函数。
 * @param store 待提交的供应商配置。
 */
function commitProvidersStore(
  set: (partial: Partial<ProvidersStoreState>) => void,
  store: ProviderStore
): void {
  const normalized = normalizeProviderStore(store)
  set({ store: normalized })
  scheduleProvidersSave(normalized, set)
}

/**
 * @description 在供应商集合中定位指定模型条目及其所属供应商。
 * @param store 供应商配置集合。
 * @param modelId 模型条目标识。
 * @returns 条目与其所属供应商；不存在时返回 null。
 * @remarks 模型条目 ID 全局唯一，聊天发送与重试据此把选择解析为可用模型。
 */
export function findProviderModel(
  store: ProviderStore,
  modelId: string | null
): { provider: ModelProvider; model: ProviderModel } | null {
  if (!modelId) {
    return null
  }
  for (const provider of store.providers) {
    const model = provider.models.find((item) => item.id === modelId)
    if (model) {
      return { provider, model }
    }
  }
  return null
}

export const useProvidersStore = create<ProvidersStoreState>((set, get) => ({
  store: EMPTY_STORE,
  isLoaded: false,
  saveStatus: 'idle',
  saveError: null,
  /**
   * @description 使用主进程返回的供应商配置初始化 Store。
   * @param store 主进程返回的供应商配置快照。
   * @returns 无返回值。
   */
  hydrateProviders: (store) =>
    set({
      store: normalizeProviderStore(store),
      isLoaded: true,
      saveStatus: 'idle',
      saveError: null
    }),
  /**
   * @description 更新指定供应商的字段。
   * @param providerId 要修改的供应商标识。
   * @param patch 要合并的可编辑字段。
   * @returns 无返回值。
   * @remarks 连接信息（Base URL、API Key）变化时使该供应商的模型目录失效。
   */
  updateProvider: (providerId, patch) => {
    commitProvidersStore(set, {
      ...get().store,
      providers: get().store.providers.map((provider) => {
        if (provider.id !== providerId) {
          return provider
        }
        if ('baseUrl' in patch || 'apiKey' in patch) {
          const next = { ...provider, ...patch }
          delete next.modelCatalog
          return next
        }
        return { ...provider, ...patch }
      })
    })
  },
  /**
   * @description 切换供应商的接入格式并使其模型目录失效。
   * @param providerId 要修改的供应商标识。
   * @param apiFormat 新选择的接入格式。
   * @returns 无返回值。
   * @remarks 已填写的连接信息与模型条目全部保留；目录因格式不再匹配而失效。
   */
  updateProviderApiFormat: (providerId, apiFormat) => {
    commitProvidersStore(set, {
      ...get().store,
      providers: get().store.providers.map((provider) => {
        if (provider.id !== providerId) {
          return provider
        }
        const next = { ...provider, apiFormat }
        delete next.modelCatalog
        return next
      })
    })
  },
  /**
   * @description 创建一个空白供应商。
   * @returns 新建供应商的标识。
   */
  addProvider: () => {
    const id = `provider-${Date.now()}`
    trackUiEvent('model-provider-added', 'User created a model provider', { providerId: id })

    commitProvidersStore(set, {
      ...get().store,
      providers: [...get().store.providers, createProvider(id)]
    })

    return id
  },
  /**
   * @description 删除指定供应商。
   * @param providerId 要删除的供应商标识。
   * @returns 无返回值。
   * @remarks 删除后允许集合为空；聊天侧的模型选择失效时由聊天入口自行禁用发送。
   */
  removeProvider: (providerId) => {
    trackUiEvent('model-provider-removed', 'User removed a model provider', { providerId })

    commitProvidersStore(set, {
      ...get().store,
      providers: get().store.providers.filter((provider) => provider.id !== providerId)
    })
  },
  /**
   * @description 在指定供应商下加入一个已编辑完成的模型条目。
   * @param providerId 目标供应商标识。
   * @param model 待加入的模型条目。
   * @returns 无返回值。
   * @remarks 条目由模型编辑弹窗在保存时构造，取消编辑不会产生空条目。
   */
  addProviderModel: (providerId, model) => {
    commitProvidersStore(set, {
      ...get().store,
      providers: get().store.providers.map((provider) =>
        provider.id === providerId ? { ...provider, models: [...provider.models, model] } : provider
      )
    })
  },
  /**
   * @description 删除指定供应商下的一个模型条目。
   * @param providerId 目标供应商标识。
   * @param modelId 要删除的模型条目标识。
   * @returns 无返回值。
   */
  removeProviderModel: (providerId, modelId) => {
    commitProvidersStore(set, {
      ...get().store,
      providers: get().store.providers.map((provider) =>
        provider.id === providerId
          ? { ...provider, models: provider.models.filter((item) => item.id !== modelId) }
          : provider
      )
    })
  },
  /**
   * @description 更新指定模型条目的模型名、图片能力、窗口容量或参数覆盖。
   * @param providerId 目标供应商标识。
   * @param modelId 要修改的模型条目标识。
   * @param patch 要合并的模型条目字段。
   * @returns 无返回值。
   */
  updateProviderModel: (providerId, modelId, patch) => {
    commitProvidersStore(set, {
      ...get().store,
      providers: get().store.providers.map((provider) =>
        provider.id === providerId
          ? {
              ...provider,
              models: provider.models.map((item) =>
                item.id === modelId ? { ...item, ...patch } : item
              )
            }
          : provider
      )
    })
  },
  /**
   * @description 更新指定供应商的默认生成参数。
   * @param providerId 目标供应商标识。
   * @param patch 要合并的默认参数。
   * @returns 无返回值。
   */
  updateProviderDefaultParams: (providerId, patch) => {
    commitProvidersStore(set, {
      ...get().store,
      providers: get().store.providers.map((provider) =>
        provider.id === providerId
          ? { ...provider, defaultParams: { ...provider.defaultParams, ...patch } }
          : provider
      )
    })
  },
  /**
   * @description 重试保存当前供应商配置。
   * @returns 当前供应商配置保存流程完成后的 Promise。
   */
  retrySave: async () => {
    if (saveTimer != null) {
      window.clearTimeout(saveTimer)
      saveTimer = null
    }
    const revision = ++saveRevision
    set({ saveError: null, saveStatus: 'saving' })
    await saveProviders(pendingProvidersStore || get().store, set, revision)
  }
}))
