import { mkdir } from 'fs/promises'
import { dirname } from 'path'
import { getAppDataRoot } from '../utils/path'
import { getCharactersRoot } from '../characters/paths'
import { getChatHistoryRoot } from '../chat/paths'
import { getLogsRoot } from '../logging/paths'
import { getSettingsPath } from '../settings/paths'
import { getTtsAudioRoot } from '../tts/paths'
import { getWorldRoot } from '../world/paths'

/**
 * @description 并行创建应用数据根目录及各域（角色、日志、world、TTS 音频、设置、聊天历史）的存储目录。
 * @remarks 目录已存在时静默跳过；必须在任何域服务读写磁盘之前完成。
 */
export async function bootstrapAppData(): Promise<void> {
  await Promise.all([
    mkdir(getAppDataRoot(), { recursive: true }),
    mkdir(getCharactersRoot(), { recursive: true }),
    mkdir(getLogsRoot(), { recursive: true }),
    mkdir(getWorldRoot(), { recursive: true }),
    mkdir(getTtsAudioRoot(), { recursive: true }),
    mkdir(dirname(getSettingsPath()), { recursive: true }),
    mkdir(getChatHistoryRoot(), { recursive: true })
  ])
}
