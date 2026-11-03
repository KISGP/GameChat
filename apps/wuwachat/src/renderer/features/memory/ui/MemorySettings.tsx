import { memo, useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { toast } from 'sonner'
import { FolderOpen, LoaderCircle, Pencil, Save } from 'lucide-react'
import { CONTEXT_BUDGET_RATIO_MAX, CONTEXT_BUDGET_RATIO_MIN } from '@gamechat/schema'
import type { CharacterSessionStateCardView, LocalCharacterEntry } from '@gamechat/type'
import { useMemoryStore } from '@renderer/features/memory/store/memory'
import { CharacterAccordionCard } from '@renderer/common/components/character-accordion-card'
import { useCharacterRegistryStore } from '@renderer/store/character-registry'
import { useAppSettingsStore } from '@renderer/store/app-settings'
import { useProvidersStore } from '@renderer/store/providers'
import { getCharacterSessionStateCards } from '@renderer/services/ai'
import {
  getMemoryMarkdown,
  openMemoryDirectory as openMemoryDirectoryApi,
  saveMemoryMarkdown
} from '@renderer/services/memory'
import { Section } from '@renderer/common/components/Section'
import { SettingItem } from '@renderer/common/components/SettingItem'
import { Button } from '@renderer/common/components/button'
import { Switch } from '@renderer/common/components/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/common/components/select'
import { useAsyncAction } from '@renderer/common/hooks/useAsyncAction'
import { useSessionStore } from '@renderer/store/session'
import { trackUiEvent } from '@renderer/app/telemetry'
import { getIpcErrorMessage } from '@renderer/common/lib/error-message'

/**
 * @description 渲染记忆与上下文设置：记忆总开关、记忆编辑与自动压缩历史（含上下文预算）。
 * @param props 组件 props。
 * @returns 记忆设置页面。
 * @remarks 上下文预算与压缩设置持久化在应用通用设置中，主进程的预算决策与压缩器读取同一份数据；
 *   状态卡列表的会话标题可点击跳转对话，跳转后由调用方关闭设置覆盖层。
 */
export function MemoryTab({ onClose }: { onClose: () => void }): ReactElement {
  const settings = useMemoryStore((state) => state.settings)
  const saveSettings = useMemoryStore((state) => state.saveSettings)
  const contextBudget = useAppSettingsStore((state) => state.settings.contextBudget)
  const updateContextBudget = useAppSettingsStore((state) => state.updateContextBudget)
  const contextCompression = useAppSettingsStore((state) => state.settings.contextCompression)
  const updateContextCompression = useAppSettingsStore((state) => state.updateContextCompression)
  const providersStore = useProvidersStore((state) => state.store)
  const localCharacters = useCharacterRegistryStore((state) => state.registry.local)
  const activateSession = useSessionStore((state) => state.activateSession)
  const setCurrentGroupId = useSessionStore((state) => state.setCurrentGroupId)
  const setActivateChar = useCharacterRegistryStore((state) => state.setActivateChar)
  const [expandedCharacterId, setExpandedCharacterId] = useState<string | null>(null)
  const [memoryByCharacter, setMemoryByCharacter] = useState<Record<string, string>>({})
  const [memoryErrors, setMemoryErrors] = useState<Record<string, string>>({})
  const [stateCardsByCharacter, setStateCardsByCharacter] = useState<
    Record<string, CharacterSessionStateCardView[]>
  >({})
  const [stateCardErrors, setStateCardErrors] = useState<Record<string, string>>({})
  const [isBusy, setIsBusy] = useState(false)
  const [editingCharacterId, setEditingCharacterId] = useState<string | null>(null)
  const [editingDraft, setEditingDraft] = useState('')
  // 已发起或已完成的记忆加载键：跳过进行中与已结束的请求，注册表刷新不触发重读
  const memoryLoadKeysRef = useRef<Set<string>>(new Set())
  // 已发起或已完成的状态卡加载键：仅展开角色时懒加载，收起再展开不重读
  const stateCardLoadKeysRef = useRef<Set<string>>(new Set())
  // 页面存活标记：在途请求只在页面存活期间落地，卸载后丢弃
  const pageAliveRef = useRef(true)
  useEffect(
    () => () => {
      pageAliveRef.current = false
    },
    []
  )
  const editingCharacter = localCharacters.find((character) => character.id === editingCharacterId)

  useEffect(() => {
    // 展开角色时懒加载该角色参与各会话的状态卡；已发起或已结束的跳过。
    const characterId = expandedCharacterId
    if (!characterId || stateCardLoadKeysRef.current.has(characterId)) {
      return
    }
    stateCardLoadKeysRef.current.add(characterId)
    void getCharacterSessionStateCards(characterId)
      .then((cards) => {
        if (pageAliveRef.current) {
          setStateCardsByCharacter((current) => ({ ...current, [characterId]: cards }))
        }
      })
      .catch((cause: unknown) => {
        if (pageAliveRef.current) {
          setStateCardErrors((current) => ({
            ...current,
            [characterId]: getErrorMessage(cause)
          }))
        }
      })
  }, [expandedCharacterId])

  useEffect(() => {
    // 进入页面即预载全部角色的记忆全文，收起卡片直接展示记忆状态；已发起或已结束的跳过。
    if (!settings.enabled) {
      return
    }
    const pending = localCharacters.filter(
      (character) => !memoryLoadKeysRef.current.has(character.id)
    )
    if (pending.length === 0) {
      return
    }
    for (const character of pending) {
      memoryLoadKeysRef.current.add(character.id)
    }
    for (const character of pending) {
      void getMemoryMarkdown(character.id)
        .then((content) => {
          if (pageAliveRef.current) {
            setMemoryByCharacter((current) => ({ ...current, [character.id]: content }))
          }
        })
        .catch((cause: unknown) => {
          if (pageAliveRef.current) {
            const message = getErrorMessage(cause)
            setMemoryErrors((current) => ({ ...current, [character.id]: message }))
          }
        })
    }
  }, [settings.enabled, localCharacters])

  /**
   * @description 切换角色记忆卡片折叠状态，并确保页面同时只展开一个角色。
   * @param characterId 需要切换的角色标识。
   * @param open 折叠组件期望的目标状态。
   */
  const handleToggleMemory = useCallback((characterId: string, open: boolean): void => {
    setExpandedCharacterId(open ? characterId : null)
  }, [])

  /**
   * @description 打开指定角色的记忆编辑弹窗，并把当前内容复制到草稿。
   * @param characterId 目标角色 ID。
   * @param content 编辑入口处已加载的记忆全文。
   * @remarks 列表项仅在记忆已加载时渲染编辑按钮，content 不会为 undefined。
   */
  const handleEditMemory = useCallback((characterId: string, content: string): void => {
    setEditingDraft(content)
    setEditingCharacterId(characterId)
  }, [])

  /**
   * @description 激活指定会话并关闭设置覆盖层，跳转到对应对话。
   * @param sessionId 目标会话标识。
   * @remarks 聊天面板按激活的角色或群聊渲染目标：跳转前依据会话归属先恢复目标——
   *   群聊会话切换群聊目标并清空角色，单聊会话激活对应角色并清空群聊目标；
   *   摘要或角色在本地注册表中缺失时仅激活会话，不强行恢复目标。
   */
  const handleJumpToSession = useCallback(
    (sessionId: string): void => {
      trackUiEvent('state-card-session-open', 'User opened a conversation from state cards', {
        sessionId
      })
      const { summaries, groups } = useSessionStore.getState()
      const summary = summaries.find((item) => item.id === sessionId)
      const group = summary ? groups.find((item) => item.id === summary.ownerId) : undefined
      if (group) {
        setActivateChar(null)
        setCurrentGroupId(group.id)
      } else if (summary) {
        const character = useCharacterRegistryStore
          .getState()
          .registry.local.find((item) => item.id === summary.ownerId)
        if (character) {
          setActivateChar(character)
          setCurrentGroupId(null)
        }
      }
      activateSession(sessionId)
      onClose()
    },
    [activateSession, setCurrentGroupId, setActivateChar, onClose]
  )

  /**
   * @description 保存记忆总开关变更。
   * @param checked 是否启用长期记忆。
   */
  async function updateMemoryEnabled(checked: boolean): Promise<void> {
    try {
      await saveSettings({ ...settings, enabled: checked })
    } catch (cause) {
      toast.error(`保存失败：${getErrorMessage(cause)}`)
    }
  }

  /**
   * @description 保存编辑弹窗中的记忆全文并同步预载缓存。
   */
  const saveMemoryAction = useAsyncAction(
    async (characterId: string, content: string) => saveMemoryMarkdown(characterId, content),
    {
      onSuccess: (content) => {
        if (editingCharacterId) {
          setMemoryByCharacter((current) => ({
            ...current,
            [editingCharacterId]: content
          }))
        }
        setEditingCharacterId(null)
        toast.success('记忆已保存')
      },
      onError: (cause) => toast.error(getErrorMessage(cause))
    }
  )

  /**
   * @description 用系统默认应用打开记忆存储目录。
   */
  async function openMemoryDirectory(): Promise<void> {
    if (isBusy) {
      return
    }
    setIsBusy(true)
    try {
      await openMemoryDirectoryApi()
    } catch (cause) {
      toast.error(getErrorMessage(cause))
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="mx-auto h-full overflow-y-auto px-4 pb-4">
      <Section title="记忆">
        <SettingItem
          title="启用记忆"
          expandedItems={[
            <p key="description" className="text-muted-foreground">
              关闭后不再从历史压缩中提炼记忆，模型也不再看到既有记忆；记忆文件保留在磁盘上，
              重新开启后恢复可用。
            </p>
          ]}
        >
          <Switch
            id="memory-enabled"
            checked={settings.enabled}
            onCheckedChange={(checked) => void updateMemoryEnabled(checked)}
          />
        </SettingItem>
      </Section>
      <Section title="上下文">
        <SettingItem
          title="自动压缩历史"
          expandedItems={[
            <p key="description" className="text-muted-foreground">
              开启后，会话回复结束时若上下文占用达到压缩水位，自动把较早的历史整理为滚动摘要并更新记忆；也可在输入框输入
              /压缩
              手动触发，关闭后仅手动触发。压缩水位为触发自动压缩的占用比例（占模型窗口）；水位之上不干预，输入到达窗口墙（窗口减
              8K）时才会从最旧端省略历史；实际占用比例可在输入框的模型菜单查看，且不随本开关变化。
            </p>,
            <label key="budget" className="flex items-center justify-between">
              <span className="text-md text-white/55">压缩水位（%）</span>
              <input
                type="number"
                aria-label="压缩水位（%）"
                min={CONTEXT_BUDGET_RATIO_MIN * 100}
                max={CONTEXT_BUDGET_RATIO_MAX * 100}
                defaultValue={Math.round(contextBudget.budgetRatio * 100)}
                onBlur={(event) => {
                  const value = Number(event.currentTarget.value)
                  if (Number.isFinite(value)) {
                    const ratio = Math.min(
                      CONTEXT_BUDGET_RATIO_MAX,
                      Math.max(CONTEXT_BUDGET_RATIO_MIN, value / 100)
                    )
                    event.currentTarget.value = String(Math.round(ratio * 100))
                    void updateContextBudget({ budgetRatio: ratio })
                  } else {
                    event.currentTarget.value = String(Math.round(contextBudget.budgetRatio * 100))
                  }
                }}
                className="w-20 border border-white/15 bg-black/35 px-3 py-2 text-center text-sm text-white outline-none focus:border-[#e8c690]"
              />
            </label>,
            <label key="model" className="flex items-center justify-between">
              <span className="text-md text-white/55">整理模型</span>
              <Select
                value={contextCompression.modelId || '__session__'}
                onValueChange={(value) => {
                  void updateContextCompression({ modelId: value === '__session__' ? '' : value })
                }}
              >
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__session__">沿用会话模型</SelectItem>
                  {providersStore.providers.flatMap((provider) =>
                    provider.models.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {provider.name} · {model.model || '未命名模型'}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </label>
          ]}
        >
          <Switch
            checked={contextCompression.enabled}
            onCheckedChange={(enabled) => void updateContextCompression({ enabled })}
            aria-label="自动压缩历史"
          />
        </SettingItem>
      </Section>
      <Section title="角色记忆与状态卡">
        <Button
          variant="quiet"
          size="icon-xs"
          disabled={isBusy}
          onClick={() => void openMemoryDirectory()}
          title="打开记忆目录"
          aria-label="打开记忆目录"
          className="absolute top-0 right-0 z-10"
        >
          <FolderOpen />
        </Button>
        <div className="space-y-2">
          {localCharacters.map((character) => (
            <CharacterMemoryItem
              key={character.id}
              character={character}
              expanded={expandedCharacterId === character.id}
              memoryEnabled={settings.enabled}
              memory={memoryByCharacter[character.id]}
              memoryError={memoryErrors[character.id]}
              stateCards={stateCardsByCharacter[character.id]}
              stateCardsError={stateCardErrors[character.id]}
              onJumpToSession={handleJumpToSession}
              onOpenChange={handleToggleMemory}
              onEdit={handleEditMemory}
            />
          ))}
          {!localCharacters.length && (
            <div className="py-4 text-center text-sm text-white/50">暂无本地角色。</div>
          )}
        </div>
      </Section>

      <Dialog.Root
        open={editingCharacterId !== null}
        onOpenChange={(open) => {
          if (!open) setEditingCharacterId(null)
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-100 bg-black/70" />
          <Dialog.Content className="fixed inset-8 z-101 flex flex-col rounded border border-white/15 bg-[#171717] p-5 outline-none">
            <Dialog.Title className="text-lg font-medium text-white">
              编辑 {editingCharacter?.name ?? '角色'} 的记忆
            </Dialog.Title>
            <textarea
              value={editingDraft}
              onChange={(event) => setEditingDraft(event.target.value)}
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
                  if (editingCharacterId) {
                    void saveMemoryAction.run(editingCharacterId, editingDraft)
                  }
                }}
                disabled={!editingCharacterId || saveMemoryAction.loading}
              >
                {saveMemoryAction.loading ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                {saveMemoryAction.loading ? '保存中...' : '保存'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}

/**
 * @description 把任意异常转换为可展示的错误消息。
 * @param cause 捕获到的异常值。
 * @returns 错误消息文本。
 */
function getErrorMessage(cause: unknown): string {
  return getIpcErrorMessage(cause)
}

type CharacterMemoryItemProps = {
  character: LocalCharacterEntry
  expanded: boolean
  // 长期记忆是否启用；关闭时记忆区显示关闭提示，状态卡区不受其影响
  memoryEnabled: boolean
  memory: string | undefined
  memoryError: string | undefined
  stateCards: CharacterSessionStateCardView[] | undefined
  stateCardsError: string | undefined
  onJumpToSession: (sessionId: string) => void
  onOpenChange: (characterId: string, open: boolean) => void
  onEdit: (characterId: string, content: string) => void
}

function CharacterMemoryItemImpl({
  character,
  expanded,
  memoryEnabled,
  memory,
  memoryError,
  stateCards,
  stateCardsError,
  onJumpToSession,
  onOpenChange,
  onEdit
}: CharacterMemoryItemProps): ReactElement {
  return (
    <CharacterAccordionCard
      name={character.name}
      avatar={character.avatar}
      open={expanded}
      onOpenChange={(nextOpen) => onOpenChange(character.id, nextOpen)}
    >
      {memoryEnabled ? (
        memoryError ? (
          <p className="text-sm text-red-300">记忆读取失败：{memoryError}</p>
        ) : memory === undefined ? (
          <p className="text-sm text-white/50">正在读取记忆...</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-white/85">记忆内容</div>
              <Button variant="primary" size="xs" onClick={() => onEdit(character.id, memory)}>
                <Pencil className="size-3.5" />
                编辑记忆
              </Button>
            </div>
            <pre className="max-h-72 min-h-24 overflow-auto rounded border border-white/10 bg-black/35 p-3 text-xs leading-5 break-words whitespace-pre-wrap text-white/75">
              {memory || '暂无记忆；记忆在历史压缩时自动提炼，也可在输入框输入 /压缩 手动触发。'}
            </pre>
          </>
        )
      ) : (
        <p className="text-sm text-white/45">记忆已关闭，开启后可查看与编辑记忆。</p>
      )}
      <div className="mt-3 flex flex-col gap-2">
        <div className="text-sm font-medium text-white/85">会话状态卡</div>
        {stateCardsError ? (
          <p className="text-sm text-red-300">状态卡读取失败：{stateCardsError}</p>
        ) : stateCards === undefined ? (
          <p className="text-sm text-white/50">正在读取状态卡...</p>
        ) : stateCards.length === 0 ? (
          <p className="text-sm text-white/45">暂无会话状态卡</p>
        ) : (
          stateCards.map((card) => (
            <div key={card.sessionId}>
              <div className="mb-1 flex min-w-0 items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => onJumpToSession(card.sessionId)}
                  className="min-w-0 max-w-md cursor-pointer truncate text-left text-xs font-medium text-[#e8c690] hover:text-[#ffdf9e] hover:underline"
                >
                  {card.sessionTitle}
                </button>
                {card.updatedAt && (
                  <span className="text-xs whitespace-nowrap text-white/35">
                    {new Date(card.updatedAt).toLocaleString()}
                  </span>
                )}
              </div>
              <pre className="max-h-48 overflow-auto rounded border bg-black/35 p-2 text-xs leading-5 whitespace-pre-wrap text-white/75">
                {card.content || '（该会话尚无状态卡内容）'}
              </pre>
            </div>
          ))
        )}
      </div>
    </CharacterAccordionCard>
  )
}

// 仅 expanded 与记忆内容变化时重渲染：回调 prop 为稳定引用，父级无关状态更新不波及列表
const CharacterMemoryItem = memo(CharacterMemoryItemImpl)
