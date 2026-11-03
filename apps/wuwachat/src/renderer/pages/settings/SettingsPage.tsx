import { lazy, Suspense, type ReactElement, useEffect, useRef, useState } from 'react'
import { useGSAP } from '@gsap/react'
import { gsap } from 'gsap'
import CloseIcon from '@renderer/app/components/Close'
import { LogTab } from '@renderer/features/logs/ui/LogSettings'
import { ModelTab } from '@renderer/features/model/ui/ModelSettings'
import { ToolsTab } from '@renderer/features/tools/ui/ToolsTab'
import {
  Bot,
  Workflow,
  Brain,
  Wrench,
  HardDrive,
  PanelLeftClose,
  PanelLeftOpen,
  SlidersHorizontal,
  UserRound,
  Volume2,
  RotateCcw,
  ClipboardList,
  BookOpen,
  ExternalLink,
  Route,
  type LucideIcon
} from 'lucide-react'
import { AgentTab } from '@renderer/features/agent/ui/AgentSettings'
import { cn } from '@renderer/common/lib/cn'
import { Spinner } from '@renderer/common/components/spinner'
import { Button } from '@renderer/common/components/button'
import { GeneralTab } from '@renderer/features/general/ui/GeneralSettings'
import { TtsTab } from '@renderer/features/tts/ui/TTS'
import { useAppSettingsStore } from '@renderer/store/app-settings'
import { useMotionPreference } from '@renderer/app/hooks/useMotionPreference'
import { useProvidersStore } from '@renderer/store/providers'

gsap.registerPlugin(useGSAP)

const MemoryTab = lazy(() =>
  import('@renderer/features/memory/ui/MemorySettings').then((module) => ({
    default: module.MemoryTab
  }))
)
const CharacterTab = lazy(() =>
  import('@renderer/features/character/ui/CharacterSettings').then((module) => ({
    default: module.CharacterTab
  }))
)
const StorageTab = lazy(() =>
  import('@renderer/features/storage/ui/StorageSettings').then((module) => ({
    default: module.StorageTab
  }))
)
const TraceTab = lazy(() =>
  import('@renderer/features/trace/ui/TraceSettings').then((module) => ({
    default: module.TraceSettingsTab
  }))
)
const WorldTab = lazy(() =>
  import('@renderer/features/world/ui/WorldSettings').then((module) => ({
    default: module.WorldTab
  }))
)
const FlowsTab = lazy(() =>
  import('@renderer/features/flows/ui/FlowsTab').then((module) => ({
    default: module.FlowsTab
  }))
)

type SettingsTabId =
  | 'general'
  | 'tts'
  | 'model'
  | 'memory'
  | 'character'
  | 'storage'
  | 'log'
  | 'tools'
  | 'agent'
  | 'trace'
  | 'world'
  | 'flows'

type SettingsTabDefinition = {
  id: SettingsTabId
  label: string
  icon: LucideIcon
}

const SETTINGS_TABS: readonly SettingsTabDefinition[] = [
  { id: 'general', label: '通用', icon: SlidersHorizontal },
  { id: 'model', label: '模型', icon: Bot },
  { id: 'character', label: '角色', icon: UserRound },
  { id: 'agent', label: '工具', icon: Workflow },
  { id: 'flows', label: '流程', icon: Route },
  { id: 'memory', label: '记忆', icon: Brain },
  { id: 'world', label: '资料', icon: BookOpen },
  { id: 'tts', label: '语音', icon: Volume2 },
  { id: 'storage', label: '存储', icon: HardDrive },
  { id: 'log', label: '日志', icon: ClipboardList },
  { id: 'tools', label: '抽卡链接', icon: Wrench },
  { id: 'trace', label: 'Langfuse', icon: ExternalLink }
]

// Langfuse 仅开发环境可用：观测 SDK 位于 devDependencies，不会被打进正式安装包，
// 因此正式构建不展示该配置入口。
const VISIBLE_SETTINGS_TABS: readonly SettingsTabDefinition[] = import.meta.env.DEV
  ? SETTINGS_TABS
  : SETTINGS_TABS.filter((tab) => tab.id !== 'trace')

/**
 * @description 渲染设置页懒加载期间的加载指示器。
 * @returns 居中显示的加载指示器。
 */
function TabLoadingFallback(): ReactElement {
  return (
    <div className="flex h-full items-center justify-center text-[#e8c690]">
      <Spinner className="mr-2" />
    </div>
  )
}

/**
 * @description 渲染设置覆盖层、可切换的设置页以及可展开的侧边导航栏。
 * @param props 组件 props。
 * @returns 设置覆盖层内容。
 */
export default function SettingsPage({
  onClose,
  onOpenQuickStart
}: {
  onClose: () => void
  /** 请求在设置层之上打开首启引导向导的回调。 */
  onOpenQuickStart: () => void
}): ReactElement {
  const { shouldAnimate } = useMotionPreference()
  const [activeTab, setActiveTab] = useState<SettingsTabId>(SETTINGS_TABS[0].id)
  // 动画禁用时跳过分帧入场，骨架与内容以就绪态直接初始化。
  const [mounted, setMounted] = useState(!shouldAnimate)
  const [contentReady, setContentReady] = useState(!shouldAnimate)
  const sidebarRef = useRef<HTMLElement>(null)
  const isSidebarExpanded = useAppSettingsStore((state) => state.settings.settingsSidebarExpanded)
  const setSettingsSidebarExpanded = useAppSettingsStore(
    (state) => state.setSettingsSidebarExpanded
  )
  const previousExpandedRef = useRef(isSidebarExpanded)
  const appSaveError = useAppSettingsStore((state) => state.saveError)
  const retryAppSave = useAppSettingsStore((state) => state.retrySave)
  const providersSaveError = useProvidersStore((state) => state.saveError)
  const retryProvidersSave = useProvidersStore((state) => state.retrySave)
  const visibleTabs = VISIBLE_SETTINGS_TABS
  const effectiveActiveTab = visibleTabs.some((tab) => tab.id === activeTab) ? activeTab : 'general'
  const activeTabItem = visibleTabs.find((tab) => tab.id === effectiveActiveTab) ?? visibleTabs[0]
  const saveFailure = appSaveError
    ? { message: '通用设置保存失败', retry: retryAppSave }
    : providersSaveError
      ? { message: '模型配置保存失败', retry: retryProvidersSave }
      : null

  useEffect(() => {
    if (mounted) {
      return
    }
    const frame = window.requestAnimationFrame(() => {
      setMounted(true)
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [mounted])

  // 内容骨架先挂载，动画启动后再下一帧挂 tab 内容，让挂载开销避开入场过渡的起始帧。
  useEffect(() => {
    if (!mounted || contentReady) {
      return
    }
    const frame = window.requestAnimationFrame(() => {
      setContentReady(true)
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [mounted, contentReady])

  useGSAP(
    () => {
      const sidebar = sidebarRef.current
      const labels = sidebar?.querySelectorAll<HTMLElement>('[data-settings-sidebar-label]')
      if (!sidebar || !labels) {
        return
      }

      const width = isSidebarExpanded ? 168 : 70
      const labelOpacity = isSidebarExpanded ? 1 : 0
      gsap.killTweensOf([sidebar, labels])
      // 仅在展开态实际切换时播补间，首次挂载直接落位，避免打开动画期间每帧 width 重排。
      const isToggleChange = previousExpandedRef.current !== isSidebarExpanded
      previousExpandedRef.current = isSidebarExpanded
      if (!shouldAnimate || !isToggleChange) {
        gsap.set(sidebar, { width })
        gsap.set(labels, { autoAlpha: labelOpacity })
        return
      }

      gsap.to(sidebar, { duration: 0.24, ease: 'power2.out', overwrite: 'auto', width })
      gsap.to(labels, {
        autoAlpha: labelOpacity,
        duration: isSidebarExpanded ? 0.18 : 0.1,
        ease: 'power1.out',
        overwrite: 'auto'
      })
    },
    { dependencies: [isSidebarExpanded, shouldAnimate], scope: sidebarRef }
  )

  const renderActiveTab = (): ReactElement => {
    switch (effectiveActiveTab) {
      case 'general':
        return <GeneralTab onOpenQuickStart={onOpenQuickStart} />
      case 'model':
        return <ModelTab />
      case 'tts':
        return <TtsTab />
      case 'memory':
        return (
          <Suspense fallback={<TabLoadingFallback />}>
            <MemoryTab onClose={onClose} />
          </Suspense>
        )
      case 'character':
        return (
          <Suspense fallback={<TabLoadingFallback />}>
            <CharacterTab />
          </Suspense>
        )
      case 'storage':
        return (
          <Suspense fallback={<TabLoadingFallback />}>
            <StorageTab />
          </Suspense>
        )
      case 'log':
        return <LogTab />
      case 'trace':
        return (
          <Suspense fallback={<TabLoadingFallback />}>
            <TraceTab />
          </Suspense>
        )
      case 'tools':
        return <ToolsTab />
      case 'world':
        return (
          <Suspense fallback={<TabLoadingFallback />}>
            <WorldTab />
          </Suspense>
        )
      case 'agent':
        return <AgentTab />
      case 'flows':
        return (
          <Suspense fallback={<TabLoadingFallback />}>
            <FlowsTab />
          </Suspense>
        )
      default:
        return <ModelTab />
    }
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden font-sans">
      <div data-drag-region className="relative h-16 shrink-0 items-center justify-between">
        <div data-drag-region className="absolute bottom-4 left-6 flex items-center gap-1">
          <activeTabItem.icon className="size-6 text-white" />
          <span className="text-xl font-bold text-white">{activeTabItem.label}</span>
        </div>
        <CloseIcon className="absolute right-6 bottom-2" onClick={onClose} />
      </div>

      <div className="min-h-0 flex-1">
        {saveFailure && (
          <div className="mx-5 mt-2 flex items-center justify-between gap-3 rounded border border-red-300/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
            <span>{saveFailure.message}</span>
            <Button
              variant="danger"
              size="xs"
              onClick={() => void saveFailure.retry()}
              className="shrink-0"
            >
              <RotateCcw className="size-3.5" />
              重试
            </Button>
          </div>
        )}
        <div className="flex h-full min-h-0">
          <aside
            ref={sidebarRef}
            className={`flex w-18 shrink-0 flex-col overflow-hidden border-r border-white/8 px-4 py-5 ${
              mounted ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
            }`}
          >
            <div className="flex h-full min-h-0 flex-col">
              <nav
                className="min-h-0 flex-1 flex-col items-center overflow-hidden"
                aria-label="设置导航"
              >
                <div className="space-y-4 pb-2">
                  {visibleTabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      title={tab.label}
                      aria-label={tab.label}
                      onClick={() => setActiveTab(tab.id)}
                      className="flex w-42 items-center gap-3 text-left"
                    >
                      <tab.icon
                        className={cn(
                          'ml-1 size-8 hover:text-yellow-300',
                          effectiveActiveTab === tab.id ? 'text-yellow-300' : 'text-white/70'
                        )}
                      />
                      <span
                        data-settings-sidebar-label
                        className={cn(
                          'text-sm whitespace-nowrap opacity-0',
                          effectiveActiveTab === tab.id ? 'text-yellow-300' : 'text-white/70'
                        )}
                      >
                        {tab.label}
                      </span>
                    </button>
                  ))}
                </div>
              </nav>
              <button
                type="button"
                onClick={() => void setSettingsSidebarExpanded(!isSidebarExpanded)}
                className="mt-4 ml-1 flex size-8 shrink-0 items-center justify-center text-white/70 hover:text-yellow-300"
                title={isSidebarExpanded ? '收起设置导航' : '展开设置导航'}
                aria-label={isSidebarExpanded ? '收起设置导航' : '展开设置导航'}
                aria-expanded={isSidebarExpanded}
              >
                {isSidebarExpanded ? (
                  <PanelLeftClose className="size-6" />
                ) : (
                  <PanelLeftOpen className="size-6" />
                )}
              </button>
            </div>
          </aside>

          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <div
              key={effectiveActiveTab}
              className={`h-full p-1 transition-all duration-200 ${
                contentReady ? 'animate-in fade-in-0 slide-in-from-bottom-2' : ''
              }`}
            >
              {contentReady ? renderActiveTab() : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
