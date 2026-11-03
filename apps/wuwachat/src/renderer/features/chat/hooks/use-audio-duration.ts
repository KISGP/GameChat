import { useEffect, useState } from 'react'

/**
 * @description 以音频地址键控的时长缓存，避免虚拟列表行重挂载时重复解码音频元数据。
 */
const durationCache = new Map<string, number>()

/**
 * @description 读取一段音频的时长秒数。
 * @param audioUrl 音频文件地址；为 null 时返回 null。
 * @returns 音频时长秒数；元数据尚未就绪或读取失败时返回 null。
 * @remarks 通过 Audio 元素按 metadata 预加载读取时长，对 mp3 与 wav 一致生效；
 *   成功结果按地址缓存，读取失败不缓存，调用方需自行处理时长缺失时的展示。
 */
export function useAudioDuration(audioUrl: string | null): number | null {
  const [loaded, setLoaded] = useState<{ url: string; duration: number } | null>(null)
  const cached = audioUrl !== null ? durationCache.get(audioUrl) : undefined
  const duration = cached ?? (loaded && loaded.url === audioUrl ? loaded.duration : null)

  useEffect(() => {
    if (audioUrl === null || durationCache.has(audioUrl)) {
      return
    }
    let cancelled = false
    const audio = new Audio()
    audio.preload = 'metadata'
    const handleLoadedMetadata = (): void => {
      if (cancelled || !Number.isFinite(audio.duration)) {
        return
      }
      durationCache.set(audioUrl, audio.duration)
      setLoaded({ url: audioUrl, duration: audio.duration })
    }
    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.src = audioUrl
    return () => {
      cancelled = true
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeAttribute('src')
    }
  }, [audioUrl])

  return duration
}
