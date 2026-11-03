import { useEffect, useRef, useState, type ReactElement } from 'react'
import { toast } from 'sonner'
import type { CharacterSummary } from '@gamechat/type'
import { Checkbox } from '@renderer/common/components/checkbox'
import { Button } from '@renderer/common/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from '@renderer/common/components/dialog'
import { getIpcErrorMessage } from '@renderer/common/lib/error-message'
import { trackError } from '@renderer/app/telemetry'
import { createGroup } from '@renderer/services/ai'
import { useCharacterRegistryStore } from '@renderer/store/character-registry'
import { useSessionStore } from '@renderer/store/session'

type CreateGroupDialogProps = {
  /** 可选为固定成员的可见角色摘要列表。 */
  characters: CharacterSummary[]
  /** 关闭回调，创建成功、取消、点击遮罩或按 Escape 时触发。 */
  onClose: () => void
}

/**
 * @description 渲染新建群聊弹窗：多选角色作为固定成员并创建群聊。
 * @param props 可选成员列表与关闭回调。
 * @returns 新建群聊弹窗。
 * @remarks 选中成员为弹窗内本地草稿；创建成功后写入群与会话 Store、退出单角色激活态并关闭弹窗，
 *   会话本体延迟到首条用户消息发出时建立。失败时记录埋点、弹出全局提示并保持弹窗打开以便重试；
 *   取消或直接关闭时草稿丢弃，不产生空群。
 */
export function CreateGroupDialog({ characters, onClose }: CreateGroupDialogProps): ReactElement {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  const canConfirm = selectedIds.length >= 2 && !isSaving

  /**
   * @description 切换弹窗内单个候选成员的选中状态。
   * @param characterId 被切换的角色标识。
   */
  const toggleParticipant = (characterId: string): void => {
    setSelectedIds((current) =>
      current.includes(characterId)
        ? current.filter((id) => id !== characterId)
        : [...current, characterId]
    )
  }

  /**
   * @description 创建成员固定的群聊，成功后将其设为当前聊天对象并关闭弹窗。
   * @remarks 只写入群注册表并切换当前群；不足两人或提交中时由确认按钮禁用拦截。
   */
  const handleCreateGroup = (): void => {
    if (!canConfirm) return

    setIsSaving(true)
    void createGroup({ participantIds: selectedIds })
      .then((group) => {
        useSessionStore.getState().upsertGroup(group)
        useCharacterRegistryStore.getState().setActivateChar(null)
        const sessionState = useSessionStore.getState()
        sessionState.setCurrentGroupId(group.id)
        sessionState.setCurrentSessionId(null)
        onClose()
      })
      .catch((error) => {
        trackError('create-group-failed', getIpcErrorMessage(error), error)
        toast.error(getIpcErrorMessage(error))
      })
      .finally(() => {
        setIsSaving(false)
      })
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          panelRef.current?.focus()
        }}
      >
        <div ref={panelRef} tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
          <header className="flex flex-col gap-1 border-b border-white/10 px-5 py-4 pr-12">
            <DialogTitle>新建群聊</DialogTitle>
            <DialogDescription>选择至少两位角色作为固定成员。</DialogDescription>
          </header>

          <div className="grid min-h-0 flex-1 grid-cols-3 content-start gap-x-2 gap-y-1 overflow-y-auto px-5 py-4">
            {characters.length === 0 ? (
              <span className="col-span-3 py-6 text-center text-xs text-white/35">
                暂无可选角色。
              </span>
            ) : (
              characters.map((character) => (
                <label
                  key={character.id}
                  className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 transition-colors hover:bg-white/5"
                >
                  <Checkbox
                    checked={selectedIds.includes(character.id)}
                    onCheckedChange={() => toggleParticipant(character.id)}
                    aria-label={character.name}
                  />
                  <img
                    src={character.avatar}
                    className="size-6 shrink-0 rounded-full border border-white/20 object-cover"
                    draggable="false"
                  />
                  <span className="truncate text-sm text-white/85">{character.name}</span>
                </label>
              ))
            )}
          </div>

          <footer className="flex items-center justify-between gap-2 border-t border-white/10 bg-black/30 px-5 py-3">
            <span className="text-xs text-white/35">已选 {selectedIds.length} 位成员</span>
            <div className="flex gap-2">
              <Button variant="quiet" size="lg" onClick={onClose}>
                取消
              </Button>
              <Button
                variant="brand"
                size="lg"
                onClick={handleCreateGroup}
                disabled={!canConfirm}
                className="bg-primary/15 hover:bg-primary/25 min-w-20"
              >
                {isSaving ? '创建中…' : '确认创建'}
              </Button>
            </div>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  )
}
