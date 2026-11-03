import { join } from 'path'
import { getAppDataRoot } from '../utils/path'

/**
 * @description 返回本地 TTS 生成音频的应用数据目录。
 * @returns 可由主进程读写的临时音频缓存目录。
 */
export function getTtsAudioRoot(): string {
  return join(getAppDataRoot(), 'tts', 'audio')
}
