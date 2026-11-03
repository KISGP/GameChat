import { readFile } from 'fs/promises'
import { getCharacterSummaryById } from '../characters/index'
import { AppError } from '../errors/AppError'
import { assertPathSegment, pathExists } from '@gamechat/core'
import { getCharacterTtsVoicePath } from '../characters/paths'
import type { TtsCharacterVoiceStatus } from '@gamechat/type'

/**
 * @description 校验来自 IPC 的角色标识可安全用于固定音色文件路径。
 * @param characterId 待查询音色的角色标识。
 */
function validateCharacterId(characterId: string): void {
  try {
    assertPathSegment(characterId, 'TTS voice character identifier')
  } catch {
    throw new AppError('TTS_RUNTIME_ERROR', 'Invalid TTS voice character identifier', {
      safeMessage: '角色音色请求无效。'
    })
  }
}

/**
 * @description 返回一个本地角色的 index-tts 音色下载状态。
 * @param characterId 已安装角色的标识。
 * @returns 当前固定参考音色文件是否存在。
 */
export async function getCharacterTtsVoiceStatus(
  characterId: string
): Promise<TtsCharacterVoiceStatus> {
  validateCharacterId(characterId)
  await getCharacterSummaryById(characterId)
  return { characterId, isDownloaded: await pathExists(getCharacterTtsVoicePath(characterId)) }
}

/**
 * @description 读取角色 index-tts 参考音色文件的字节数据。
 * @param characterId 已安装角色的标识。
 * @returns WAV 文件字节。
 * @throws 角色 ID 非法、角色不存在或文件缺失时抛错，由 IPC 层向上传播给渲染层。
 * @remarks 经 IPC 传字节供渲染层转 blob 播放：自定义协议地址在渲染层的 fetch 与媒体元素
 *   通道都不可靠（CORS 与 URL 安全检查限制），直接传字节彻底绕开。
 */
export async function getCharacterTtsVoiceData(characterId: string): Promise<Uint8Array> {
  validateCharacterId(characterId)
  await getCharacterSummaryById(characterId)
  return new Uint8Array(await readFile(getCharacterTtsVoicePath(characterId)))
}
