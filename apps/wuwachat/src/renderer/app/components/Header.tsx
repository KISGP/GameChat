import { useSkinSlot, useSkinStyle, SkinSpineMounts } from '@renderer/features/appearance'
import { cn } from '@renderer/common/lib/cn'
import Icon1 from '@renderer/assets/T_TPI_UiPhoneSystem_Main1_UIAtlas_1.png'
import Icon2 from '@renderer/assets/T_TPI_UiPhoneSystem_Main1_UIAtlas_2.png'
import Icon3 from '@renderer/assets/SP_IconBreakthroughDetail.png'
import CloseIcon from './Close'
import InfoIcon from '@renderer/assets/T_BtnHelpInfoNor.png'
import Info from '@renderer/app/components/Info'
import { useState, type ReactElement } from 'react'

export default function Header({
  onOpenSettings,
  onOpenDisplay
}: {
  onOpenSettings?: () => void
  onOpenDisplay?: () => void
}): ReactElement {
  const [isInfoOpen, setIsInfoOpen] = useState(false)
  const titleBarSrc = useSkinSlot('titleBar')
  const titleBarStyle = useSkinStyle('titleBar')
  const headerLogoStyle = useSkinStyle('headerLogo')
  const headerLogoDotStyle = useSkinStyle('headerLogoDot')
  const headerTitleStyle = useSkinStyle('headerTitle')

  const openInfo = (): void => {
    setIsInfoOpen(true)
  }

  const handleClose = (): void => {
    window.close()
  }

  return (
    <div className="relative h-17">
      <img
        data-drag-region
        src={titleBarSrc}
        className={cn('-z-10 h-full drop-shadow-[0_0_0_#fff]', titleBarStyle)}
        draggable="false"
      />

      {/* 顶栏装饰：当前皮肤声明的 Spine 挂载清单（灯笼河景双层）；整层点击穿透，
          不挡顶栏拖拽与窗口按钮。 */}
      <SkinSpineMounts surface="header" />

      <img src={Icon1} className={cn('absolute z-10', headerLogoStyle)} draggable="false" />
      <div
        className={cn('absolute size-1.5 rounded-full bg-neutral-300/80', headerLogoDotStyle)}
      ></div>
      <span className={cn('absolute font-semibold', headerTitleStyle)}>飞讯</span>

      <div className="no-drag pointer-events-auto absolute top-3.5 right-6 z-100 flex gap-6">
        <img
          src={Icon3}
          className="no-drag pointer-events-auto z-10 size-10 cursor-pointer transition-transform duration-200 hover:scale-105"
          draggable="false"
          onClick={onOpenSettings}
        />
        <img
          src={Icon2}
          className="no-drag pointer-events-auto z-10 size-10 scale-90 cursor-pointer transition-transform duration-200 hover:scale-95"
          draggable="false"
          onClick={onOpenDisplay}
        />
        <img
          src={InfoIcon}
          className="no-drag pointer-events-auto z-10 size-10 cursor-pointer transition-transform duration-200 hover:scale-106"
          draggable="false"
          onClick={openInfo}
        />

        <CloseIcon onClick={handleClose} />
      </div>

      <Info isOpen={isInfoOpen} onClose={() => setIsInfoOpen(false)} />
    </div>
  )
}
