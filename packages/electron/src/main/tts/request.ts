import type { TtsSynthesisRequest } from '@gamechat/type'

/**
 * @description 判断 TTS 合成请求是否含有可用的关联标识和文本。
 * @param value 来自跨进程调用的未知值。
 * @returns 值是否符合 TTS 合成请求的最小结构。
 */
export function isTtsSynthesisRequest(value: unknown): value is TtsSynthesisRequest {
  if (!value || typeof value !== 'object') {
    return false
  }

  const request = value as Partial<TtsSynthesisRequest>
  return (
    typeof request.requestId === 'string' &&
    typeof request.messageId === 'string' &&
    typeof request.characterId === 'string' &&
    typeof request.text === 'string'
  )
}
