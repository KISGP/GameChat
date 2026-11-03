import { useCallback, useEffect, type ReactElement, type ReactNode } from 'react'
import Header from '@renderer/app/components/Header'
import CharacterRail from '@renderer/features/chat/ui/CharacterRail'
import ChatPanel from '@renderer/features/chat/ui/ChatPanel'
import SettingsPage from '@renderer/pages/settings/SettingsPage'
import DisplayPage from '@renderer/pages/display/DisplayPage'
import QuickStartPage from '@renderer/pages/quickstart/QuickStartPage'
import { useQuickStartAutoOpen } from '@renderer/features/quickstart'
import { useRendererStoreBootstrap } from '@renderer/app/hooks/useRendererBootstrap'
import { useMotionPreference } from '@renderer/app/hooks/useMotionPreference'
import { useOverlayLifecycle, type OverlayPhase } from '@renderer/app/hooks/useOverlayLifecycle'
import { Spinner } from '@renderer/common/components/spinner'
import { SpineSuspensionProvider } from '@renderer/common/components/SpineCanvas'
import { Toaster } from 'sonner'
import { useUpdateStore } from '@renderer/store/update'
import { UpdateFoundDialog } from '@renderer/features/general/ui/UpdateFoundDialog'

/**
 * @description 渲染全屏覆盖层的遮罩与内容容器：外层按生命周期阶段淡入淡出，内容在静止的模糊遮罩内上滑入场、下滑退场。
 * @param props 组件 props。
 * @returns 覆盖层内容。
 */
function OverlayLayer({
  phase,
  shouldAnimate,
  children
}: {
  phase: OverlayPhase
  shouldAnimate: boolean
  children: ReactNode
}): ReactElement {
  const settled = phase === 'open'
  return (
    <div
      className={`absolute inset-0 ${
        shouldAnimate ? 'transition-opacity duration-300 ease-in-out' : ''
      } ${settled ? 'opacity-100' : 'opacity-0'}`}
    >
      <div className="flex h-full w-full overflow-hidden bg-black/60 backdrop-blur-md">
        <div
          className={`flex h-full w-full ${
            shouldAnimate ? 'transition-transform duration-300 ease-in-out' : ''
          } ${settled ? 'translate-y-0' : 'translate-y-4'}`}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

/**
 * @description 渲染应用壳：背景工作区、设置与界面设置两个全屏覆盖层、首启配置向导覆盖层，以及全局浮层。
 * @returns 应用根组件。
 */
export default function App(): ReactElement {
  const { shouldAnimate } = useMotionPreference()
  const settings = useOverlayLifecycle(shouldAnimate)
  const display = useOverlayLifecycle(shouldAnimate)
  const quickstart = useOverlayLifecycle(shouldAnimate)
  const settingsBootstrapState = useRendererStoreBootstrap()

  useQuickStartAutoOpen(settingsBootstrapState === 'ready', quickstart.open)

  // 覆盖层互斥：设置层之上叠开引导层会透出底下页面、形成弹窗观感，打开引导前先收起设置层。
  const openQuickStartExclusively = useCallback((): void => {
    settings.close()
    quickstart.open()
  }, [settings, quickstart])

  useEffect(() => {
    useUpdateStore.getState().initialize()
  }, [])

  if (settingsBootstrapState !== 'ready') {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-neutral-950 text-sm text-white/70">
        {settingsBootstrapState === 'loading' ? <Spinner className="mr-2" /> : null}
        <span>{settingsBootstrapState === 'loading' ? '正在加载设置...' : '设置加载失败'}</span>
      </div>
    )
  }

  // 背景隐藏态只覆盖入场与常驻阶段，退场阶段与覆盖层做交叉淡入淡出。
  const backgroundHidden =
    settings.phase === 'entering' ||
    settings.phase === 'open' ||
    display.phase === 'entering' ||
    display.phase === 'open' ||
    quickstart.phase === 'entering' ||
    quickstart.phase === 'open'
  const backgroundCovered =
    settings.phase !== 'closed' || display.phase !== 'closed' || quickstart.phase !== 'closed'

  return (
    <div className="relative h-screen w-full overflow-hidden">
      <SpineSuspensionProvider suspended={backgroundHidden}>
        <div
          className={`absolute inset-0 ${
            shouldAnimate ? 'transition-opacity duration-300 ease-in-out' : ''
          } ${backgroundHidden ? 'opacity-0' : 'opacity-100'} ${
            backgroundCovered ? 'pointer-events-none' : ''
          }`}
        >
          <Header onOpenSettings={settings.open} onOpenDisplay={display.open} />
          <div className="flex justify-center pb-5">
            <CharacterRail />
            <ChatPanel />
          </div>
        </div>
      </SpineSuspensionProvider>

      <Toaster position="top-center" theme="dark" richColors closeButton offset={{ top: 80 }} />
      <UpdateFoundDialog />

      {settings.phase !== 'closed' && (
        <OverlayLayer phase={settings.phase} shouldAnimate={shouldAnimate}>
          <SettingsPage onClose={settings.close} onOpenQuickStart={openQuickStartExclusively} />
        </OverlayLayer>
      )}

      {display.phase !== 'closed' && (
        <OverlayLayer phase={display.phase} shouldAnimate={shouldAnimate}>
          <DisplayPage onClose={display.close} />
        </OverlayLayer>
      )}

      {quickstart.phase !== 'closed' && (
        <OverlayLayer phase={quickstart.phase} shouldAnimate={shouldAnimate}>
          <QuickStartPage onClose={quickstart.close} />
        </OverlayLayer>
      )}
    </div>
  )
}
