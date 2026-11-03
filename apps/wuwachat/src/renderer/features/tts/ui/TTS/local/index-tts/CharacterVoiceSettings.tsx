import { useEffect, useState, type ReactElement } from 'react'
import { toast } from 'sonner'
import { getCharacterVoiceStatus } from '@renderer/services/tts'
import { getIpcErrorMessage } from '@renderer/common/lib/error-message'
import { VoiceWaveformBar } from './VoiceWaveformBar'

type IndexTtsCharacterVoiceSettingsProps = {
  characterId: string
  /** 卡片是否展开；仅在展开时启动波形播放器。 */
  active: boolean
}

/**
 * @description 渲染一个角色的 index-tts 参考音色波形播放器。
 * @param props 需要展示音色的已安装角色标识与卡片展开状态。
 * @returns 角色音色资源展示区域。
 */
export function IndexTtsCharacterVoiceSettings({
  characterId,
  active
}: IndexTtsCharacterVoiceSettingsProps): ReactElement {
  const [isDownloaded, setIsDownloaded] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let disposed = false

    /**
     * @description 读取当前角色固定音色文件的本地状态。
     */
    const loadStatus = async (): Promise<void> => {
      setIsLoading(true)
      try {
        const status = await getCharacterVoiceStatus(characterId)
        if (!disposed) setIsDownloaded(status.isDownloaded)
      } catch (statusError) {
        if (!disposed) {
          toast.error(getIpcErrorMessage(statusError))
        }
      } finally {
        if (!disposed) setIsLoading(false)
      }
    }

    void loadStatus()
    return () => {
      disposed = true
    }
  }, [characterId])

  if (isLoading) {
    return <span className="text-xs text-white/45">正在检查音色...</span>
  }

  if (!isDownloaded) {
    return <span className="text-xs text-white/45">该角色未提供音色</span>
  }

  return <VoiceWaveformBar characterId={characterId} isDownloaded={isDownloaded} active={active} />
}
