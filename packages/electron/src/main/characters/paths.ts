import { join } from 'path'
import {
  getCharacterDirectoryPath as getCharacterDirectoryPathFromCore,
  getCharacterEmoticonsRoot as getCharacterEmoticonsRootFromCore,
  getCharacterInfoPath as getCharacterInfoPathFromCore,
  getCharacterPromptPath as getCharacterPromptPathFromCore,
  getCharacterSettingsPath as getCharacterSettingsPathFromCore,
  getCharactersRoot as getCharactersRootFromCore,
  TTS_VOICE_FILE_NAME
} from '@gamechat/core'
import { getAppDataRoot } from '../utils/path'

/**
 * @description 返回本地角色资源根目录。
 * @returns 角色资源应用数据目录。
 */
export function getCharactersRoot(): string {
  return getCharactersRootFromCore(getAppDataRoot())
}

/**
 * @description 返回远端角色注册表缓存的持久化文件路径。
 * @returns 角色缓存 JSON 文件路径。
 */
export function getCharactersCachePath(): string {
  return join(getAppDataRoot(), 'chars-cache.json')
}

/**
 * @description 返回未安装远端角色预览图的缓存根目录。
 * @returns 预览图缓存目录路径。
 * @remarks 缓存按 `<角色id>/<资产>.png` 组织；整表同步成功后整体清空，由协议侧按需重建。
 */
export function getRemoteImagesCacheRoot(): string {
  return join(getAppDataRoot(), 'remote-images')
}

/**
 * @description 返回指定角色的资源目录。
 * @param characterId 角色标识。
 * @returns 角色目录路径。
 */
export function getCharacterDirectoryPath(characterId: string): string {
  return getCharacterDirectoryPathFromCore(getAppDataRoot(), characterId)
}

/**
 * @description 返回指定角色的信息文件路径。
 * @param characterId 角色标识。
 * @returns info.json 路径。
 */
export function getCharacterInfoPath(characterId: string): string {
  return getCharacterInfoPathFromCore(getAppDataRoot(), characterId)
}

/**
 * @description 返回指定角色的 Prompt 文件路径。
 * @param characterId 角色标识。
 * @returns prompt.md 路径。
 */
export function getCharacterPromptPath(characterId: string): string {
  return getCharacterPromptPathFromCore(getAppDataRoot(), characterId)
}

/**
 * @description 返回指定角色的表情资源根目录。
 * @param characterId 角色标识。
 * @returns 角色目录下的表情资源目录。
 */
export function getCharacterEmoticonsRoot(characterId: string): string {
  return getCharacterEmoticonsRootFromCore(getAppDataRoot(), characterId)
}

/**
 * @description 返回指定角色的用户配置文件路径。
 * @param characterId 角色标识。
 * @returns 角色目录中的 settings.json 路径。
 */
export function getCharacterSettingsPath(characterId: string): string {
  return getCharacterSettingsPathFromCore(getAppDataRoot(), characterId)
}

/**
 * @description 返回指定角色的本地 index-tts 参考音色文件路径。
 * @param characterId 已安装角色的标识。
 * @returns 保存在角色目录中的固定参考音色路径。
 */
export function getCharacterTtsVoicePath(characterId: string): string {
  return join(getCharacterDirectoryPath(characterId), TTS_VOICE_FILE_NAME)
}
