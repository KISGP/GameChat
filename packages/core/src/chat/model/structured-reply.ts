/**
 * @description 解析模型可选的图片结构化回复并提取用户可见答案。
 * @param content 模型返回的原始文本。
 * @returns 有效结构化回复的答案与图片分析列表；格式不匹配时返回 null。
 * @remarks 这是图片结构化回复协议（JSON 嗅探）的唯一解析入口，终答节点与工具调用内容回退共用 JSON 嗅探逻辑。
 */
export function parseStructuredAssistantResponse(content: string): {
  answer: string
  imageAnalyses: Array<{ resourceId: string; analysis: string }>
} | null {
  const value = parseJsonObject(content)
  if (!value) return null
  const answer = (value as { answer?: unknown }).answer
  if (typeof answer !== 'string') return null
  const imageAnalyses = Array.isArray((value as { imageAnalyses?: unknown }).imageAnalyses)
    ? (value as { imageAnalyses: unknown[] }).imageAnalyses
        .filter((item): item is { resourceId: string; analysis: string } => {
          if (!item || typeof item !== 'object') return false
          const entry = item as { resourceId?: unknown; analysis?: unknown }
          return (
            typeof entry.resourceId === 'string' &&
            typeof entry.analysis === 'string' &&
            entry.analysis.trim().length > 0
          )
        })
        .map((item) => ({ resourceId: item.resourceId.trim(), analysis: item.analysis.trim() }))
    : []
  return { answer: answer.trim(), imageAnalyses }
}

/**
 * @description 将模型文本解析为 JSON 对象。
 * @param content 模型返回的文本内容。
 * @returns JSON 对象，否则返回 null。
 */
export function parseJsonObject(content: string): Record<string, unknown> | null {
  const normalized = content.trim()
  if (!normalized.startsWith('{') || !normalized.endsWith('}')) return null
  try {
    const value: unknown = JSON.parse(normalized)
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}
