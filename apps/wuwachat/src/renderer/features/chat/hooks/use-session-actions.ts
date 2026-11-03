/**
 * @description 会话条目共用的删除与改名操作：失败统一写入日志流并以全局提示展示。
 * @remarks 角色卡片与群聊卡片的会话条目共用本实现；删除失败时错误继续向上传递，
 *   供调用入口恢复会话条目显示，改名失败仅提示不抛出。
 */
import { useCallback } from 'react'
import { toast } from 'sonner'
import { getIpcErrorMessage } from '@renderer/common/lib/error-message'
import { trackError } from '@renderer/app/telemetry'
import { deleteSession, renameSession } from '@renderer/services/ai'
import { useSessionStore } from '@renderer/store/session'

/** 会话列表项无标题且无消息预览时的占位文案。 */
export const EMPTY_CONVERSATION_TEXT = '新的对话已开始'

/** 会话条目共用操作：删除与改名回调。 */
export type SessionActions = {
  /** 删除一个会话；承诺拒绝表示删除未成功。 */
  handleDeleteSession: (sessionId: string) => Promise<void>
  /** 重命名一个会话，成功后本地状态随广播更新。 */
  handleRenameSession: (sessionId: string, title: string) => void
}

/**
 * @description 提供会话条目共用的删除与改名回调。
 * @returns 删除与改名的稳定回调。
 */
export function useSessionActions(): SessionActions {
  const handleDeleteSession = useCallback((sessionId: string): Promise<void> => {
    return deleteSession({ sessionId })
      .then(() => undefined)
      .catch((error) => {
        trackError('delete-session-failed', getIpcErrorMessage(error), error)
        toast.error(getIpcErrorMessage(error))
        throw error
      })
  }, [])

  const handleRenameSession = useCallback((sessionId: string, title: string): void => {
    void renameSession({ sessionId, title })
      .then(({ session, summary }) => {
        useSessionStore.getState().applySessionUpdate(session, summary)
      })
      .catch((error) => {
        trackError('rename-session-failed', getIpcErrorMessage(error), error)
        toast.error(getIpcErrorMessage(error))
      })
  }, [])

  return { handleDeleteSession, handleRenameSession }
}
