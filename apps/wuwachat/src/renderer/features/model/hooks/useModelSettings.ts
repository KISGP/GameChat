import { useState, type Dispatch, type SetStateAction } from 'react'
import { ModelProvider } from '@gamechat/type'
import { ProviderConnectionTestResult } from '@gamechat/type'
import { trackError, trackUiEvent } from '@renderer/app/telemetry'
import { connectionFingerprint, isValidUrl } from '@renderer/common/lib/cn'
import { useProvidersStore } from '@renderer/store/providers'
import { cancelProviderTest } from '@renderer/services/settings'
import { runProviderConnectionTest } from './useProviderConnectionTest'

type UseProviderSettingsArgs = {
  currentProvider?: ModelProvider
  updateProvider: (providerId: string, patch: Partial<ModelProvider>) => void
  updateProviderApiFormat: (providerId: string, apiFormat: ModelProvider['apiFormat']) => void
  removeProvider: (providerId: string) => void
}

type UseProviderSettingsResult = {
  showApiKey: boolean
  setShowApiKey: Dispatch<SetStateAction<boolean>>
  deleteTarget: ModelProvider | null
  setDeleteTarget: Dispatch<SetStateAction<ModelProvider | null>>
  testingProvider: string | null
  currentResult?: ProviderConnectionTestResult
  baseUrlInvalid: boolean
  canTest: boolean
  testResults: Record<string, ProviderConnectionTestResult>
  updateCurrentProvider: (patch: Partial<ModelProvider>) => void
  handleApiFormatSelect: (apiFormat: ModelProvider['apiFormat']) => void
  handleTestConnection: () => Promise<void>
  handleCancelTestConnection: () => Promise<void>
  handleConfirmDelete: () => void
}

/**
 * @description 管理供应商编辑状态、连接测试和模型目录持久化。
 * @param args 设置页所需的当前供应商及 Store 操作。
 * @returns 供应商设置页使用的状态和事件处理函数。
 */
export function useProviderSettings({
  currentProvider,
  updateProvider,
  updateProviderApiFormat,
  removeProvider
}: UseProviderSettingsArgs): UseProviderSettingsResult {
  const [showApiKey, setShowApiKey] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ModelProvider | null>(null)
  const [testingProvider, setTestingProvider] = useState<string | null>(null)
  const [testingRequestId, setTestingRequestId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, ProviderConnectionTestResult>>({})
  const currentResult = currentProvider ? testResults[currentProvider.id] : undefined
  const baseUrlInvalid = currentProvider ? !isValidUrl(currentProvider.baseUrl) : false
  const canTest =
    Boolean(currentProvider) && !baseUrlInvalid && testingProvider !== currentProvider?.id

  /**
   * @description 在连接凭据变化后清除指定供应商的临时测试结果。
   * @param providerId 测试结果已失效的供应商标识。
   * @returns 无返回值。
   */
  const clearProviderConnectionState = (providerId: string): void => {
    setTestResults((current) => {
      const next = { ...current }
      delete next[providerId]
      return next
    })
  }

  /**
   * @description 更新当前供应商，并在连接配置变化时使模型目录失效。
   * @param patch 要应用到当前供应商的可编辑字段。
   * @returns 无返回值。
   */
  const updateCurrentProvider = (patch: Partial<ModelProvider>): void => {
    if (!currentProvider) return

    if ('baseUrl' in patch || 'apiKey' in patch) {
      updateProvider(currentProvider.id, { ...patch, modelCatalog: undefined })
      clearProviderConnectionState(currentProvider.id)
      return
    }

    updateProvider(currentProvider.id, patch)
  }

  /**
   * @description 应用用户选择的接入格式并清除该供应商的连接测试结果。
   * @param apiFormat 新选择的接入格式。
   * @returns 无返回值。
   */
  const handleApiFormatSelect = (apiFormat: ModelProvider['apiFormat']): void => {
    if (!currentProvider) return

    trackUiEvent('model-api-format-select', 'User changed a provider API format', {
      providerId: currentProvider.id,
      apiFormat
    })
    updateProviderApiFormat(currentProvider.id, apiFormat)
    clearProviderConnectionState(currentProvider.id)
  }

  /**
   * @description 测试当前供应商的连接，并在配置未变化时保存测试结果与模型目录。
   * @returns 连接测试结束并写入结果后的 Promise。
   * @remarks 当当前供应商不可测试时会直接返回，不会调用主进程；测试执行经共享入口完成，
   *   请求异常已折算为失败结果，不再向调用方抛出。
   */
  const handleTestConnection = async (): Promise<void> => {
    if (!currentProvider || !canTest) return

    const requestId = crypto.randomUUID()

    trackUiEvent('model-connection-test', 'User started a provider connection test', {
      providerId: currentProvider.id,
      apiFormat: currentProvider.apiFormat,
      baseUrl: currentProvider.baseUrl
    })
    setTestingProvider(currentProvider.id)
    setTestingRequestId(requestId)
    try {
      const result = await runProviderConnectionTest(requestId, currentProvider)
      const latestProvider = useProvidersStore
        .getState()
        .store.providers.find((provider) => provider.id === currentProvider.id)
      if (
        latestProvider &&
        connectionFingerprint(latestProvider) === connectionFingerprint(currentProvider)
      ) {
        setTestResults((current) => ({
          ...current,
          [currentProvider.id]: result
        }))
        if (result.modelCatalog) {
          updateProvider(currentProvider.id, { modelCatalog: result.modelCatalog })
        }
      }
    } finally {
      setTestingProvider(null)
      setTestingRequestId(null)
    }
  }

  /**
   * @description 请求取消当前正在执行的供应商连接测试。
   * @returns 主进程收到取消请求后的完成信号。
   */
  const handleCancelTestConnection = async (): Promise<void> => {
    if (!testingRequestId) return

    try {
      await cancelProviderTest(testingRequestId)
    } catch (error) {
      trackError('cancel-provider-test-failed', 'Failed to cancel provider connection test', error)
    }
  }

  /**
   * @description 确认删除选中的供应商，并清除其临时连接状态。
   * @returns 无返回值。
   */
  const handleConfirmDelete = (): void => {
    if (!deleteTarget) return

    trackUiEvent('model-provider-delete-confirmed', 'User confirmed deleting a model provider', {
      providerId: deleteTarget.id
    })
    removeProvider(deleteTarget.id)
    clearProviderConnectionState(deleteTarget.id)
    setDeleteTarget(null)
  }

  return {
    showApiKey,
    setShowApiKey,
    deleteTarget,
    setDeleteTarget,
    testingProvider,
    currentResult,
    baseUrlInvalid,
    canTest,
    testResults,
    updateCurrentProvider,
    handleApiFormatSelect,
    handleTestConnection,
    handleCancelTestConnection,
    handleConfirmDelete
  }
}
