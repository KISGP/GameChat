import { memo, type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import * as Dialog from '@radix-ui/react-dialog'
import { Download, LoaderCircle, Pencil, RefreshCcw, Save, Trash2 } from 'lucide-react'
import type { LocalCharacterEntry, RemoteCharacterEntry } from '@gamechat/type'
import { CharacterAccordionCard } from '@renderer/common/components/character-accordion-card'
import { RingProgress } from '@renderer/common/components/ring-progress'
import { Switch } from '@renderer/common/components/switch'
import { Checkbox } from '@renderer/common/components/checkbox'
import { Button } from '@renderer/common/components/button'
import { useCharacterRegistryStore } from '@renderer/store/character-registry'
import { useSessionStore } from '@renderer/store/session'
import { useAsyncAction } from '@renderer/common/hooks/useAsyncAction'
import { getCharacterPrompt, saveCharacterPrompt } from '@renderer/services/ai'
import { getIpcErrorMessage } from '@renderer/common/lib/error-message'
import {
  deleteCharacter,
  downloadCharacter,
  cancelCharacterDownload,
  setCharacterVisibility,
  syncNowCharacters
} from '@renderer/services/characters'

type ListItem = {
  id: string
  name: string
  description?: string
  avatar?: string
  cardBg?: string
  local?: LocalCharacterEntry
  remote?: RemoteCharacterEntry
}

type CharacterAccordionItemProps = {
  item: ListItem
  open: boolean
  onOpenChange: (itemId: string, open: boolean) => void
  prompt: string
  promptLoading: boolean
  onEditPrompt: (item: ListItem) => void
  onRetry: (item: ListItem) => void
  retrying: boolean
  onDownload: (item: ListItem) => void
  downloadPending: boolean
  onVisibilityChange: (item: ListItem, visible: boolean) => void
  visibilityUpdating: boolean
  onDelete: (item: ListItem) => void
}

function CharacterAccordionItemImpl({
  item,
  open,
  onOpenChange,
  prompt,
  promptLoading,
  onEditPrompt,
  onRetry,
  retrying,
  onDownload,
  downloadPending,
  onVisibilityChange,
  visibilityUpdating,
  onDelete
}: CharacterAccordionItemProps): ReactElement {
  const remote = item.remote
  const local = item.local
  const hasUpdate = Boolean(local?.syncStatus?.updateAvailable)
  const localSyncState = local?.syncStatus?.syncState
  const canRetry = Boolean(remote?.syncError || remote?.syncState === 'failed')
  const downloadProgress = useCharacterRegistryStore(
    (state) => state.downloadProgress[item.id]
  )
  const downloadPercent =
    downloadProgress && downloadProgress.totalBytes !== null && downloadProgress.totalBytes > 0
      ? Math.min(100, Math.round((downloadProgress.receivedBytes / downloadProgress.totalBytes) * 100))
      : null
  // 下载失败与远端下架是列表态的关键状态提示，并入描述行随卡片展示。
  const description = [
    item.description,
    remote?.syncError ? '下载失败' : null,
    local?.syncStatus?.remoteUnavailable ? '远端已下架' : null
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <CharacterAccordionCard
      name={item.name}
      avatar={item.avatar}
      cardBg={item.cardBg}
      description={description || undefined}
      open={open}
      onOpenChange={(nextOpen) => onOpenChange(item.id, nextOpen)}
      headerExtra={
        <>
          {remote?.syncState === 'downloading' ? (
            <Button variant="brand" size="xs" disabled>
              <RingProgress percent={downloadPercent} />
              下载中...
            </Button>
          ) : remote?.syncState === 'queued' ? (
            <Button
              variant="link"
              onClick={() => onDownload(item)}
              disabled={downloadPending}
              className="h-auto p-0 text-xs font-normal"
            >
              {downloadPending ? '处理中...' : '排队中 · 取消'}
            </Button>
          ) : remote ? (
            <Button
              variant="brand"
              size="xs"
              onClick={() => (canRetry ? void onRetry(item) : void onDownload(item))}
              disabled={retrying || downloadPending}
            >
              {retrying || downloadPending ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
              {retrying || downloadPending ? '处理中...' : canRetry ? '重试下载' : '下载角色'}
            </Button>
          ) : canRetry ? (
            <Button
              variant="brand"
              size="xs"
              onClick={() => void onRetry(item)}
              disabled={retrying}
            >
              {retrying ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
              {retrying ? '重试中...' : '重试下载'}
            </Button>
          ) : localSyncState === 'queued' ? (
            <Button
              variant="link"
              onClick={() => void onDownload(item)}
              disabled={downloadPending}
              className="h-auto p-0 text-xs font-normal"
            >
              {downloadPending ? '处理中...' : '排队中'}
            </Button>
          ) : localSyncState === 'downloading' ? (
            <Button variant="brand" size="xs" disabled>
              <RingProgress percent={downloadPercent} />
              更新中...
            </Button>
          ) : hasUpdate ? (
            <Button
              variant="brand"
              size="xs"
              onClick={() => void onDownload(item)}
              disabled={downloadPending}
            >
              {downloadPending ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <RefreshCcw className="size-3.5" />
              )}
              {downloadPending ? '更新中...' : '更新角色'}
            </Button>
          ) : null}
        </>
      }
    >
      {local ? (
        <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
          <div>
            <div className="text-sm font-medium text-white/85">启用角色</div>
          </div>
          <Switch
            checked={local.visible !== false}
            onCheckedChange={(visible) => onVisibilityChange(item, visible)}
            disabled={visibilityUpdating}
            aria-label={`${item.name}在聊天页显示`}
          />
        </div>
      ) : (
        <p className="text-sm text-white/65">
          {remote?.syncState === 'downloading'
            ? '角色正在下载中，完成后可以继续配置。'
            : remote?.syncError || remote?.syncState === 'failed'
              ? `角色下载失败：${remote.syncError || '未知错误'}`
              : '该角色尚未安装到本地。'}
        </p>
      )}
      {local && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium text-white/85">提示词预览</div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="xs"
                onClick={() => onEditPrompt(item)}
                disabled={promptLoading}
              >
                <Pencil className="size-3.5" />
                编辑提示词
              </Button>
            </div>
          </div>
          <pre className="max-h-72 min-h-24 overflow-auto rounded border border-white/10 bg-black/35 p-3 text-xs leading-5 break-words whitespace-pre-wrap text-white/75">
            {promptLoading ? '正在读取 Prompt...' : prompt || '暂无 Prompt 内容'}
          </pre>
          <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-3">
            <div>
              <div className="text-sm font-medium text-white/85">删除角色</div>
              <div className="mt-0.5 text-xs text-white/45">
                角色文件将移入系统回收站，之后可从角色库重新下载
              </div>
            </div>
            <Button variant="danger" size="xs" onClick={() => onDelete(item)}>
              <Trash2 className="size-3.5" />
              删除角色
            </Button>
          </div>
        </>
      )}
    </CharacterAccordionCard>
  )
}

// 仅 open、prompt 等值 prop 变化时重渲染：回调 prop 全部为稳定引用，父级无关状态更新不再波及整张列表
const CharacterAccordionItem = memo(CharacterAccordionItemImpl)

export function CharacterTab(): ReactElement {
  const registry = useCharacterRegistryStore((state) => state.registry)
  const setRegistry = useCharacterRegistryStore((state) => state.setRegistry)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [prompts, setPrompts] = useState<Record<string, string>>({})
  const [promptErrors, setPromptErrors] = useState<Record<string, string>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [pendingId, setPendingId] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingPrompt, setEditingPrompt] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<ListItem | null>(null)
  const [deleteSessionsChecked, setDeleteSessionsChecked] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const summaries = useSessionStore((state) => state.summaries)
  // 注册表同步错误是运行态提示，随状态变化以 toast 呈现一次，不再占用页面横幅。
  const reportedSyncErrorRef = useRef<string>('')
  useEffect(() => {
    const syncError = registry.syncError || ''
    if (!syncError || reportedSyncErrorRef.current === syncError) {
      return
    }
    reportedSyncErrorRef.current = syncError
    toast.error(syncError)
  }, [registry.syncError])
  const items = useMemo(
    () => [
      ...registry.local.map(
        (local): ListItem => ({
          id: local.id,
          name: local.name,
          description: local.description,
          avatar: local.avatar,
          cardBg: local.cardBg,
          local
        })
      ),
      ...registry.remote.map(
        (remote): ListItem => ({
          id: remote.id,
          name: remote.name,
          description: remote.description,
          avatar: remote.avatar,
          cardBg: remote.cardBg,
          remote
        })
      )
    ],
    [registry]
  )
  const editingItem = items.find((item) => item.id === editingId) ?? null
  const effectiveExpandedId =
    expandedId && items.some((item) => item.id === expandedId) ? expandedId : null
  // 群聊会话的归属者是群 ID，这里统计到的只有该角色的独立会话。
  const deleteTargetSessionCount = deleteTarget
    ? summaries.filter((summary) => summary.ownerId === deleteTarget.id).length
    : 0

  useEffect(() => {
    if (!effectiveExpandedId) return

    const item = items.find((candidate) => candidate.id === effectiveExpandedId)
    const local = item?.local
    if (!local || prompts[local.id] !== undefined) return

    let mounted = true
    getCharacterPrompt(local.id)
      .then((document) => {
        if (mounted) {
          setPrompts((current) => ({ ...current, [local.id]: document.prompt }))
          setPromptErrors((current) => {
            const next = { ...current }
            delete next[local.id]
            return next
          })
        }
      })
      .catch((cause) => {
        if (mounted) {
          const message = getIpcErrorMessage(cause)
          setPromptErrors((current) => ({ ...current, [local.id]: message }))
          toast.error(message)
        }
      })

    return () => {
      mounted = false
    }
  }, [effectiveExpandedId, items, prompts])

  /**
   * @description 返回角色当前应展示的 Prompt，优先使用尚未保存的草稿。
   * @param item 需要读取 Prompt 的角色列表项。
   * @returns 角色 Prompt 文本；远端角色没有本地 Prompt 时返回空字符串。
   */
  function getPromptForItem(item: ListItem): string {
    return item.local ? (drafts[item.local.id] ?? prompts[item.local.id] ?? '') : ''
  }

  /**
   * @description 保存指定本地角色的 Prompt，并清理对应草稿。
   */
  const savePromptAction = useAsyncAction(
    async (characterId: string, prompt: string) => {
      setPendingId(characterId)
      return saveCharacterPrompt(characterId, prompt)
    },
    {
      onSuccess: (document) => {
        setPrompts((current) => ({ ...current, [document.characterId]: document.prompt }))
        setDrafts((current) => {
          const next = { ...current }
          delete next[document.characterId]
          return next
        })
        setEditingId(null)
      },
      onError: (cause) => toast.error(getIpcErrorMessage(cause)),
      onSettled: () => setPendingId('')
    }
  )

  /**
   * @description 重试远端角色同步，并更新角色注册表。
   */
  const retryAction = useAsyncAction(
    async (item: ListItem) => {
      if (!item.remote) return undefined
      setPendingId(item.id)
      const registry = await downloadCharacter(item.id)
      if (registry) {
        setRegistry(registry)
      }
      return registry
    },
    {
      onError: (cause) => toast.error(getIpcErrorMessage(cause)),
      onSettled: () => setPendingId('')
    }
  )

  /**
   * @description 加入或取消远端角色的下载队列。
   */
  const downloadAction = useAsyncAction(
    async (item: ListItem) => {
      const characterId = item.remote?.id || item.local?.id
      if (!characterId) return undefined
      setPendingId(item.id)
      if (item.remote?.syncState === 'queued') {
        const cancelled = await cancelCharacterDownload(characterId)
        if (cancelled) setRegistry(cancelled)
        return cancelled
      }
      const registry = await downloadCharacter(characterId)
      if (registry) {
        setRegistry(registry)
      }
      return registry
    },
    {
      onError: (cause) => toast.error(getIpcErrorMessage(cause)),
      onSettled: () => setPendingId('')
    }
  )

  /**
   * @description 更新本地角色在聊天页角色栏中的显示状态。
   */
  const updateVisibilityAction = useAsyncAction(
    async (item: ListItem, visible: boolean) => {
      if (!item.local) return undefined
      setPendingId(item.id)
      return setCharacterVisibility(item.local.id, visible)
    },
    {
      onSuccess: (registry) => {
        if (registry) setRegistry(registry)
      },
      onError: (cause) => toast.error(getIpcErrorMessage(cause)),
      onSettled: () => setPendingId('')
    }
  )

  /**
   * @description 触发一次远端角色同步并更新注册表。
   */
  const refreshAction = useAsyncAction(
    async () => {
      return syncNowCharacters()
    },
    {
      onSuccess: (registry) => setRegistry(registry),
      onError: (cause) => toast.error(getIpcErrorMessage(cause))
    }
  )

  /**
   * @description 删除本地角色，并刷新注册表；指向该角色的激活态由注册表 store 在注册表
   *   更新时统一置空。
   */
  const deleteAction = useAsyncAction(
    async (item: ListItem, deleteSessions: boolean) => {
      setDeleteError('')
      const registry = await deleteCharacter(item.id, deleteSessions)
      setRegistry(registry)
      return registry
    },
    {
      onSuccess: () => {
        setDeleteTarget(null)
        setDeleteSessionsChecked(false)
      },
      onError: (cause) => setDeleteError(getIpcErrorMessage(cause))
    }
  )

  // 列表项回调取 run 的稳定引用：配合列表项 memo，展开一张卡片时只重渲染新旧两张卡
  const { run: runRetryAction } = retryAction
  const { run: runDownloadAction } = downloadAction
  const { run: runUpdateVisibilityAction } = updateVisibilityAction
  // Prompt 状态的事件时镜像：回调需要稳定引用，点击时经此读取最新 prompts 与 drafts
  const promptTextRef = useRef({ prompts, drafts })
  useEffect(() => {
    promptTextRef.current = { prompts, drafts }
  }, [prompts, drafts])

  /**
   * @description 打开删除角色确认弹窗；角色仍在群聊中时拒绝并提示。
   * @param item 待删除的本地角色列表项。
   * @remarks 群成员在创建时固定不可变，含该角色的群必须先删除才能删除角色；
   *   会话存在活跃运行的校验由主进程在删除入口执行，失败原因展示在弹窗内。
   *   群聊归属经会话 store 的 getState 现读，回调引用保持稳定。
   */
  const handleDeleteRequest = useCallback((item: ListItem): void => {
    if (!item.local) {
      return
    }
    const inGroup = useSessionStore
      .getState()
      .groups.some((group) => group.participantIds.includes(item.id))
    if (inGroup) {
      toast.error('该角色仍在群聊中，请先删除相关群聊后再删除角色。')
      return
    }
    setDeleteSessionsChecked(false)
    setDeleteError('')
    setDeleteTarget(item)
  }, [])

  /**
   * @description 切换角色折叠状态，并确保页面同时只展开一个角色。
   * @param itemId 需要切换的角色标识。
   * @param open 折叠组件期望的目标状态。
   */
  const handleToggle = useCallback((itemId: string, open: boolean): void => {
    setExpandedId(open ? itemId : null)
  }, [])

  /**
   * @description 打开本地角色 Prompt 编辑弹窗，并将当前草稿复制到弹窗状态。
   * @param item 需要编辑 Prompt 的角色列表项。
   * @remarks 仅在 Prompt 已加载时允许打开：未加载或加载失败时打开会得到空草稿，
   *   保存将以空串覆盖远端 Prompt。prompts 与 drafts 经 promptTextRef 现读，
   *   回调引用不随 Prompt 加载或草稿输入重建。
   */
  const handleEditPrompt = useCallback((item: ListItem): void => {
    const local = item.local
    const { prompts: loadedPrompts, drafts: currentDrafts } = promptTextRef.current
    if (!local || loadedPrompts[local.id] === undefined) {
      return
    }
    setEditingPrompt(currentDrafts[local.id] ?? loadedPrompts[local.id] ?? '')
    setEditingId(item.id)
  }, [])

  return (
    <div className="h-full overflow-y-auto px-4">
      <div className="mx-auto h-full max-w-6xl pb-6">
        <div className="mb-3 flex items-center justify-between gap-3 px-1 text-xs text-white/45">
          <span>
            {registry.isSyncing
              ? '正在同步角色...'
              : registry.refreshedAt
                ? `上次检查: ${new Date(registry.refreshedAt).toLocaleString()}`
                : '等待角色同步'}
          </span>
          <Button
            variant="quiet"
            size="xs"
            onClick={() => void refreshAction.run()}
            disabled={registry.isSyncing || refreshAction.loading}
          >
            {registry.isSyncing || refreshAction.loading ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <RefreshCcw className="size-3.5" />
            )}
          </Button>
        </div>
        <div className="space-y-2">
          {items.map((item) => (
            <CharacterAccordionItem
              key={item.id}
              item={item}
              open={effectiveExpandedId === item.id}
              onOpenChange={handleToggle}
              prompt={getPromptForItem(item)}
              promptLoading={
                effectiveExpandedId === item.id &&
                Boolean(
                  item.local &&
                  prompts[item.local.id] === undefined &&
                  promptErrors[item.local.id] === undefined
                )
              }
              onEditPrompt={handleEditPrompt}
              onRetry={runRetryAction}
              retrying={retryAction.loading && pendingId === item.id}
              onDownload={runDownloadAction}
              downloadPending={downloadAction.loading && pendingId === item.id}
              onVisibilityChange={runUpdateVisibilityAction}
              visibilityUpdating={updateVisibilityAction.loading && pendingId === item.id}
              onDelete={handleDeleteRequest}
            />
          ))}
          {!items.length && (
            <div className="py-6 text-center text-sm text-white/50">正在准备角色...</div>
          )}
        </div>
      </div>

      <Dialog.Root
        open={editingId !== null}
        onOpenChange={(open) => {
          if (!open) setEditingId(null)
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-100 bg-black/70" />
          <Dialog.Content className="fixed inset-8 z-101 flex flex-col rounded border border-white/15 bg-[#171717] p-5 outline-none">
            <Dialog.Title className="text-lg font-medium text-white">
              编辑 {editingItem?.name ?? '角色'} Prompt
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-white/55">
              修改完成后保存，取消不会丢失当前草稿。
            </Dialog.Description>
            <textarea
              value={editingPrompt}
              onChange={(event) => {
                setEditingPrompt(event.target.value)
                if (editingId) {
                  setDrafts((current) => ({ ...current, [editingId]: event.target.value }))
                }
              }}
              className="mt-4 min-h-0 flex-1 resize-none rounded border border-white/10 bg-black/35 p-4 text-sm leading-relaxed text-white/90 outline-none focus:border-[#e8c690]"
            />
            <div className="mt-4 flex justify-end gap-3">
              <Dialog.Close asChild>
                <Button variant="quiet" size="lg">
                  取消
                </Button>
              </Dialog.Close>
              <Button
                variant="primary"
                size="lg"
                onClick={() => {
                  if (editingId) void savePromptAction.run(editingId, editingPrompt)
                }}
                disabled={!editingId || (savePromptAction.loading && pendingId === editingId)}
              >
                {savePromptAction.loading && pendingId === editingId ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                {savePromptAction.loading && pendingId === editingId ? '保存中...' : '保存'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-100 bg-black/70" />
          <Dialog.Content className="fixed top-1/2 left-1/2 z-101 w-[440px] -translate-x-1/2 -translate-y-1/2 rounded border border-white/15 bg-[#171717] p-5 outline-none">
            <Dialog.Title className="text-lg font-medium text-white">
              删除 {deleteTarget?.name ?? '角色'}
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm leading-relaxed text-white/55">
              角色文件将移入系统回收站，之后可从角色库重新下载。
              {deleteTargetSessionCount > 0
                ? `该角色名下有 ${deleteTargetSessionCount} 条聊天会话。`
                : '该角色名下没有聊天会话。'}
            </Dialog.Description>
            <label className="mt-4 flex items-center gap-2.5 text-sm text-white/80">
              <Checkbox
                checked={deleteSessionsChecked}
                onCheckedChange={(checked) => setDeleteSessionsChecked(checked === true)}
              />
              同时删除全部聊天会话
            </label>
            {deleteError && (
              <div className="mt-3 rounded border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {deleteError}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-3">
              <Dialog.Close asChild>
                <Button variant="quiet" size="lg">
                  取消
                </Button>
              </Dialog.Close>
              <Button
                variant="danger"
                size="lg"
                onClick={() => {
                  if (deleteTarget) void deleteAction.run(deleteTarget, deleteSessionsChecked)
                }}
                disabled={deleteAction.loading}
                className="bg-destructive/80 hover:bg-destructive text-white"
              >
                {deleteAction.loading ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                {deleteAction.loading ? '删除中...' : '删除角色'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
