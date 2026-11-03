import { ModelProvider, ProviderConnectionTestRequest, ProviderConnectionTestResult } from '@gamechat/type'
import { normalizeProvider } from '@gamechat/schema'
import { createHash } from 'crypto'
import { joinUrl, readResponseCapped } from '@gamechat/core'
import { request } from '@gamechat/core'
import { logger } from '../logging/index'

const PROFILE_TEST_TIMEOUT_MS = 10_000
const activeProfileTests = new Map<string, AbortController>()

/**
 * @description 校验供应商配置的 Base URL。
 * @param provider 待校验的供应商配置。
 * @returns 去除首尾空白后的 Base URL。
 */
function requireBaseUrl(provider: ModelProvider): string {
  if (!provider.baseUrl.trim()) {
    throw new Error('Base URL is required')
  }

  return provider.baseUrl.trim()
}

/**
 * @description 读取 JSON 响应，非 2xx 状态时抛出携带响应文本的错误。
 * @param response HTTP 响应。
 * @returns 解析后的 JSON 值；空响应体返回 null。
 * @remarks 正文经字节上限约束读取，避免异常端点灌大内存。
 */
async function readJson(response: Response): Promise<unknown> {
  const body = await readResponseCapped(response, { url: response.url })
  const text = new TextDecoder().decode(body)
  if (!response.ok) {
    throw new Error(text || `${response.status} ${response.statusText}`)
  }

  return text ? JSON.parse(text) : null
}

/**
 * @description 从 OpenAI 兼容响应中提取模型名称列表。
 * @param value 响应 JSON 值。
 * @returns 规范化的模型标识列表。
 */
function modelNamesFromData(value: unknown): string[] {
  if (!value || typeof value !== 'object') {
    return []
  }

  const raw = value as {
    data?: { id?: string }[]
    models?: { id?: string; name?: string; model?: string }[]
  }

  if (Array.isArray(raw.data)) {
    return raw.data.map((item) => item.id).filter((id): id is string => Boolean(id))
  }

  if (Array.isArray(raw.models)) {
    return raw.models
      .map((item) => item.id || item.name || item.model)
      .filter((id): id is string => Boolean(id))
  }

  return []
}

/**
 * @description 拉取供应商端点暴露的模型列表，按接入格式选择端点与鉴权头。
 * @param provider 提供接入格式、端点与凭据的供应商配置。
 * @param signal 测试停止或超时时用于取消底层 HTTP 请求的信号。
 * @returns 规范化后的远端模型标识列表。
 */
async function fetchModelList(provider: ModelProvider, signal: AbortSignal): Promise<string[]> {
  const baseUrl = requireBaseUrl(provider)

  if (provider.apiFormat === 'anthropic') {
    const body = await readJson(
      await request(joinUrl(baseUrl, '/v1/models'), {
        headers: {
          'x-api-key': provider.apiKey.trim(),
          'anthropic-version': '2023-06-01'
        },
        signal,
        allowErrorStatus: true
      })
    )
    return modelNamesFromData(body)
  }

  const body = await readJson(
    await request(joinUrl(baseUrl, '/models'), {
      headers: provider.apiKey.trim()
        ? {
            Authorization: `Bearer ${provider.apiKey.trim()}`
          }
        : undefined,
      signal,
      allowErrorStatus: true
    })
  )

  return modelNamesFromData(body)
}

/**
 * @description 生成不可逆的凭据指纹，用于校验缓存的模型目录是否仍与当前 API Key 匹配。
 * @param apiKey 供应商配置关联的 API Key。
 * @returns SHA-256 指纹，不会暴露 API Key 本身。
 */
function createApiKeyFingerprint(apiKey: string): string {
  return createHash('sha256').update(apiKey.trim()).digest('hex')
}

/**
 * @description 测试供应商端点的连通性，并返回与凭据绑定的模型目录。
 * @param request 渲染进程生成的测试标识与待测试的供应商配置。
 * @returns 连接测试结果，成功时附带刷新后的模型目录。
 */
export async function testProvider(
  request: ProviderConnectionTestRequest
): Promise<ProviderConnectionTestResult> {
  const { provider, requestId } = request
  const startedAt = Date.now()
  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, PROFILE_TEST_TIMEOUT_MS)
  activeProfileTests.set(requestId, controller)

  try {
    const normalized = normalizeProvider(provider, provider.id || 'provider-test')
    const models = await fetchModelList(normalized, controller.signal)
    const latencyMs = Date.now() - startedAt

    const result: ProviderConnectionTestResult = {
      ok: true,
      models,
      latencyMs,
      message: `连接成功，发现 ${models.length} 个模型。`,
      modelCatalog: {
        models,
        fetchedAt: new Date().toISOString(),
        apiFormat: normalized.apiFormat,
        baseUrl: normalized.baseUrl.trim(),
        apiKeyFingerprint: createApiKeyFingerprint(normalized.apiKey)
      }
    }

    return result
  } catch (error) {
    const result = {
      ok: false,
      latencyMs: Date.now() - startedAt,
      message: controller.signal.aborted
        ? timedOut
          ? `连接测试超时（${PROFILE_TEST_TIMEOUT_MS / 1000} 秒）。`
          : '连接测试已取消。'
        : error instanceof Error
          ? error.message
          : String(error)
    }

    void logger.error('settings', 'provider-test-failed', 'Provider connection test failed', {
      providerId: provider.id,
      apiFormat: provider.apiFormat,
      baseUrl: provider.baseUrl,
      latencyMs: result.latencyMs,
      error: result.message
    })

    return result
  } finally {
    clearTimeout(timeout)
    activeProfileTests.delete(requestId)
  }
}

/**
 * @description 取消一次进行中的供应商连接测试。
 * @param requestId 渲染进程生成的测试标识。
 * @returns 是否找到并中止了活动中的测试。
 */
export function cancelProviderTest(requestId: string): boolean {
  const controller = activeProfileTests.get(requestId)
  if (!controller) {
    return false
  }

  activeProfileTests.delete(requestId)
  controller.abort()
  return true
}

/**
 * @description 中止全部进行中的供应商连接测试，供应用退出链调用。
 * @remarks 中止只会让等待方收到取消结果，测试函数的 finally 分支仍会清空各自的控制器表。
 */
export function cancelAllConnectionTests(): void {
  const controllers = [...activeProfileTests.values()]
  activeProfileTests.clear()
  controllers.forEach((controller) => controller.abort())
}
