/**
 * @description 角色域路径布局：角色资源根目录与角色目录内各固定文件的路径构造。
 * @remarks 角色标识可能来自渲染层或远端索引，getCharacterDirectoryPath 是全部角色
 *   路径构造的唯一路径段校验点。
 */
import { join } from 'path'
import { assertPathSegment } from '../infra/path'

/** 角色目录内 index-tts 参考音色的固定文件名。 */
export const TTS_VOICE_FILE_NAME = 'TTS.wav'

/** 角色信息文件名。 */
export const INFO_FILE_NAME = 'info.json'

/** 角色用户配置文件名。 */
export const SETTINGS_FILE_NAME = 'settings.json'

/** 角色人设文件名。 */
export const PROMPT_FILE_NAME = 'prompt.md'

/**
 * @description 返回本地角色资源根目录。
 * @param appDataRoot 应用数据根目录。
 * @returns 角色资源目录。
 */
export function getCharactersRoot(appDataRoot: string): string {
  return join(appDataRoot, 'chars')
}

/**
 * @description 返回指定角色的资源目录。
 * @param appDataRoot 应用数据根目录。
 * @param characterId 角色标识。
 * @returns 角色目录路径。
 */
export function getCharacterDirectoryPath(appDataRoot: string, characterId: string): string {
  assertPathSegment(characterId, 'character id')
  return join(getCharactersRoot(appDataRoot), characterId)
}

/**
 * @description 返回指定角色的信息文件路径。
 * @param appDataRoot 应用数据根目录。
 * @param characterId 角色标识。
 * @returns info.json 路径。
 */
export function getCharacterInfoPath(appDataRoot: string, characterId: string): string {
  return join(getCharacterDirectoryPath(appDataRoot, characterId), INFO_FILE_NAME)
}

/**
 * @description 返回指定角色的 Prompt 文件路径。
 * @param appDataRoot 应用数据根目录。
 * @param characterId 角色标识。
 * @returns prompt.md 路径。
 */
export function getCharacterPromptPath(appDataRoot: string, characterId: string): string {
  return join(getCharacterDirectoryPath(appDataRoot, characterId), PROMPT_FILE_NAME)
}

/**
 * @description 返回指定角色的表情资源根目录。
 * @param appDataRoot 应用数据根目录。
 * @param characterId 角色标识。
 * @returns 角色目录下的表情资源目录。
 */
export function getCharacterEmoticonsRoot(appDataRoot: string, characterId: string): string {
  return join(getCharacterDirectoryPath(appDataRoot, characterId), 'emoticons')
}

/**
 * @description 返回指定角色的用户配置文件路径。
 * @param appDataRoot 应用数据根目录。
 * @param characterId 角色标识。
 * @returns 角色目录中的 settings.json 路径。
 */
export function getCharacterSettingsPath(appDataRoot: string, characterId: string): string {
  return join(getCharacterDirectoryPath(appDataRoot, characterId), SETTINGS_FILE_NAME)
}
