import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { toast } from 'sonner'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { StorageCategoryId, StorageLocationTarget, StorageUsageItem, StorageUsageSnapshot } from '@gamechat/type'

/** @description 各存储分类在饼图与明细中的展示颜色，随分类定义由界面层持有。 */
const STORAGE_CATEGORY_COLORS: Record<StorageCategoryId, string> = {
  sessions: '#e8c690',
  characters: '#77d6ff',
  world: '#c69cff',
  logs: '#ff7aa8',
  settings: '#7adbc4',
  cache: '#ffd36a',
  other: '#a9b2c3'
}
import { Card } from '@renderer/common/components/card'
import { Spinner } from '@renderer/common/components/spinner'
import { Button } from '@renderer/common/components/button'
import { formatBytes } from '@renderer/common/lib/cn'
import { getUsage, openLocation } from '@renderer/services/storage'
import { trackError } from '@renderer/app/telemetry'
import { getIpcErrorMessage } from '@renderer/common/lib/error-message'

type ChartDatum = StorageUsageItem & {
  value: number
}

/**
 * @description 格式化存储扫描时间，缺失或异常值会回退为原始字符串。
 * @param value ISO 时间字符串。
 * @returns 本地化后的时间文本。
 */
function formatScannedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString()
}

/**
 * @description 计算分类在总占用中的百分比文案。
 * @param sizeBytes 分类字节数。
 * @param totalBytes 总字节数。
 * @returns 百分比文本。
 */
function formatPercent(sizeBytes: number, totalBytes: number): string {
  if (totalBytes <= 0) {
    return '0%'
  }

  return `${((sizeBytes / totalBytes) * 100).toFixed(1)}%`
}

/**
 * @description 渲染 Recharts Tooltip 中的存储分类信息。
 * @param props Recharts Tooltip 回调属性。
 * @returns Tooltip 节点。
 */
function StorageTooltip({
  active,
  payload
}: {
  active?: boolean
  payload?: Array<{ payload: ChartDatum }>
}): ReactElement | null {
  if (!active || !payload?.[0]) {
    return null
  }

  const item = payload[0].payload

  return (
    <div className="rounded border border-white/10 bg-black/85 px-3 py-2 text-xs text-white shadow-xl">
      <div className="font-medium">{item.label}</div>
      <div className="mt-1 text-white/65">{formatBytes(item.sizeBytes)}</div>
    </div>
  )
}

type StoragePathLinkProps = {
  // 路径行前缀标签
  label: string
  // 展示并可点击打开的完整路径
  path: string
  // 主进程解析目录用的目标枚举
  target: StorageLocationTarget
  // 点击路径后的打开回调
  onOpen: (target: StorageLocationTarget) => Promise<void>
}

/**
 * @description 以链接样式渲染一行存储路径，点击路径即在系统资源管理器中打开对应目录。
 * @remarks 悬停通过 title 展示完整路径；路径过长时截断，不把溢出文本暴露给布局。
 */
function StoragePathLink({ label, path, target, onOpen }: StoragePathLinkProps): ReactElement {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <span className="shrink-0">{label}: </span>
      <Button
        variant="link"
        onClick={() => void onOpen(target)}
        title={path}
        className="h-auto min-w-0 truncate p-0 text-left text-sm font-normal"
      >
        {path}
      </Button>
    </div>
  )
}

/**
 * @description 渲染应用数据目录的存储占用分析页。
 * @returns 设置页存储分析 Tab 内容。
 */
export function StorageTab(): ReactElement {
  const [snapshot, setSnapshot] = useState<StorageUsageSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [removedCategoryIds, setRemovedCategoryIds] = useState<string[]>([])

  const chartData = useMemo<ChartDatum[]>(
    () =>
      snapshot
        ? snapshot.items
            .filter((item) => item.sizeBytes > 0 && !removedCategoryIds.includes(item.id))
            .map((item) => ({
              ...item,
              value: item.sizeBytes
            }))
        : [],
    [removedCategoryIds, snapshot]
  )

  /**
   * @description 切换存储分类在分析结果中的移除状态。
   * @param categoryId 被点击的分类 id。
   */
  const toggleCategoryRemoval = (categoryId: string): void => {
    setRemovedCategoryIds((current) =>
      current.includes(categoryId)
        ? current.filter((removedCategoryId) => removedCategoryId !== categoryId)
        : [...current, categoryId]
    )
  }

  /**
   * @description 读取应用数据目录的存储占用快照，可选强制重新扫描。
   * @param refresh 为 true 时绕过主进程缓存重新扫描，用于页面内的手动刷新按钮。
   * @remarks 失败时保留已有快照并经 toast 提示；页面挂载时读取缓存快照即可。
   */
  const refreshStorageUsage = async (refresh = false): Promise<void> => {
    try {
      setLoading(true)
      const nextSnapshot = await getUsage(refresh)
      setSnapshot(nextSnapshot)
    } catch (error) {
      trackError('fetch-storage-usage-failed', 'Failed to fetch storage usage:', error)
      toast.error(getIpcErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  /**
   * @description 请求主进程打开存储页指定目录位置，失败时记录埋点并经 toast 提示。
   * @param target 目录位置目标。
   */
  const handleOpenLocation = async (target: StorageLocationTarget): Promise<void> => {
    try {
      await openLocation(target)
    } catch (error) {
      trackError('open-storage-location-failed', 'Failed to open storage location:', error)
      toast.error(getIpcErrorMessage(error))
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refreshStorageUsage()
    }, 0)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [])

  return (
    <div className="h-full overflow-y-auto px-4">
      <div className="mx-auto flex h-full max-w-6xl flex-col gap-4 pb-6">
        <Card className="relative w-full px-4 py-3 text-xs text-white/55">
          {snapshot ? (
            <div className="pr-24">
              <div className="flex flex-col gap-1.5">
                <StoragePathLink
                  label="User Data"
                  path={snapshot.userDataPath}
                  target="user-data"
                  onOpen={handleOpenLocation}
                />
                <StoragePathLink
                  label="Install"
                  path={snapshot.installPath}
                  target="install"
                  onOpen={handleOpenLocation}
                />
              </div>
              <div className="mt-2">
                Total: {formatBytes(snapshot.totalBytes)} | Scanned:{' '}
                {formatScannedAt(snapshot.scannedAt)}
              </div>
            </div>
          ) : (
            '正在读取应用存储占用...'
          )}

          <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-2">
            <Button
              variant="quiet"
              size="lg"
              onClick={() => void refreshStorageUsage(true)}
              disabled={loading}
              className="border-transparent bg-white/10 text-white hover:bg-white/20"
            >
              {loading ? '刷新中...' : '刷新'}
            </Button>
          </div>
        </Card>

        <div className="flex min-h-112 flex-1 flex-row gap-4">
          <Card className="min-h-80 flex-1 p-4">
            {loading && !snapshot ? (
              <div className="flex h-full min-h-80 items-center justify-center text-[#e8c690]">
                <Spinner className="mr-2" />
                <span className="text-sm">正在分析存储占用...</span>
              </div>
            ) : chartData.length === 0 ? (
              <div className="flex h-full min-h-80 items-center justify-center text-sm text-white/50">
                暂无应用数据占用
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%" minHeight={320}>
                <PieChart>
                  <Pie
                    data={chartData}
                    dataKey="value"
                    nameKey="label"
                    innerRadius="58%"
                    outerRadius="82%"
                    paddingAngle={2}
                    stroke="rgba(255,255,255,0.08)"
                    strokeWidth={1}
                  >
                    {chartData.map((item) => (
                      <Cell
                        key={item.id}
                        fill={STORAGE_CATEGORY_COLORS[item.id]}
                        className="cursor-pointer outline-none"
                        onClick={() => toggleCategoryRemoval(item.id)}
                      />
                    ))}
                  </Pie>
                  <Tooltip content={<StorageTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Card className="p-4">
            <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-baseline justify-between gap-3 lg:justify-start">
                <h3 className="text-sm font-medium text-white/90">分类明细</h3>
                <span className="text-xs text-white/50">
                  {snapshot ? snapshot.items.length : '--'}
                </span>
                {removedCategoryIds.length > 0 && (
                  <Button
                    variant="quiet"
                    size="xs"
                    onClick={() => setRemovedCategoryIds([])}
                    className="border-transparent bg-white/10 text-white/70 hover:bg-white/20"
                  >
                    恢复全部
                  </Button>
                )}
              </div>
            </div>

            {(snapshot?.items.length ?? 0) === 0 ? (
              <div className="rounded border border-white/6 bg-white/4 px-3 py-6 text-center text-sm text-white/45">
                暂无存储分类
              </div>
            ) : (
              <div className="flex flex-col gap-2 overflow-y-auto">
                {(snapshot?.items ?? []).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleCategoryRemoval(item.id)}
                    className={`rounded border border-white/6 bg-white/4 px-3 py-2 text-left transition-all hover:border-red-300/50 hover:bg-red-500/8 ${
                      removedCategoryIds.includes(item.id) ? 'opacity-35' : 'opacity-100'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: STORAGE_CATEGORY_COLORS[item.id] }}
                        />
                        <span className="truncate text-sm text-white/85">{item.label}</span>
                        {removedCategoryIds.includes(item.id) && (
                          <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">
                            已隐藏
                          </span>
                        )}
                      </div>
                      <div className="shrink-0 text-xs text-white/65">
                        {formatBytes(item.sizeBytes)}
                      </div>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-white/40">
                      <span className="truncate">{item.description}</span>
                      <span className="shrink-0">
                        {snapshot ? formatPercent(item.sizeBytes, snapshot.totalBytes) : '0%'}
                      </span>
                    </div>
                    <div className="mt-1 truncate text-[11px] text-white/30">{item.path}</div>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
