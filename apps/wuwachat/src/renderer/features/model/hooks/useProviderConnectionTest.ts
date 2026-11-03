import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiFormat, ModelCatalog, ModelProvider, ProviderConnectionTestResult } from '@gamechat/type'
import { createProvider } from '@gamechat/schema'
import { trackError } from '@renderer/app/telemetry'
import { connectionFingerprint, isValidUrl } from '@renderer/common/lib/cn'
import { cancelProviderTest, testProviderConnection } from '@renderer/services/settings'

/** @description 供应商连接草稿：接入格式与连接凭据三元组。 */
export type ProviderConnectionDraft = {
  apiFormat: ApiFormat
  baseUrl: string
  apiKey: string
}

/**
 * @description 由连接草稿构造用于连接测试的临时供应商对象。
 * @param requestId 本次测试的请求标识，用于派生临时供应商标识。
 * @param draft 连接草稿。
 * @returns 不写入供应商 Store 的临时供应商配置。
 */
export function buildConnectionTestProvider(
  requestId: string,
  draft: ProviderConnectionDraft
): ModelProvider {
  return {
    ...createProvider(`provider-draft-${requestId}`, draft.apiFormat),
    baseUrl: draft.baseUrl.trim(),
    apiKey: draft.apiKey.trim()
  }
}

/**
 * @description 执行一次供应商连接测试，请求异常折算为失败结果就地返回。
 * @param requestId 本次测试的请求标识。
 * @param provider 用于测试的供应商配置（持久化供应商或临时草稿）。
 * @returns 主进程返回的测试结果；请求异常时返回携带错误消息的失败结果。
 * @remarks 向导与设置页共用的测试执行入口；取消由调用方按请求标识另行调用 cancelProviderTest。
 */
export async function runProviderConnectionTest(
  requestId: string,
  provider: ModelProvider
): Promise<ProviderConnectionTestResult> {
  try {
    return await testProviderConnection(requestId, provider)
  } catch (error) {
    trackError('provider-connection-test-failed', 'Provider connection test request failed', error)
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * @description 管理未持久化连接草稿的编辑、失效与测试生命周期。
 * @param initial 初始连接草稿。
 * @returns 草稿状态、连接测试状态与操作函数。
 * @remarks 任一连接字段变更都会丢弃既有测试结果与模型目录；测试结果只在草稿凭据与
 *   发起测试时一致时才应用，避免测试期间的编辑被迟到结果污染。
 */
export function useProviderConnectionTest(initial: ProviderConnectionDraft): {
  apiFormat: ApiFormat
  baseUrl: string
  apiKey: string
  testing: boolean
  testResult: ProviderConnectionTestResult | null
  catalogModels: string[]
  modelCatalog: ModelCatalog | undefined
  canTest: boolean
  setDraft: (patch: Partial<ProviderConnectionDraft>) => void
  testConnection: () => Promise<ProviderConnectionTestResult | null>
  cancelTest: () => Promise<void>
} {
  const [draft, setDraftState] = useState<ProviderConnectionDraft>(initial)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<ProviderConnectionTestResult | null>(null)
  const [catalogModels, setCatalogModels] = useState<string[]>([])
  const [modelCatalog, setModelCatalog] = useState<ModelCatalog | undefined>(undefined)
  const [requestId, setRequestId] = useState<string | null>(null)
  // 测试是长耗时异步动作，经 ref 读取最新草稿以判断结果是否仍然适用。
  const draftRef = useRef(draft)
  useEffect(() => {
    draftRef.current = draft
  })

  const canTest = isValidUrl(draft.baseUrl) && !testing

  /**
   * @description 更新连接草稿；任一连接字段变化时丢弃既有测试结果与模型目录。
   * @param patch 要应用的草稿字段片段。
   * @returns 无返回值。
   */
  const setDraft = useCallback((patch: Partial<ProviderConnectionDraft>): void => {
    if ('apiFormat' in patch || 'baseUrl' in patch || 'apiKey' in patch) {
      setTestResult(null)
      setCatalogModels([])
      setModelCatalog(undefined)
    }
    setDraftState((current) => ({ ...current, ...patch }))
  }, [])

  /**
   * @description 以当前草稿执行一次连接测试，成功时记录返回的模型目录。
   * @returns 测试结果；未发起测试或结果因凭据变化被丢弃时返回 null。
   * @remarks 测试期间草稿凭据发生变化时丢弃结果，要求以新凭据重新测试；调用方可按
   *   返回值驱动后续动作（如预选模型）。
   */
  const testConnection = useCallback(async (): Promise<ProviderConnectionTestResult | null> => {
    if (!isValidUrl(draftRef.current.baseUrl) || testing) {
      return null
    }
    const id = crypto.randomUUID()
    const captured = buildConnectionTestProvider(id, draftRef.current)
    const capturedFingerprint = connectionFingerprint(captured)
    setTesting(true)
    setRequestId(id)
    const result = await runProviderConnectionTest(id, captured)
    if (
      connectionFingerprint(buildConnectionTestProvider(id, draftRef.current)) !==
      capturedFingerprint
    ) {
      setTesting(false)
      setRequestId(null)
      return null
    }
    setTestResult(result)
    if (result.ok) {
      setCatalogModels(result.models ?? [])
      setModelCatalog(result.modelCatalog)
    }
    setTesting(false)
    setRequestId(null)
    return result
  }, [testing])

  /**
   * @description 请求取消正在执行的连接测试。
   * @returns 主进程收到取消请求后的完成信号。
   */
  const cancelTest = useCallback(async (): Promise<void> => {
    if (!requestId) {
      return
    }
    try {
      await cancelProviderTest(requestId)
    } catch (error) {
      trackError(
        'provider-connection-test-cancel-failed',
        'Failed to cancel provider connection test',
        error
      )
    }
  }, [requestId])

  return {
    apiFormat: draft.apiFormat,
    baseUrl: draft.baseUrl,
    apiKey: draft.apiKey,
    testing,
    testResult,
    catalogModels,
    modelCatalog,
    canTest,
    setDraft,
    testConnection,
    cancelTest
  }
}
