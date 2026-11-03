/**
 * @description 编排窗口引用数据钩子：角色注册表、模型清单与调试工具目录的加载与刷新。
 * @remarks 工具目录随模拟角色数量刷新（多于一个按群聊回合解析），并在窗口重新聚焦时刷新——
 *   记忆开关等设置可能在主窗口里改过。
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { CharacterSummary, FlowToolCatalogEntry } from '@gamechat/type'
import { getIpcErrorMessage } from '@renderer/common/lib/error-message'
import { getCharacterRegistry, getProviders, getToolCatalog } from './services'

/** 模型条目的展示视图：存储值仍是条目标识，展示名与供应商名供下拉呈现。 */
export type FlowModelOption = {
  /** 模型条目标识：存入节点配置与调试请求的值。 */
  id: string
  /** 展示名：模型条目的 model 字段，缺失时回退条目标识。 */
  label: string
  /** 所属供应商显示名，供下拉按供应商分组。 */
  providerName: string
}

/** 编排窗口引用数据。 */
export type FlowReferenceData = {
  /** 本地角色摘要清单（外部输入节点的填充候选）。 */
  characters: CharacterSummary[]
  /** 供应商模型条目展示视图：真实模型名 + 所属供应商。 */
  models: FlowModelOption[]
  /** 调试运行可绑定的工具。 */
  availableTools: FlowToolCatalogEntry[]
  /** @description 重新拉取工具目录。 */
  refreshToolCatalog: () => void
}

/**
 * @description 加载编排窗口所需的引用数据。
 * @param characterCount 外部输入节点当前的模拟角色数量：工具目录按其解析群聊回合。
 * @returns 引用数据与其刷新入口。
 * @remarks 加载失败以 toast 提示并保留空清单；引用数据不影响编辑，只影响节点内选项与调试。
 */
export function useReferenceData(characterCount: number): FlowReferenceData {
  const [characters, setCharacters] = useState<CharacterSummary[]>([])
  const [models, setModels] = useState<FlowModelOption[]>([])
  const [availableTools, setAvailableTools] = useState<FlowToolCatalogEntry[]>([])

  // 角色注册表挂载时拉取一次：外部输入节点的填充候选。
  useEffect(() => {
    void getCharacterRegistry()
      .then((registry) => {
        const list = registry.local.map((entry) => ({
          id: entry.id,
          name: entry.name,
          avatar: entry.avatar,
          pixActivity: entry.pixActivity,
          rolePile: entry.rolePile
        }))
        setCharacters(list)
      })
      .catch((cause: unknown) => toast.error(`角色列表加载失败：${getIpcErrorMessage(cause)}`))
  }, [])

  // 模型清单：外部输入节点与调试运行共用；展示名取模型条目的 model 字段。
  useEffect(() => {
    void getProviders()
      .then((store) => {
        setModels(
          store.providers.flatMap((provider) =>
            provider.models.map((model) => ({
              id: model.id,
              label: model.model || model.id,
              providerName: provider.name
            }))
          )
        )
      })
      .catch((cause: unknown) => toast.error(`模型列表加载失败：${getIpcErrorMessage(cause)}`))
  }, [])

  /** 刷新「执行工具」节点展示的可用工具清单。 */
  const refreshToolCatalog = useCallback((): void => {
    void getToolCatalog(characterCount)
      .then(setAvailableTools)
      .catch((cause: unknown) => toast.error(`工具清单加载失败：${getIpcErrorMessage(cause)}`))
  }, [characterCount])

  useEffect(() => {
    refreshToolCatalog()
  }, [refreshToolCatalog])

  // 窗口重新聚焦时刷新：记忆开关等设置可能在主窗口里改过。
  useEffect(() => {
    window.addEventListener('focus', refreshToolCatalog)
    return () => window.removeEventListener('focus', refreshToolCatalog)
  }, [refreshToolCatalog])

  return { characters, models, availableTools, refreshToolCatalog }
}
