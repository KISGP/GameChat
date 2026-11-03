import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

/** 已关闭徽章的最大保留条数；超出后按写入顺序淘汰最旧的记录，避免无界增长。 */
const DISMISSED_BADGES_LIMIT = 500

type DismissedBadgesState = {
  /** 已被用户关闭的徽章条目键；跨会话与跨启动持久化，关闭过的提示不再复现。 */
  keys: string[]
  /** 记录一条徽章为已关闭。 */
  dismissBadge: (key: string) => void
}

/**
 * @description 管理消息列表系统提示徽章的关闭记录。
 * @remarks 徽章本身是渲染期派生物、不落盘，关闭记录经 localStorage 持久化承担「关闭后不再出现」的语义；
 *   条目键由全局唯一的消息 ID 派生，无需按会话分桶，超出上限时按写入顺序淘汰最旧记录。
 */
export const useDismissedBadgesStore = create<DismissedBadgesState>()(
  persist(
    (set) => ({
      keys: [],
      dismissBadge: (key) =>
        set((state) => {
          if (state.keys.includes(key)) {
            return state
          }
          const keys = [...state.keys, key]
          return { keys: keys.slice(Math.max(0, keys.length - DISMISSED_BADGES_LIMIT)) }
        })
    }),
    {
      name: 'wuwachat-dismissed-badges',
      storage: createJSONStorage(() => localStorage)
    }
  )
)
