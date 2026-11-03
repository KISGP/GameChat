import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import { List, useDynamicRowHeight, type RowComponentProps } from 'react-window'
import { Check, ChevronDown, ChevronRight, Copy, Search } from 'lucide-react'
import type { LogContext, LogEntry, LogViewerState } from '@gamechat/type'
import { trackError, trackUiEvent } from '@renderer/app/telemetry'
import { ConfirmActionModal } from '@renderer/common/components/ConfirmActionModal'
import { Card } from '@renderer/common/components/card'
import { Button } from '@renderer/common/components/button'
import { formatBytes } from '@renderer/common/lib/cn'
import { clearLogs, getViewerState, openFile, readLogs } from '@renderer/services/logs'

type LogRowModel = {
  // 条目在完整日志中的行号，按原始顺序计数，过滤后不重排
  lineNo: number
  // 日志条目本体
  entry: LogEntry
}

type RowData = {
  rows: LogRowModel[]
  // 已展开的日志条目集合，按条目对象引用追踪
  expandedEntries: Set<LogEntry>
  onCopy: (entry: LogEntry) => void
  onToggle: (entry: LogEntry) => void
  copiedEntry: LogEntry | null
}

type LogLevelFilter = LogEntry['level'] | 'all'

/** 各级别在行内渲染的小写严重级别词。 */
const SEVERITY_LABELS: Record<LogEntry['level'], string> = {
  error: 'error',
  warn: 'warning',
  info: 'info',
  debug: 'debug'
}

/** 各级别严重级别词与过滤 Tab 共用的文字颜色。 */
const SEVERITY_TEXT_CLASSES: Record<LogEntry['level'], string> = {
  error: 'text-red-400',
  warn: 'text-yellow-300',
  info: 'text-blue-400',
  debug: 'text-white/40'
}

const LOG_LEVEL_FILTERS: Array<{ value: LogLevelFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'error', label: '错误' },
  { value: 'warn', label: '警告' },
  { value: 'info', label: '信息' },
  { value: 'debug', label: '调试' }
]

/** 日志行折叠时的行高，作为动态行高的默认值。 */
const LOG_ROW_HEIGHT = 30

/**
 * @description 返回日志级别对应的小写严重级别词。
 * @param level 日志级别。
 * @returns 级别词文本。
 */
function getSeverityLabel(level: LogEntry['level']): string {
  return SEVERITY_LABELS[level]
}

/**
 * @description 返回级别对应的文字颜色类名。
 * @param level 日志级别。
 * @returns 对应的 Tailwind 文字颜色类名。
 */
function getSeverityTextClass(level: LogEntry['level']): string {
  return SEVERITY_TEXT_CLASSES[level]
}

/**
 * @description 按编辑器诊断行样式返回日志行的底色、左缘标记与基础文字颜色。
 * @param entry 待判断样式的日志条目。
 * @returns 对应的 Tailwind 类名。
 */
function getLogRowClass(entry: LogEntry): string {
  if (entry.rawLine) {
    return 'border-l-yellow-400/60 bg-yellow-500/6 text-yellow-100/75'
  }

  if (entry.level === 'error') {
    return 'border-l-red-400/70 bg-red-500/8 text-white/85'
  }

  if (entry.level === 'warn') {
    return 'border-l-yellow-400/60 bg-yellow-500/6 text-white/85'
  }

  return 'border-l-transparent text-white/75'
}

/**
 * @description 将日志时间戳格式化为行内展示的短时间文本。
 * @param timestamp ISO 时间字符串。
 * @returns 本地化时分秒文本；无法解析时回退为原始文本，空值回退为占位符。
 */
function formatLogTime(timestamp: string): string {
  if (!timestamp) {
    return '—'
  }

  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) {
    return timestamp
  }

  return date.toLocaleTimeString()
}

/**
 * @description 将更新时间 ISO 字符串格式化为本地时间文本。
 * @param value ISO 时间字符串。
 * @returns 本地化时间文本；无法解析时回退为原始字符串。
 */
function formatUpdatedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString()
}

/**
 * @description 判断日志条目是否命中搜索词。
 * @param entry 待匹配的日志条目。
 * @param query 已转小写的搜索词，空串视为全部命中。
 * @returns 消息、来源、事件或原始行包含搜索词时为 true。
 */
function matchEntry(entry: LogEntry, query: string): boolean {
  if (!query) {
    return true
  }

  const haystack =
    `${entry.message} ${entry.source} ${entry.event} ${entry.rawLine ?? ''}`.toLowerCase()
  return haystack.includes(query)
}

/**
 * @description 将上下文值渲染为分色 JSON 片段，字符串、基础类型与其余类型各自着色。
 * @param value 上下文中的单个值。
 * @returns 对应的 JSON 片段节点。
 */
function renderContextValue(value: unknown): ReactNode {
  if (typeof value === 'string') {
    return <span className="text-orange-300/80">&quot;{value}&quot;</span>
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return <span className="text-green-300/80">{String(value)}</span>
  }

  return <span className="text-white/45">{JSON.stringify(value)}</span>
}

/**
 * @description 将日志上下文对象渲染为单行语法高亮 JSON。
 * @param context 已脱敏的日志上下文对象。
 * @returns 单行高亮 JSON 节点。
 */
function renderContextJson(context: LogContext): ReactNode {
  const entries = Object.entries(context)
  if (entries.length === 0) {
    return <span className="text-white/40">{'{}'}</span>
  }

  return (
    <span className="text-white/40">
      {'{ '}
      {entries.map(([key, value], index) => (
        <span key={key}>
          <span className="text-teal-300/90">&quot;{key}&quot;</span>
          {': '}
          {renderContextValue(value)}
          {index < entries.length - 1 ? ', ' : ''}
        </span>
      ))}
      {' }'}
    </span>
  )
}

/**
 * @description 将日志上下文对象渲染为多行语法高亮 JSON 文本块，供展开详情使用。
 * @param context 已脱敏的日志上下文对象。
 * @returns 多行高亮 JSON 节点。
 */
function renderContextBlock(context: LogContext): ReactNode {
  const entries = Object.entries(context)
  if (entries.length === 0) {
    return <span className="text-white/40">{'{}'}</span>
  }

  return (
    <span className="text-white/40">
      {'{'}
      {entries.map(([key, value], index) => (
        <span key={key} className="block pl-4">
          <span className="text-teal-300/90">&quot;{key}&quot;</span>
          {': '}
          {renderContextValue(value)}
          {index < entries.length - 1 ? ',' : ''}
        </span>
      ))}
      {'}'}
    </span>
  )
}

/**
 * @description 将单条日志格式化为适合复制的完整文本。
 * @param entry 需要复制的日志条目。
 * @returns 包含日志级别、元数据与详情的单行文本。
 */
function formatLogEntryForCopy(entry: LogEntry): string {
  if (entry.rawLine) {
    return `WARN ${entry.rawLine}`
  }

  const context =
    entry.context && Object.keys(entry.context).length > 0
      ? ` ${JSON.stringify(entry.context)}`
      : ''

  return [
    entry.level.toUpperCase(),
    `${new Date(entry.timestamp).toLocaleString()} ${entry.source}:${entry.event}`,
    `${entry.message}${context}`
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * @description 渲染虚拟化日志列表中的单条日志行，点击行头可展开完整消息与上下文详情。
 */
function LogRow({
  index,
  style,
  rows,
  expandedEntries,
  onCopy,
  onToggle,
  copiedEntry
}: RowComponentProps<RowData>): ReactElement {
  const { entry, lineNo } = rows[index]
  const isRawLine = Boolean(entry.rawLine)
  const level = isRawLine ? 'warn' : entry.level
  const messageText = isRawLine ? entry.rawLine : entry.message
  const contextJson = !isRawLine && entry.context ? renderContextJson(entry.context) : null
  const fullText = [messageText, entry.context ? JSON.stringify(entry.context) : '']
    .filter(Boolean)
    .join(' ')
  const isExpanded = expandedEntries.has(entry)
  const isCopied = entry === copiedEntry
  const copyLabel = isCopied ? '已复制日志' : '复制日志'
  const Chevron = isExpanded ? ChevronDown : ChevronRight

  return (
    <div
      style={style}
      className={`group relative flex flex-col border-l-2 font-mono text-xs leading-5 ${getLogRowClass(entry)}`}
    >
      <div
        className="flex h-7.5 shrink-0 cursor-pointer items-center gap-3 px-4"
        onClick={() => onToggle(entry)}
      >
        <Chevron className="size-3 shrink-0 text-white/35" />
        <span className="group-hover:text-primary/70 w-9 shrink-0 text-right text-white/20 select-none">
          {lineNo}
        </span>
        <span
          className="w-36 shrink-0 truncate text-white/45"
          title={isRawLine ? undefined : entry.timestamp}
        >
          {isRawLine ? '—' : `${formatLogTime(entry.timestamp)} · ${entry.source}`}
        </span>
        <span className="min-w-0 flex-1 truncate" title={fullText}>
          {messageText}
          {contextJson}
        </span>
      </div>
      {isExpanded && (
        <div className="flex flex-col gap-1.5 bg-black/25 px-4 pt-1 pb-2">
          <div className="flex shrink-0 items-center justify-between gap-2 text-white/45">
            <span className="min-w-0 truncate">
              <span className={getSeverityTextClass(level)}>{getSeverityLabel(level)}</span>
              {!isRawLine && <span>{` · ${entry.event}`}</span>}
              {!isRawLine && <span>{` · ${entry.timestamp}`}</span>}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => onCopy(entry)}
              className={`shrink-0 ${
                isCopied ? 'text-green-400 hover:text-green-300' : 'text-white/65 hover:text-white'
              }`}
              title={copyLabel}
              aria-label={copyLabel}
            >
              {isCopied ? (
                <Check className="size-3.5" strokeWidth={2.5} />
              ) : (
                <Copy className="size-3.5" />
              )}
            </Button>
          </div>
          <div className="shrink-0 break-all whitespace-pre-wrap text-white/80 select-text cursor-text">
            {messageText}
          </div>
          {entry.context && Object.keys(entry.context).length > 0 && (
            <div className="break-all whitespace-pre-wrap select-text cursor-text">
              {renderContextBlock(entry.context)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function LogTab(): ReactElement {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [viewerState, setViewerState] = useState<LogViewerState | null>(null)
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState(false)
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [levelFilter, setLevelFilter] = useState<LogLevelFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [copiedEntry, setCopiedEntry] = useState<LogEntry | null>(null)
  const [expandedEntries, setExpandedEntries] = useState<Set<LogEntry>>(() => new Set())
  const copyResetTimerRef = useRef<number | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const dynamicRowHeight = useDynamicRowHeight({ defaultRowHeight: LOG_ROW_HEIGHT })

  const levelCounts = useMemo(() => {
    const counts: Record<LogEntry['level'], number> = { error: 0, warn: 0, info: 0, debug: 0 }
    entries.forEach((entry) => {
      counts[entry.level] += 1
    })
    return counts
  }, [entries])

  const visibleRows = useMemo<LogRowModel[]>(() => {
    const query = searchQuery.trim().toLowerCase()
    return entries
      .map((entry, index) => ({ entry, lineNo: index + 1 }))
      .filter(
        ({ entry }) =>
          (levelFilter === 'all' || entry.level === levelFilter) && matchEntry(entry, query)
      )
  }, [entries, levelFilter, searchQuery])

  /**
   * @description 将选中的日志条目写入系统剪贴板。
   * @param entry 用户请求复制的日志条目。
   * @remarks 剪贴板访问失败时记录错误，避免用户操作静默失败。
   */
  const handleCopyLog = useCallback((entry: LogEntry): void => {
    void navigator.clipboard
      .writeText(formatLogEntryForCopy(entry))
      .then(() => {
        setCopiedEntry(entry)

        if (copyResetTimerRef.current !== null) {
          window.clearTimeout(copyResetTimerRef.current)
        }

        copyResetTimerRef.current = window.setTimeout(() => {
          setCopiedEntry(null)
          copyResetTimerRef.current = null
        }, 1600)
      })
      .catch((error: unknown) => {
        trackError('copy-log-failed', 'Failed to copy log entry:', error)
      })
  }, [])

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    // 按 / 聚焦搜索框；焦点已在可编辑控件内时不拦截按键
    const handleKeyDown = (event: KeyboardEvent): void => {
      const target = document.activeElement
      const isTyping =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

      if (event.key === '/' && !isTyping) {
        event.preventDefault()
        searchInputRef.current?.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  /**
   * @description 切换单条日志的展开状态。
   * @param entry 目标日志条目。
   * @remarks 以条目对象引用追踪展开集合；重新读取日志后引用变化，展开状态自然重置。
   */
  const handleToggleLogExpand = useCallback((entry: LogEntry): void => {
    setExpandedEntries((current) => {
      const next = new Set(current)
      if (next.has(entry)) {
        next.delete(entry)
      } else {
        next.add(entry)
      }
      return next
    })
  }, [])

  /**
   * @description 读取日志元数据与日志列表，并同步更新日志页展示状态。
   * @remarks 该函数会重置加载态与错误信息；失败时保留已有列表内容，仅更新错误提示。
   */
  const refreshLogs = async (): Promise<void> => {
    try {
      setLoading(true)
      setErrorMessage('')
      const [nextViewerState, nextEntries] = await Promise.all([getViewerState(), readLogs()])
      setViewerState(nextViewerState)
      setEntries(nextEntries)
    } catch (error) {
      trackError('fetch-logs-failed', 'Failed to fetch logs:', error)
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refreshLogs()
    }, 0)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [])

  /**
   * @description 用系统默认文本编辑器打开当前日志文件。
   * @remarks 打开失败时记录埋点，避免用户点击后静默失败。
   */
  const handleOpenLogFile = (): void => {
    trackUiEvent('log-file-open', 'User opened the log file from the log tab')
    openFile().catch((error: unknown) => {
      trackError('open-log-file-failed', 'Failed to open log file:', error)
    })
  }

  /**
   * @description 打开清空日志确认弹层，避免使用原生同步确认框影响窗口命中状态。
   */
  const handleOpenClearConfirm = (): void => {
    setIsConfirmOpen(true)
  }

  /**
   * @description 关闭清空日志确认弹层。
   * @remarks 日志正在清空时不允许关闭，避免界面状态与实际执行状态不一致。
   */
  const handleCloseClearConfirm = (): void => {
    if (clearing) {
      return
    }

    setIsConfirmOpen(false)
  }

  /**
   * @description 清空当前日志文件并刷新日志页内容。
   * @remarks 成功后关闭确认弹层；失败时保留弹层并展示错误信息，防止误判执行结果。
   */
  const handleClearLogs = async (): Promise<void> => {
    try {
      setClearing(true)
      setErrorMessage('')
      trackUiEvent('log-clear', 'User cleared log entries from the log tab')
      await clearLogs()
      await refreshLogs()
      setIsConfirmOpen(false)
    } catch (error) {
      trackError('clear-logs-failed', 'Failed to clear logs:', error)
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setClearing(false)
    }
  }

  return (
    <>
      <div className="h-full px-4 pb-4">
        <div className="mx-auto flex h-full max-w-6xl flex-col">
          <Card className="min-h-0 flex-1">
            <div className="flex shrink-0 items-center gap-2.5 border-b border-white/8 px-4 py-2.5 text-xs text-white/45">
              {viewerState ? (
                <>
                  <Button
                    variant="link"
                    onClick={handleOpenLogFile}
                    title={viewerState.filePath}
                    className="h-auto min-w-0 truncate p-0 text-left font-mono text-xs font-normal text-white/60 hover:text-white/90"
                  >
                    {viewerState.filePath}
                  </Button>
                  <span className="shrink-0 font-mono">· {formatBytes(viewerState.sizeBytes)}</span>
                  {viewerState.updatedAt && (
                    <span className="hidden shrink-0 font-mono lg:inline">
                      · 更新 {formatUpdatedAt(viewerState.updatedAt)}
                    </span>
                  )}
                  <span className="min-w-4 flex-1" />
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={handleOpenClearConfirm}
                    disabled={loading || clearing}
                  >
                    清空日志
                  </Button>
                  <Button
                    variant="quiet"
                    size="sm"
                    onClick={() => void refreshLogs()}
                    disabled={loading || clearing}
                    className="border-transparent bg-white/10 text-white hover:bg-white/20"
                  >
                    {loading ? '刷新中...' : '刷新'}
                  </Button>
                </>
              ) : (
                <span>{loading ? '正在读取日志元数据...' : '暂无日志元数据'}</span>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-3 border-b border-white/8 bg-black/20 px-3 py-2">
              <label className="focus-within:border-primary/50 flex h-8 w-full max-w-88 min-w-0 items-center gap-2 rounded border border-white/10 bg-black/30 px-2.5 transition-colors">
                <Search className="size-3.5 shrink-0 text-white/40" />
                <input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setSearchQuery('')
                      event.currentTarget.blur()
                    }
                  }}
                  placeholder="筛选消息、来源或事件…"
                  spellCheck={false}
                  autoComplete="off"
                  className="min-w-0 flex-1 bg-transparent font-mono text-xs text-white/90 outline-none placeholder:text-white/30"
                />
                <kbd className="shrink-0 rounded border border-white/12 px-1.5 py-px font-mono text-[10px] text-white/35">
                  /
                </kbd>
              </label>
              <div className="ml-auto flex shrink-0 items-center gap-1">
                {LOG_LEVEL_FILTERS.map((filter) => {
                  const isActive = levelFilter === filter.value
                  const count = filter.value === 'all' ? entries.length : levelCounts[filter.value]

                  return (
                    <button
                      key={filter.value}
                      type="button"
                      onClick={() => setLevelFilter(filter.value)}
                      className={`rounded px-2.5 py-1 font-mono text-xs transition-colors ${
                        isActive
                          ? filter.value === 'all'
                            ? 'bg-[#e8c690]/20 text-[#f7d9a6]'
                            : `bg-white/10 ${getSeverityTextClass(filter.value)}`
                          : 'text-white/45 hover:bg-white/8 hover:text-white/75'
                      }`}
                    >
                      {filter.label}
                      <span className="ml-1.5 text-[10px] opacity-70">{count}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              {errorMessage ? (
                <div className="p-4 font-sans text-sm text-red-300">
                  Failed to read logs: {errorMessage}
                </div>
              ) : visibleRows.length === 0 && !loading ? (
                <div className="p-4 font-sans text-sm text-white/50">
                  {entries.length === 0 ? 'No logs yet' : '没有匹配的日志条目'}
                </div>
              ) : (
                <List
                  rowComponent={LogRow}
                  rowCount={visibleRows.length}
                  rowHeight={dynamicRowHeight}
                  rowProps={{
                    rows: visibleRows,
                    expandedEntries,
                    onCopy: handleCopyLog,
                    onToggle: handleToggleLogExpand,
                    copiedEntry
                  }}
                />
              )}
            </div>
          </Card>
        </div>
      </div>

      {isConfirmOpen && (
        <ConfirmActionModal
          title="清空日志"
          description="确认是否清空当前日志文件？该操作会移除日志页当前可见的日志内容。"
          confirmLabel={clearing ? '清空中...' : '确认清空'}
          confirmDisabled={clearing}
          cancelDisabled={clearing}
          onCancel={handleCloseClearConfirm}
          onConfirm={() => void handleClearLogs()}
        />
      )}
    </>
  )
}
