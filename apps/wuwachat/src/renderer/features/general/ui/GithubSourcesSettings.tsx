import { useLayoutEffect, useRef, useState, type DragEvent, type ReactElement } from 'react'
import { gsap } from 'gsap'
import { Flip } from 'gsap/Flip'
import { GripVertical, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { type GithubProxySource } from '@gamechat/type'
import { GITHUB_DIRECT_SOURCE_ID } from '@gamechat/schema'
import { useMotionPreference } from '@renderer/app/hooks/useMotionPreference'
import { Input } from '@renderer/common/components/input'
import { SettingItem } from '@renderer/common/components/SettingItem'
import { cn } from '@renderer/common/lib/cn'
import { useAppSettingsStore } from '@renderer/store/app-settings'

gsap.registerPlugin(Flip)

const sourceRowButtonClassName =
  'flex size-7 items-center justify-center rounded-full text-gray-400 opacity-60 transition-colors hover:text-white hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:text-gray-400'

/** @description 来源行的外壳样式；行本身不铺底色，直接落在 SettingItem 条目壳的单层底色上，留白与条目壳内容对齐。 */
const sourceRowClassName = 'flex items-center gap-2 px-4 py-1'

/** @description 拖拽把手的样式，抓取光标由拖拽态切换。 */
const dragHandleClassName =
  'shrink-0 cursor-grab text-gray-400 opacity-60 transition-opacity hover:opacity-100 active:cursor-grabbing'

/**
 * @description 判断两份来源顺序是否等价。
 * @param left 待比较的来源列表。
 * @param right 待比较的来源列表。
 * @returns 长度相同且逐项标识一致时为 true。
 */
function sameSourceOrder(
  left: readonly GithubProxySource[],
  right: readonly GithubProxySource[]
): boolean {
  return (
    left.length === right.length && left.every((source, index) => source.id === right[index].id)
  )
}

/**
 * @description 构造自定义代理来源对象。
 * @param baseUrl 已校验并去除尾斜杠的代理地址。
 * @param hostname 代理地址的主机名；来源名称缺省时用作展示名。
 * @param rawLabel 用户输入的来源名称。
 * @returns 新来源对象。
 */
function createCustomSource(baseUrl: string, hostname: string, rawLabel: string): GithubProxySource {
  return {
    id: `custom-${globalThis.crypto.randomUUID()}`,
    label: rawLabel.trim() || hostname,
    baseUrl
  }
}

/**
 * @description 算出把被拖来源放到悬停行一侧之后的新顺序。
 * @param rows 当前展示的来源顺序，包含被拖来源。
 * @param draggingId 正在拖动的来源标识。
 * @param hoverId 指针所在行的来源标识。
 * @param insertAfterHover 指针位于悬停行下半区时为 true，表示插到该行之后。
 * @returns 发生变化时的新顺序；顺序不变、悬停行即被拖行或来源已不可定位时返回 null。
 * @remarks 先剔除被拖来源，再按悬停行在剩余列表中的下标插入，使同一位置反复触发 dragover 时结果稳定。
 */
function computeDragOverOrder(
  rows: readonly GithubProxySource[],
  draggingId: string,
  hoverId: string,
  insertAfterHover: boolean
): GithubProxySource[] | null {
  const dragged = rows.find((source) => source.id === draggingId)
  if (!dragged || draggingId === hoverId) {
    return null
  }
  const others = rows.filter((source) => source.id !== draggingId)
  const hoverIndex = others.findIndex((source) => source.id === hoverId)
  if (hoverIndex < 0) {
    return null
  }
  const next = [...others]
  next.splice(insertAfterHover ? hoverIndex + 1 : hoverIndex, 0, dragged)
  return sameSourceOrder(next, rows) ? null : next
}

/**
 * @description 把拖拽得到的顺序套用到提交时刻的来源列表上。
 * @param ordered 拖拽草稿中的来源顺序。
 * @param current 提交时刻设置里的来源列表。
 * @returns 按草稿顺序排列、且只包含当前仍存在的来源的列表；草稿未收录的来源追加在末尾。
 * @remarks 只按标识重排，拖拽期间来源被增删时不会把已删除的来源写回设置。
 */
function applyDraftOrder(
  ordered: readonly GithubProxySource[],
  current: readonly GithubProxySource[]
): GithubProxySource[] {
  const byId = new Map(current.map((source) => [source.id, source]))
  const result = ordered
    .map((source) => byId.get(source.id))
    .filter((source): source is GithubProxySource => source !== undefined)
  const placed = new Set(result.map((source) => source.id))
  for (const source of current) {
    if (!placed.has(source.id)) {
      result.push(source)
    }
  }
  return result
}

/**
 * @description 编辑 GitHub 来源链：支持按住把手拖动排序、删除代理来源与添加自定义代理。
 * @returns GitHub 来源顺序设置条目。
 */
export function GithubSourcesSettings(): ReactElement {
  const sources = useAppSettingsStore((state) => state.settings.githubProxy.sources)
  const setGithubProxySources = useAppSettingsStore((state) => state.setGithubProxySources)
  const { shouldAnimate } = useMotionPreference()
  const [labelDraft, setLabelDraft] = useState('')
  const [urlDraft, setUrlDraft] = useState('')
  const [dragDraft, setDragDraft] = useState<{ id: string; rows: GithubProxySource[] } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const flipStateRef = useRef<ReturnType<typeof Flip.getState> | null>(null)
  const animateNextLayoutRef = useRef(false)

  const rows = dragDraft ? dragDraft.rows : sources

  // 行元素按来源标识作 key，重排后 DOM 节点复用，Flip 才能拿到同一批元素的位移。
  useLayoutEffect(() => {
    const container = listRef.current
    if (!container) {
      return
    }
    const rowElements = container.querySelectorAll<HTMLElement>('[data-source-row]')
    if (rowElements.length === 0) {
      flipStateRef.current = null
      return
    }
    const previousState = flipStateRef.current
    if (previousState && animateNextLayoutRef.current && shouldAnimate) {
      Flip.from(previousState, { duration: 0.28, ease: 'power2.out' })
    }
    animateNextLayoutRef.current = false
    flipStateRef.current = Flip.getState(rowElements)
  })

  /**
   * @description 开始拖动一个来源：建立顺序草稿，并把拖拽快照指定为整行。
   * @param event 把手上的 dragstart 事件。
   * @param source 待拖动的来源。
   * @returns 无返回值；无法定位行元素时不做任何处理。
   * @remarks Chromium 需要写入 dataTransfer 才启动拖拽；基准位移在此刻采集，
   *   避免条目折叠期间的零尺寸行位置被当成下一次重排的起点。
   */
  function handleDragStart(event: DragEvent<HTMLSpanElement>, source: GithubProxySource): void {
    const row = event.currentTarget.closest<HTMLElement>('[data-source-row]')
    const container = listRef.current
    if (!row || !container) {
      return
    }
    const rect = row.getBoundingClientRect()
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', source.id)
    event.dataTransfer.setDragImage(row, event.clientX - rect.left, event.clientY - rect.top)
    flipStateRef.current = Flip.getState(
      container.querySelectorAll<HTMLElement>('[data-source-row]')
    )
    setDragDraft({ id: source.id, rows: [...sources] })
  }

  /**
   * @description 在被悬停的来源行上决定落位并更新顺序草稿。
   * @param event 行元素上的 dragover 事件。
   * @param hoverId 悬停行的来源标识。
   */
  function handleRowDragOver(event: DragEvent<HTMLDivElement>, hoverId: string): void {
    if (!dragDraft) {
      return
    }
    // 不阻止默认行为时浏览器视为非法放置目标，既不给放置光标也不触发 drop。
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    const next = computeDragOverOrder(
      dragDraft.rows,
      dragDraft.id,
      hoverId,
      event.clientY > rect.top + rect.height / 2
    )
    if (!next) {
      return
    }
    animateNextLayoutRef.current = true
    setDragDraft({ id: dragDraft.id, rows: next })
  }

  /**
   * @description 提交拖拽结果：按草稿顺序保存来源链并结束拖拽态。
   * @param event 行元素上的 drop 事件。
   */
  function handleRowDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault()
    commitDraftOrder()
    setDragDraft(null)
  }

  /**
   * @description 拖拽结束的统一收口：未落到行上（含放到列表外）时回滚草稿并让行滑回原位。
   */
  function handleDragEnd(): void {
    if (dragDraft) {
      animateNextLayoutRef.current = true
    }
    setDragDraft(null)
  }

  /**
   * @description 把顺序草稿映射到当前来源列表后提交，顺序未变时不发起保存。
   */
  function commitDraftOrder(): void {
    if (!dragDraft) {
      return
    }
    const ordered = applyDraftOrder(dragDraft.rows, sources)
    if (sameSourceOrder(ordered, sources)) {
      return
    }
    void setGithubProxySources(ordered)
  }

  /**
   * @description 删除一个代理来源。
   * @param id 待删除来源的标识。
   */
  function removeSource(id: string): void {
    void setGithubProxySources(sources.filter((source) => source.id !== id))
  }

  /**
   * @description 校验并添加一个自定义代理来源，插入直连之前。
   */
  function addCustomSource(): void {
    const trimmedUrl = urlDraft.trim()
    if (!trimmedUrl) {
      return
    }
    let parsed: URL
    try {
      parsed = new URL(trimmedUrl)
    } catch {
      toast.error('代理地址不是有效的 URL。')
      return
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      toast.error('代理地址必须以 http:// 或 https:// 开头。')
      return
    }
    const baseUrl = parsed.toString().replace(/\/+$/, '')
    if (sources.some((source) => source.baseUrl === baseUrl)) {
      toast.error('该代理地址已存在。')
      return
    }
    const custom = createCustomSource(baseUrl, parsed.hostname, labelDraft)
    const withoutDirect = sources.filter((source) => source.id !== GITHUB_DIRECT_SOURCE_ID)
    const direct = sources.find((source) => source.id === GITHUB_DIRECT_SOURCE_ID)
    setLabelDraft('')
    setUrlDraft('')
    void setGithubProxySources([...withoutDirect, custom, ...(direct ? [direct] : [])])
  }

  return (
    <SettingItem
      title="GitHub 来源顺序"
      expandedItems={[
        <p key="description" className="text-muted-foreground">
          按顺序请求以下来源获取角色、背景资料与应用更新的 GitHub
          资源，首个成功的来源生效，全部失败时提示逐来源原因。自定义代理需兼容 gh-proxy
          前缀格式（https://&lt;代理地址&gt;/&lt;原始GitHub地址&gt;）。
        </p>,
        <div key="sources" ref={listRef} className="-mx-4 -my-1 space-y-1">
          {/* 负 margin 抵掉 SettingItem 条目壳的内边距，让整条背景带都成为放置目标。 */}
          {rows.map((source) => {
            const isDragging = dragDraft?.id === source.id
            return (
              <div
                key={source.id}
                data-source-row
                onDragOver={(event) => handleRowDragOver(event, source.id)}
                onDrop={handleRowDrop}
                className={cn(sourceRowClassName, isDragging && 'opacity-40')}
              >
                <span
                  draggable
                  title="拖动排序"
                  onDragStart={(event) => handleDragStart(event, source)}
                  onDragEnd={handleDragEnd}
                  className={dragHandleClassName}
                >
                  <GripVertical size={15} />
                </span>
                <span className="text-md min-w-0 flex-1 truncate text-white/55">
                  {source.label}
                </span>
                {source.id !== GITHUB_DIRECT_SOURCE_ID && (
                  <button
                    type="button"
                    onClick={() => removeSource(source.id)}
                    disabled={isDragging}
                    className={sourceRowButtonClassName}
                    title="删除来源"
                    aria-label={`删除 ${source.label}`}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            )
          })}
        </div>,
        <div key="add" className="flex items-center gap-2 pt-1">
          <Input
            value={labelDraft}
            onChange={(event) => setLabelDraft(event.target.value)}
            placeholder="名称（可选）"
            aria-label="自定义代理名称"
            className="w-28 shrink-0"
          />
          <Input
            value={urlDraft}
            onChange={(event) => setUrlDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                addCustomSource()
              }
            }}
            placeholder="https://代理地址"
            aria-label="自定义代理地址"
            className="min-w-0 flex-1"
          />
          <button
            type="button"
            onClick={addCustomSource}
            className={sourceRowButtonClassName}
            title="添加自定义代理"
            aria-label="添加自定义代理"
          >
            <Plus size={16} />
          </button>
        </div>
      ]}
    />
  )
}
