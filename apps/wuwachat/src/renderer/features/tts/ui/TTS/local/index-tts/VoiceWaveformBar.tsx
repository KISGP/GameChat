import { useEffect, useRef, useState, type ReactElement } from 'react'
import WaveSurfer from 'wavesurfer.js'
import { Pause, Play } from 'lucide-react'
import { Button } from '@renderer/common/components/button'
import { getCharacterVoiceData } from '@renderer/services/tts'
import { trackError } from '@renderer/app/telemetry'
import { buildVoiceWaveform } from '@renderer/features/tts/lib/voice-waveform'

type VoiceWaveformBarProps = {
  characterId: string
  /** 音色是否已下载；未下载时不创建播放器。 */
  isDownloaded: boolean
  /** 卡片是否展开；仅在展开时拉取字节并创建播放器，避免页面打开时的批量预载。 */
  active: boolean
}

/**
 * @description 渲染「流声」风格音色波形播放器：经 IPC 取回音色字节，本地解码出包络与时长，
 *   以预计算 peaks + 自建 media 元素喂给 wavesurfer 承担渲染、进度与点击跳转，附带播放/暂停钮。
 * @param characterId 角色标识。
 * @param isDownloaded 音色是否已下载。
 * @param active 卡片是否展开。
 * @returns 波形播放器元素。
 * @remarks 创建时提供预计算 peaks、duration 与自建 media 元素（blob src）：全程不经
 *   wavesurfer 的 fetch 与内部解码，实例零网络加载；media 元素播放 blob URL 依赖页面
 *   CSP 的 media-src 放行 blob:（index.html 已显式声明）。
 *   包络由 AudioContext 本地解码计算（平滑 + 对比增强）；点击或拖拽波形即为跳转。
 *   仅在卡片展开时启动，折叠即停止播放（外部 media 不由 wavesurfer 负责停声）；
 *   环境性装载失败只记录埋点，不弹 toast。
 */
export function VoiceWaveformBar({
  characterId,
  isDownloaded,
  active
}: VoiceWaveformBarProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const waveSurferRef = useRef<WaveSurfer | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)

  useEffect(() => {
    if (!active || !isDownloaded || !containerRef.current) {
      return
    }
    let disposed = false
    let objectUrl: string | null = null
    let media: HTMLAudioElement | null = null
    void (async () => {
      try {
        const data = await getCharacterVoiceData(characterId)
        const waveform = await buildVoiceWaveform(data)
        if (disposed || !containerRef.current) {
          return
        }
        objectUrl = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: 'audio/wav' }))
        media = new Audio(objectUrl)
        const player = WaveSurfer.create({
          container: containerRef.current,
          peaks: [waveform.peaks],
          duration: waveform.duration,
          media,
          height: 36,
          barWidth: 3,
          barGap: 2,
          barRadius: 2,
          cursorWidth: 0,
          // waveColor 必须为不透明实色：wavesurfer 的进度层经 source-in 掩膜继承其 alpha，
          // 半透明波形色会让已播放段按同比例变暗
          waveColor: '#2f2f2f',
          progressColor: '#ffdf9e',
          dragToSeek: true
        })
        waveSurferRef.current = player
        player.on('ready', () => setIsReady(true))
        player.on('play', () => setIsPlaying(true))
        player.on('pause', () => setIsPlaying(false))
        player.on('finish', () => setIsPlaying(false))
        player.on('error', (error: Error) => {
          trackError(
            'play-character-voice-failed',
            'Failed to play character reference voice',
            error
          )
        })
      } catch (setupError) {
        trackError(
          'setup-character-voice-failed',
          'Failed to set up voice waveform player',
          setupError
        )
      }
    })()
    return () => {
      disposed = true
      waveSurferRef.current?.destroy()
      waveSurferRef.current = null
      // 外部 media 的停声责任在调用方：wavesurfer 对传入的 media 不做 teardown
      //（Player.destroy 对 isExternalMedia 提前返回），不显式停止会让音频在
      // 播放器销毁后继续播放，重开卡片再播即多路重叠
      media?.pause()
      media?.removeAttribute('src')
      media?.load()
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
      setIsReady(false)
      setIsPlaying(false)
    }
  }, [characterId, isDownloaded, active])

  /**
   * @description 播放或暂停参考音色试听。
   */
  const handleTogglePlayback = (): void => {
    void waveSurferRef.current?.playPause()
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <div className="relative h-9 min-w-0 flex-1">
        {(!isReady || !active) && (
          <div className="absolute inset-0 flex items-center gap-px">
            {Array.from({ length: 64 }, (_, index) => (
              <span
                key={index}
                style={{ height: '12%' }}
                className="min-w-px flex-1 rounded-full bg-[#2f2f2f]"
              />
            ))}
          </div>
        )}
        <div
          ref={containerRef}
          className={`h-full w-full ${isReady && active ? '' : 'opacity-0'}`}
        />
      </div>
      <Button
        variant="quiet"
        size="icon-sm"
        onClick={handleTogglePlayback}
        disabled={!active || !isDownloaded || !isReady}
        title={isReady ? (isPlaying ? '暂停试听' : '试听音色') : '请先下载音色'}
        aria-label={isReady ? (isPlaying ? '暂停试听' : '试听音色') : '请先下载音色'}
      >
        {isPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
      </Button>
    </div>
  )
}
