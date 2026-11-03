import type { ChatEmoticonImage } from '@gamechat/schema'

let userCache: Promise<ChatEmoticonImage[]> | null = null
const characterCache = new Map<string, Promise<ChatEmoticonImage[]>>()

/**
 * @description 读取并缓存应用内置用户表情。
 * @returns 用户表情图片清单。
 * @remarks 缓存的是请求 Promise,失败时移除缓存条目,下次调用重新拉取,避免瞬时失败被永久缓存。
 */
export function getUserEmoticons(): Promise<ChatEmoticonImage[]> {
  if (!userCache) {
    const pending = window.ai.getUserEmoticons()
    userCache = pending
    void pending.catch(() => {
      if (userCache === pending) userCache = null
    })
  }
  return userCache
}

/**
 * @description 读取并缓存指定角色的表情。
 * @param characterId 角色标识。
 * @returns 角色表情图片清单。
 * @remarks 缓存的是请求 Promise,失败时移除缓存条目,下次调用重新拉取,避免瞬时失败被永久缓存。
 */
export function getCharacterEmoticons(characterId: string): Promise<ChatEmoticonImage[]> {
  const cached = characterCache.get(characterId)
  if (cached) return cached
  const pending = window.ai.getCharacterEmoticons(characterId)
  characterCache.set(characterId, pending)
  void pending.catch(() => {
    if (characterCache.get(characterId) === pending) characterCache.delete(characterId)
  })
  return pending
}

/**
 * @description 清理指定角色的表情缓存。
 * @param characterId 角色标识。
 */
export function clearCharacterEmoticonCache(characterId: string): void {
  characterCache.delete(characterId)
}
