import { ChatAnthropic } from '@langchain/anthropic'
import { ChatOpenAI } from '@langchain/openai'
import type { ClientOptions } from 'openai'
import type { ResolvedModelConfig } from '@gamechat/type'
import type { AgentModelFactoryOptions } from '../../tools'
import { getChatHost } from '../host'
import { requireValue } from '../../infra/value'
import { appFetch } from '../../infra/http'

/** 模型实例缓存的条目上限；超出后整体清空（配置数量有限，全量清空足够）。 */
const MAX_CACHED_MODELS = 16

/** 模型实例缓存条目：记录创建时的回调身份，trace 重载后据此失效。 */
type CachedModel = {
  callbackIdentity: object | null
  model: ChatOpenAI | ChatAnthropic
}

/** 按 resolved 配置语义字段键控的模型实例缓存，跨回合复用同一配置的客户端。 */
const modelCache = new Map<string, CachedModel>()

/**
 * @description 构造模型实例缓存键。
 * @param config 已解析的运行时模型配置。
 * @returns 由接入格式、接入点、模型名与生效参数拼接的键。
 * @remarks 接入格式必须参与键构造：同一接入点同时暴露多种线协议时，缺失该维度会撞键复用错误客户端。
 *   Anthropic 格式不向 API 传温度，温度值也不得参与键构造，否则缓存键语义与客户端行为不一致。
 */
function buildModelCacheKey(config: ResolvedModelConfig): string {
  return [
    config.apiFormat,
    config.baseUrl,
    config.model,
    config.apiKey,
    config.apiFormat === 'anthropic' ? '' : config.temperature,
    config.reasoningEffort
  ].join('\u0000')
}

/**
 * @description 创建覆写出站请求 User-Agent 为宿主应用标识的 fetch 函数。
 * @returns 可注入 OpenAI 与 Anthropic 模型客户端的 fetch 包装函数。
 * @remarks 仅在传输层重写 User-Agent 请求头，其余请求头与响应原样透传；底层走应用统一传输
 *   （appFetch，随宿主代理开关实时分流），缓存客户端捕获的是本包装的稳定引用，
 *   切换网络栈无需失效重建。返回类型跟随 openai 客户端的 ClientOptions['fetch']，
 *   两个 SDK 的 Fetch 签名结构一致，任一方升级变更签名时由类型检查暴露。
 */
function createAppUserAgentFetch(): ClientOptions['fetch'] {
  const userAgent = getChatHost().modelUserAgent()
  return (input, init) => {
    const headers = new Headers(init?.headers)
    headers.set('User-Agent', userAgent)
    // SDK 的 fetch 入参允许 string | URL | Request，统一解析为 URL 字符串交给应用传输。
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    return appFetch(url, { ...init, headers })
  }
}

/**
 * @description 按运行时模型配置创建或复用聊天模型实例，并应用接入格式支持的生成参数。
 * @param config 已解析的运行时模型配置。
 * @param options 可选的 LangChain 回调，供 Langfuse 追踪层注入。
 * @returns 按接入格式构造的 LangChain 模型实例。
 * @remarks 相同配置与回调身份的调用共享同一实例；trace 重载换用新回调后缓存自动失效重建。
 *   接入点地址来自用户填写的统一 baseUrl 字段，由工厂分支装配进各客户端的构造参数。
 *   两种接入格式的出站请求统一携带宿主应用标识 User-Agent。
 */
export function createChatModel(
  config: ResolvedModelConfig,
  options?: AgentModelFactoryOptions
): ChatOpenAI | ChatAnthropic {
  const cacheKey = buildModelCacheKey(config)
  const callbackIdentity = options?.callbacks?.[0] ?? null
  const cached = modelCache.get(cacheKey)
  if (cached && cached.callbackIdentity === callbackIdentity) {
    return cached.model
  }

  const callbacks = options?.callbacks

  let model: ChatOpenAI | ChatAnthropic
  if (config.apiFormat === 'anthropic') {
    // Anthropic Messages 接口对非默认 temperature 直接报错，此处不向构造参数传入温度；
    // max_tokens 为该接口必填字段，模型条目未配置最大输出时由客户端按模型默认值兜底。
    model = new ChatAnthropic({
      model: requireValue(config.model, 'Model'),
      apiKey: config.apiKey.trim() || undefined,
      anthropicApiUrl: requireValue(config.baseUrl, 'Base URL'),
      clientOptions: { fetch: createAppUserAgentFetch() },
      ...(config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
      callbacks
    })
  } else {
    model = new ChatOpenAI({
      model: requireValue(config.model, 'Model'),
      apiKey: config.apiKey.trim() || undefined,
      // 温度覆盖为 null 表示显式不发送（OpenAI 推理模型等拒绝自定义温度）；
      // 数值缺省时 ChatOpenAI 同样不会把该字段带进请求体。
      ...(config.temperature === null ? {} : { temperature: config.temperature }),
      callbacks,
      configuration: {
        baseURL: requireValue(config.baseUrl, 'Base URL'),
        fetch: createAppUserAgentFetch()
      },
      ...(config.reasoningEffort === 'auto'
        ? {}
        : { reasoning: { effort: config.reasoningEffort } })
    })
  }

  if (modelCache.size >= MAX_CACHED_MODELS) {
    modelCache.clear()
  }
  modelCache.set(cacheKey, { callbackIdentity, model })
  return model
}
