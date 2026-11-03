import type { ModelProvider, ProviderModel, ProviderStore, ResolvedModelConfig } from '@gamechat/type'

/**
 * @description 按模型条目标识在供应商集合中定位条目及其所属供应商。
 * @param store 供应商配置集合。
 * @param modelId 聊天请求引用的模型条目标识。
 * @returns 条目与其所属供应商；不存在时返回 null。
 * @remarks 模型条目 ID 经 normalize 全局去重，这里首次命中即唯一结果。
 */
export function findProviderModel(
  store: ProviderStore,
  modelId: string
): { provider: ModelProvider; model: ProviderModel } | null {
  for (const provider of store.providers) {
    const model = provider.models.find((item) => item.id === modelId)
    if (model) {
      return { provider, model }
    }
  }
  return null
}

/**
 * @description 将供应商连接信息与模型条目合并为可直接创建模型实例的运行时配置。
 * @param provider 模型条目所属的供应商配置。
 * @param model 供应商内的模型条目。
 * @returns 已合并参数覆盖的生效模型配置。
 * @remarks 模型级参数覆盖优先于供应商默认参数；temperature 覆盖为 null 时生效值即为 null（不向 API 发送）；
 *   Anthropic 格式不启用思考等级，无论默认值或覆盖值如何，生效值固定为 auto。
 */
export function resolveModelConfig(
  provider: ModelProvider,
  model: ProviderModel
): ResolvedModelConfig {
  const overrides = model.paramOverrides || {}
  return {
    providerId: provider.id,
    modelId: model.id,
    apiFormat: provider.apiFormat,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: model.model,
    supportsImages: model.supportsImages,
    temperature:
      overrides.temperature === null
        ? null
        : (overrides.temperature ?? provider.defaultParams.temperature),
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    reasoningEffort:
      provider.apiFormat === 'anthropic'
        ? 'auto'
        : (overrides.reasoningEffort ?? provider.defaultParams.reasoningEffort)
  }
}
