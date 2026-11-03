import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { ChevronLeft } from 'lucide-react'
import { toast } from 'sonner'
import CloseIcon from '@renderer/app/components/Close'
import { trackError, trackUiEvent } from '@renderer/app/telemetry'
import { CharacterPickerStep, ModelSetupStep } from '@renderer/features/quickstart'
import { useModelSelectionStore } from '@renderer/features/chat/store/model-selection'
import { cn } from '@renderer/common/lib/cn'
import { Button } from '@renderer/common/components/button'
import { useCharacterRegistryStore } from '@renderer/store/character-registry'
import { useSessionStore } from '@renderer/store/session'
import { downloadCharacter } from '@renderer/services/characters'

/** 首启向导的步骤标识：先选角色，再配模型。 */
type QuickStartStep = 'character' | 'model'

/**
 * @description 渲染首启配置向导覆盖层：引导用户依次完成角色选择下载与极简模型配置，落在可开聊的就绪态。
 * @param props 组件 props。
 * @returns 首启向导页面。
 * @remarks 角色步全幅沉浸展示立绘卡带、无界面文字，仅保留右上角关闭；模型步保留标题栏与页脚。
 *   角色步支持方向键整卡滑动并自动选中中心卡、Enter 确认、Esc 先收起选中再退出；模型步
 *   Esc 直接退出。任意时刻都可通过关闭按钮退出，已入队的下载与已保存的配置不受影响。
 */
export default function QuickStartPage({ onClose }: { onClose: () => void }): ReactElement {
  const [step, setStep] = useState<QuickStartStep>('character')
  const [characterId, setCharacterId] = useState<string | null>(null)

  // 模型步 Esc 直接关闭向导；角色步的 Esc 语义（先收起选中再退出）由角色步自身处理。
  useEffect(() => {
    if (step !== 'model') {
      return
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [step, onClose])

  /**
   * @description 记录用户确认的角色、触发角色下载，并进入模型配置步。
   * @param id 用户确认的角色标识。
   * @returns 无返回值。
   * @remarks 下载与模型配置并行：模型步期间角色在后台下载，完成收尾时若尚未就绪则跳过激活。
   *   已安装的角色不重复入队。
   */
  const handleCharacterConfirmed = useCallback((id: string) => {
    setCharacterId(id)
    setStep('model')
    const installed = useCharacterRegistryStore
      .getState()
      .registry.local.some((entry) => entry.id === id)
    if (!installed) {
      const entryName = useCharacterRegistryStore
        .getState()
        .registry.remote.find((entry) => entry.id === id)?.name
      downloadCharacter(id).catch((error: unknown) => {
        trackError(
          'quickstart-confirm-download-failed',
          'Failed to enqueue character download on confirm',
          error
        )
        toast.error(`无法开始下载角色「${entryName ?? id}」，请检查网络后重试。`)
      })
    }
  }, [])

  /**
   * @description 模型保存完成后激活所选角色、选中模型并落在新建会话的聊天就绪态。
   * @param modelEntryId 已写入供应商配置的模型条目标识。
   * @returns 无返回值。
   * @remarks 角色在注册表中缺失时跳过激活并记录错误，模型选择与关闭向导照常执行；
   *   群聊目标一并清空，保证首条消息发给所选角色。
   */
  const handleModelCompleted = useCallback(
    (modelEntryId: string) => {
      const registryState = useCharacterRegistryStore.getState()
      const character = characterId
        ? registryState.registry.local.find((entry) => entry.id === characterId)
        : undefined
      if (characterId && !character) {
        trackError(
          'quickstart-character-missing',
          'Quick start character missing from registry after download',
          new Error('character not found'),
          { characterId }
        )
      }
      if (character) {
        registryState.setActivateChar(character)
      }
      useSessionStore.getState().setCurrentGroupId(null)
      useSessionStore.getState().startNewSession()
      useModelSelectionStore.getState().selectModel(modelEntryId)
      trackUiEvent('quickstart-finish', 'User completed the quick start wizard', {
        characterId,
        modelEntryId
      })
      onClose()
    },
    [characterId, onClose]
  )

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden font-sans">
      {step === 'model' ? (
        <div data-drag-region className="relative h-16 shrink-0">
          <div data-drag-region className="absolute bottom-3 left-8 flex items-center gap-5">
            <Button
              variant="link"
              onClick={() => setStep('character')}
              className="no-drag h-auto gap-1.5 p-0 text-sm font-normal text-white/55 hover:text-[#f1d9af] hover:no-underline"
            >
              <ChevronLeft className="size-4" />
              返回选角
            </Button>
          </div>
        </div>
      ) : null}
      <CloseIcon className="no-drag absolute top-3.5 right-6 z-20" onClick={onClose} />

      <div
        className={cn(
          'min-h-0 flex-1',
          step === 'character' ? 'overflow-hidden' : 'overflow-y-auto px-8 pt-2 pb-4'
        )}
      >
        {step === 'character' ? (
          <CharacterPickerStep onConfirm={handleCharacterConfirmed} onRequestClose={onClose} />
        ) : (
          <ModelSetupStep onCompleted={handleModelCompleted} onSkip={onClose} />
        )}
      </div>
    </div>
  )
}
