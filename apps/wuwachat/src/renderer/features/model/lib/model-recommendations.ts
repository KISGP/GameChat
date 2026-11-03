/**
 * @description 模型上下文窗口推荐：按模型 ID 关键词匹配预设上下文窗口的纯函数。
 * @remarks 规则按数组顺序生效，首条命中即返回；更具体的模式必须排在更宽泛的模式之前
 *   （如 glm-5 先于 glm），否则长模式永不可达。
 */

/** 单条上下文窗口推荐规则：模型 ID 关键词与对应窗口大小。 */
type ContextWindowRecommendation = {
  /** 匹配模型 ID 的关键词（大小写不敏感的包含匹配）。 */
  pattern: string
  /** 命中时推荐的上下文窗口 token 数。 */
  tokens: number
}

/** 上下文窗口推荐规则表，顺序即匹配优先级。 */
const CONTEXT_WINDOW_RECOMMENDATIONS: readonly ContextWindowRecommendation[] = [
  { pattern: 'gpt-5', tokens: 400000 },
  { pattern: 'gpt-4.1', tokens: 1000000 },
  { pattern: 'gpt-4-turbo', tokens: 128000 },
  { pattern: 'gpt-4o', tokens: 128000 },
  { pattern: 'gpt-4', tokens: 128000 },
  { pattern: 'o4', tokens: 200000 },
  { pattern: 'o3', tokens: 200000 },
  { pattern: 'o1', tokens: 200000 },
  { pattern: 'claude-5', tokens: 1000000 },
  { pattern: 'claude-opus-4', tokens: 200000 },
  { pattern: 'claude', tokens: 200000 },
  { pattern: 'gemini', tokens: 1000000 },
  { pattern: 'grok', tokens: 262144 },
  { pattern: 'deepseek-v4', tokens: 1000000 },
  { pattern: 'deepseek', tokens: 128000 },
  { pattern: 'qwen3', tokens: 262144 },
  { pattern: 'qwen', tokens: 131072 },
  { pattern: 'glm-5', tokens: 1000000 },
  { pattern: 'glm-4.6', tokens: 200000 },
  { pattern: 'glm-4.5', tokens: 200000 },
  { pattern: 'glm', tokens: 131072 },
  { pattern: 'kimi', tokens: 262144 },
  { pattern: 'moonshot', tokens: 262144 },
  { pattern: 'doubao', tokens: 262144 },
  { pattern: 'minimax', tokens: 1000000 },
  { pattern: 'llama', tokens: 131072 },
  { pattern: 'mistral', tokens: 131072 },
  { pattern: 'ernie', tokens: 131072 }
]

/**
 * @description 按模型 ID 推荐上下文窗口大小。
 * @param modelId 模型 ID 原文。
 * @returns 命中规则的窗口 token 数；ID 为空或无规则命中时返回 null。
 * @remarks 匹配先归一为小写再作包含判断，首条命中即返回，不做后续规则累加。
 */
export function recommendContextWindow(modelId: string): number | null {
  const id = modelId.trim().toLocaleLowerCase('en-US')
  if (!id) {
    return null
  }
  const match = CONTEXT_WINDOW_RECOMMENDATIONS.find((rule) => id.includes(rule.pattern))
  return match ? match.tokens : null
}
