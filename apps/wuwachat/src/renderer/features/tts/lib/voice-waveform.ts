/** 波形解码桶数；高于典型渲染棒数，为平滑、对比增强与重采样保留分辨率。 */
export const WAVEFORM_BUCKET_COUNT = 180

/** 包络平滑的滑动平均窗口宽度；奇数，过小保留毛刺、过大抹平节奏。 */
const SMOOTH_WINDOW = 2

/** 包络对比增强的幂指数；大于 1 压低中段、抬高峰值，让起伏更明显。 */
const CONTRAST_EXPONENT = 1.6

/** 解码后的音色波形：平滑归一化的峰值包络与真实时长（秒）。 */
export type DecodedVoiceWaveform = {
  peaks: number[]
  /** 音频真实时长（秒），取自解码缓冲。 */
  duration: number
}

/**
 * @description 对包络做对称滑动平均平滑并重新归一化。
 * @param raw 原始峰值包络。
 * @returns 平滑后的包络；最大值重新映射为 1。
 */
function smoothPeaks(raw: number[]): number[] {
  const half = Math.floor(SMOOTH_WINDOW / 2)
  const smoothed = raw.map((_, index) => {
    let sum = 0
    let count = 0
    for (let offset = index - half; offset <= index + half; offset += 1) {
      if (offset >= 0 && offset < raw.length) {
        sum += raw[offset]
        count += 1
      }
    }
    return count > 0 ? sum / count : 0
  })
  const max = Math.max(...smoothed)
  return max > 0 ? smoothed.map((peak) => peak / max) : smoothed
}

/**
 * @description 解码音色字节并计算「流声」风格的渲染包络。
 * @param data WAV 文件字节（经 IPC 直传）。
 * @returns 平滑增强后的峰值包络与真实时长。
 */
export async function buildVoiceWaveform(data: Uint8Array): Promise<DecodedVoiceWaveform> {
  const context = new AudioContext()
  try {
    const audioBuffer = await context.decodeAudioData(data.slice().buffer)
    const channel = audioBuffer.getChannelData(0)
    const bucketSize = Math.max(1, Math.floor(channel.length / WAVEFORM_BUCKET_COUNT))
    const peaks: number[] = []
    let maxPeak = 0
    for (let index = 0; index < WAVEFORM_BUCKET_COUNT; index += 1) {
      const start = index * bucketSize
      const end = Math.min(channel.length, start + bucketSize)
      let peak = 0
      for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
        const magnitude = Math.abs(channel[sampleIndex])
        if (magnitude > peak) {
          peak = magnitude
        }
      }
      maxPeak = Math.max(maxPeak, peak)
      peaks.push(peak)
    }
    const normalized = maxPeak > 0 ? peaks.map((peak) => peak / maxPeak) : peaks
    return {
      peaks: smoothPeaks(normalized).map((peak) => Math.pow(peak, CONTRAST_EXPONENT)),
      duration: audioBuffer.duration
    }
  } finally {
    void context.close()
  }
}
