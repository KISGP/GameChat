import type { CharacterTtsSettings } from '@gamechat/type'

/**
 * @description 解析角色在 Fish Audio 下最终生效的音色 ID。
 * @param characterSettings 用户保存的当前角色声音覆盖。
 * @param repoPreset 角色信息（info.json `tts.fish`）携带的仓库预设音色 ID。
 * @returns 用户覆盖优先、其次仓库预设；两者都不存在时返回空字符串。
 * @remarks 预设值来自角色仓库的角色数据（见 characters 域）。
 */
export function resolveFishCharacterReferenceId(
  characterSettings: CharacterTtsSettings,
  repoPreset: string | undefined
): string {
  return characterSettings.fish?.referenceId || repoPreset || ''
}
