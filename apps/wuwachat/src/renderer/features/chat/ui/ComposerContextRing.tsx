import { ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useGSAP } from '@gsap/react'
import { gsap } from 'gsap'
import { useMotionPreference } from '@renderer/app/hooks/useMotionPreference'
import { findProviderModel, useProvidersStore } from '@renderer/store/providers'
import { selectActiveSession, useSessionStore } from '@renderer/store/session'
import { Button } from '@renderer/common/components/button'
import { useModelSelectionStore } from '../store/model-selection'
import { cn } from '@renderer/common/lib/cn'
import { ComposerPopover } from './ComposerPopover'

gsap.registerPlugin(useGSAP)

/** 用量环半径（viewBox 28×28）。 */
const RING_RADIUS = 12
/** 用量环周长。 */
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

/** 穿越一二级面板间隙时延迟清空激活供应商的等待时长（毫秒）。 */
const HOVER_CLEAR_DELAY_MS = 120

/**
 * @description 计算用量环的填充比例与描边颜色。
 * @param inputTokens 实际输入 token 数；尚无可用统计时为 null。
 * @param contextWindow 模型上下文窗口容量，作为用量分母；无法确定时为 null。
 * @returns 填充比例（0-1，超限钳制为 1）与连续由绿过渡到红的描边色；无法计算时比例与颜色均为 null。
 */
function getRingVisual(
  inputTokens: number | null,
  contextWindow: number | null
): { ratio: number | null; stroke: string | null } {
  if (inputTokens === null || !contextWindow || contextWindow <= 0) {
    return { ratio: null, stroke: null }
  }
  const ratio = Math.min(inputTokens / contextWindow, 1)
  const hue = Math.round((1 - ratio) * 140)
  return { ratio, stroke: `hsl(${hue} 70% 45%)` }
}

/**
 * @description 把 token 数格式化为以 K/M 为最小单位的展示文本。
 * @param tokens token 数量。
 * @returns 百万位以上显示为一位小数的 M 值，千位以上显示为一位小数的 K 值，千位以下保留原值。
 */
function formatTokenCount(tokens: number): string {
  if (tokens < 1000) {
    return String(tokens)
  }
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`
  }
  return `${(tokens / 1000).toFixed(1)}K`
}

/**
 * @description 渲染输入框的模型与上下文用量融合按钮：模型图标叠加用量进度环，点击展开两级模型菜单。
 * @returns 融合按钮与两级模型菜单。
 */
export function ComposerContextRing(): ReactElement {
  const store = useProvidersStore((state) => state.store)
  const selectedModelId = useModelSelectionStore((state) => state.selectedModelId)
  const selectModel = useModelSelectionStore((state) => state.selectModel)
  const { shouldAnimate } = useMotionPreference()
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const hoverClearTimer = useRef<number | null>(null)
  const activeRowRef = useRef<HTMLDivElement | null>(null)
  const secondaryPanelRef = useRef<HTMLDivElement | null>(null)
  const secondaryListRef = useRef<HTMLDivElement | null>(null)

  const resolution = findProviderModel(store, selectedModelId)
  const selectableProviders = store.providers.filter((provider) => provider.models.length > 0)
  const sessionUsage = useSessionStore(selectActiveSession)?.contextUsage
  const currentUsage =
    sessionUsage && sessionUsage.status === 'available'
      ? {
          inputTokens: sessionUsage.inputTokens,
          ...(sessionUsage.cacheReadTokens !== undefined
            ? { cacheReadTokens: sessionUsage.cacheReadTokens }
            : {})
        }
      : null
  // 分母为窗口全量；主进程按预算比例截断输入，百分比接近该比例即临近截断。
  const contextWindow = resolution?.model.contextWindow ?? null
  const { ratio, stroke } = getRingVisual(
    currentUsage ? currentUsage.inputTokens : null,
    contextWindow
  )
  const percent =
    currentUsage && contextWindow
      ? `${((currentUsage.inputTokens / contextWindow) * 100).toFixed(1)}%`
      : '--'
  const cacheHitSuffix =
    currentUsage && currentUsage.cacheReadTokens !== undefined && currentUsage.inputTokens > 0
      ? ` · 缓存 ${Math.round((currentUsage.cacheReadTokens / currentUsage.inputTokens) * 100)}%`
      : ''

  // 卸载时清理悬停延迟计时器。
  useEffect(() => {
    return () => {
      if (hoverClearTimer.current !== null) {
        window.clearTimeout(hoverClearTimer.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!isPanelOpen) {
      return
    }
    const handlePointerDown = (event: PointerEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) {
        if (hoverClearTimer.current !== null) {
          window.clearTimeout(hoverClearTimer.current)
        }
        setActiveProviderId(null)
        setIsPanelOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [isPanelOpen])

  // 二级面板顶边对齐激活供应商行，列表高度钳制在行下方可视空间内；入场自左侧 8px 滑入淡入，
  // 随激活供应商切换重放。
  useGSAP(
    () => {
      const row = activeRowRef.current
      const panel = secondaryPanelRef.current
      const list = secondaryListRef.current
      if (!row || !panel || !list || !activeProviderId) {
        return
      }
      const available = window.innerHeight - row.getBoundingClientRect().bottom - 16
      list.style.maxHeight = `${Math.max(120, Math.min(256, available))}px`
      if (!shouldAnimate) {
        return
      }
      gsap.from(panel, {
        autoAlpha: 0,
        x: -8,
        duration: 0.15,
        ease: 'power2.out',
        overwrite: 'auto'
      })
    },
    { dependencies: [activeProviderId, shouldAnimate] }
  )

  /**
   * @description 关闭整个两级菜单并复位二级激活供应商。
   * @returns 无返回值。
   */
  function closePanel(): void {
    cancelHoverClear()
    setActiveProviderId(null)
    setIsPanelOpen(false)
  }

  /**
   * @description 延迟清空二级激活供应商，悬停从一级面板穿越间隙前往二级面板时菜单不闪关。
   * @returns 无返回值。
   */
  function scheduleHoverClear(): void {
    if (hoverClearTimer.current !== null) {
      window.clearTimeout(hoverClearTimer.current)
    }
    hoverClearTimer.current = window.setTimeout(
      () => setActiveProviderId(null),
      HOVER_CLEAR_DELAY_MS
    )
  }

  /**
   * @description 取消尚未生效的悬停清空计时。
   * @returns 无返回值。
   */
  function cancelHoverClear(): void {
    if (hoverClearTimer.current !== null) {
      window.clearTimeout(hoverClearTimer.current)
      hoverClearTimer.current = null
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => {
          cancelHoverClear()
          if (isPanelOpen) {
            setActiveProviderId(null)
          }
          setIsPanelOpen(!isPanelOpen)
        }}
        className="size-10 shrink-0 cursor-pointer rounded-xs aria-expanded:bg-gray-100"
        title="模型与上下文用量"
        aria-label="模型与上下文用量"
        aria-expanded={isPanelOpen}
      >
        <span className="relative flex size-7 items-center justify-center">
          <svg viewBox="0 0 28 28" className="absolute inset-0 size-full -rotate-90">
            <circle cx="14" cy="14" r={RING_RADIUS} fill="none" stroke="#e5e7eb" strokeWidth="2" />
            {ratio !== null && stroke && (
              <circle
                cx="14"
                cy="14"
                r={RING_RADIUS}
                fill="none"
                stroke={stroke}
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={`${ratio * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
                className={cn(shouldAnimate && 'transition-[stroke-dasharray] duration-500')}
              />
            )}
          </svg>
        </span>
      </Button>

      {isPanelOpen && (
        <div className="absolute bottom-12 left-0 z-20" onMouseLeave={scheduleHoverClear}>
          <ComposerPopover className="w-64 pb-1">
            {selectableProviders.length === 0 ? (
              <div className="px-3 py-3 text-xs text-gray-400">
                暂无可用模型，请在设置页添加供应商与模型。
              </div>
            ) : (
              selectableProviders.map((provider) => {
                const active = activeProviderId === provider.id
                const currentModel =
                  resolution?.provider.id === provider.id ? resolution.model : undefined
                return (
                  <div
                    key={provider.id}
                    ref={active ? activeRowRef : undefined}
                    className="relative"
                  >
                    <button
                      type="button"
                      aria-expanded={active}
                      onMouseEnter={() => {
                        cancelHoverClear()
                        setActiveProviderId(provider.id)
                      }}
                      onClick={() => {
                        cancelHoverClear()
                        setActiveProviderId(provider.id)
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-xs px-3 py-2 text-left text-sm text-[#333] transition-colors hover:bg-black/[0.04]',
                        active && 'bg-black/[0.05]'
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{provider.name}</span>
                      {currentModel && (
                        <span className="max-w-28 truncate text-xs text-gray-400">
                          {currentModel.model || '未命名模型'}
                        </span>
                      )}
                      <ChevronRight size={13} className="shrink-0 text-gray-400" />
                    </button>
                    {active && (
                      <div
                        ref={secondaryPanelRef}
                        className="absolute top-0 left-full z-30 ml-1.5"
                        onMouseEnter={cancelHoverClear}
                        onMouseLeave={scheduleHoverClear}
                      >
                        <ComposerPopover className="w-56">
                          <div ref={secondaryListRef} className="max-h-64 overflow-y-auto py-1">
                            {provider.models.map((model) => {
                              const selected = resolution?.model.id === model.id
                              return (
                                <button
                                  key={model.id}
                                  type="button"
                                  title={model.model}
                                  onClick={() => {
                                    selectModel(model.id)
                                    closePanel()
                                  }}
                                  className={cn(
                                    'flex w-full items-center rounded-xs px-3 py-1.5 text-left text-sm text-[#333] transition-colors hover:bg-black/[0.04]',
                                    selected && 'bg-black/[0.05]'
                                  )}
                                >
                                  <span className="min-w-0 truncate">
                                    {model.model || '未命名模型'}
                                  </span>
                                </button>
                              )
                            })}
                          </div>
                        </ComposerPopover>
                      </div>
                    )}
                  </div>
                )
              })
            )}
            <div className="mt-1 border-t border-black/5 px-3 py-2 text-xs whitespace-nowrap text-gray-500">
              {currentUsage && contextWindow
                ? `${formatTokenCount(currentUsage.inputTokens)} / ${formatTokenCount(contextWindow)} tokens · ${percent}${cacheHitSuffix}`
                : currentUsage
                  ? `${formatTokenCount(currentUsage.inputTokens)} tokens · 未配置窗口${cacheHitSuffix}`
                  : '--'}
            </div>
          </ComposerPopover>
        </div>
      )}
    </div>
  )
}
