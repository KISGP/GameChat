/**
 * @description 远端角色索引解析：逐条容错校验仓库索引文档。
 * @remarks 远端 id 会用于文件系统路径，必须通过 assertPathSegment 校验；
 *   单个条目非法只跳过并记日志，不影响其余条目。
 */
import type { LogAdapter } from '../../adapters'
import { assertPathSegment } from '../../infra/path'
import { validateEmoticonDefinitions } from '../emoticons'
import { normalizeCharacterVersion } from '../mappers'
import type {
  CharacterLocalizedText,
  CharacterTtsChannels,
  CharacterVoiceLine,
  RemoteCharacterRecord
} from '../types'

/** 索引解析的宿主依赖。 */
export type RemoteParserDeps = {
  /** 日志出口：跳过条目时记录。 */
  log: LogAdapter
}

/**
 * @description 解析并容错校验远端索引文档。
 * @param payload 索引文件的未知 JSON 内容。
 * @param deps 宿主依赖：日志出口。
 * @returns 规范化后的角色记录列表（按 id 排序）。
 * @throws 索引整体结构非法（非对象、条目列表缺失）时抛出。
 */
export function parseCharacterIndex(payload: unknown, deps: RemoteParserDeps): RemoteCharacterRecord[] {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Remote character index must be an object.')
  }
  const document = payload as Record<string, unknown>
  if (!Array.isArray(document.characters)) {
    throw new Error('Remote character index must contain a characters array.')
  }
  const records: RemoteCharacterRecord[] = []
  const seenIds = new Set<string>()
  document.characters.forEach((item, position) => {
    try {
      const record = parseCharacterEntry(item)
      if (seenIds.has(record.id)) {
        deps.log.warn('characters', 'character-index-entry-skipped', 'Skipped remote character index entry', {
          position,
          characterId: record.id,
          reason: 'duplicate id'
        })
        return
      }
      seenIds.add(record.id)
      records.push(record)
    } catch (error) {
      deps.log.warn('characters', 'character-index-entry-skipped', 'Skipped remote character index entry', {
        position,
        reason: error instanceof Error ? error.message : String(error)
      })
    }
  })
  return records.sort((left, right) => left.id.localeCompare(right.id))
}

/**
 * @description 解析并校验单个索引条目。
 * @param item 索引条目的未知值。
 * @returns 规范化后的角色记录。
 * @throws 任一必填字段缺失、id 非法或表情定义非法时抛出。
 */
function parseCharacterEntry(item: unknown): RemoteCharacterRecord {
  if (!item || typeof item !== 'object') {
    throw new Error('Entry must be an object.')
  }
  const value = item as Record<string, unknown>
  if (typeof value.id !== 'string' || !value.id.trim()) {
    throw new Error('Character id is required.')
  }
  const id = value.id.trim()
  assertPathSegment(id, 'remote character id')
  const avatar = parseRepositoryPath(value.avatar, 'avatar')
  const cardBg = parseRepositoryPath(value.cardBg, 'cardBg')
  const pixActivity = parseRepositoryPath(value.pixActivity, 'pixActivity')
  const rolePile = parseRepositoryPath(value.rolePile, 'rolePile')
  const prompt = parseRepositoryPath(value.prompt, 'prompt')
  const information = parseLocalizedText(value.information)
  const tts = parseTtsChannels(value.tts)
  const ttsVoices =
    value.tts && typeof value.tts === 'object'
      ? (value.tts as Record<string, unknown>).voices
      : undefined
  const voices = parseVoiceLines(ttsVoices)
  return {
    id,
    updateAt: normalizeCharacterVersion(typeof value.updateAt === 'string' ? value.updateAt : null),
    name: parseLocalizedText(value.name),
    description: parseLocalizedText(value.description),
    information,
    resonancePower: parseLocalizedText(value.resonancePower),
    avatar,
    cardBg,
    pixActivity,
    rolePile,
    prompt,
    voices,
    ...(tts ? { tts } : {}),
    emoticons: validateEmoticonDefinitions(value.emoticons)
  }
}

/**
 * @description 解析仓库相对路径字段。
 * @param value 字段未知值。
 * @param field 字段名，进入错误消息。
 * @returns 仓库相对路径。
 * @throws 缺失或不是非空字符串时抛出。
 */
function parseRepositoryPath(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} path is required.`)
  }
  return value.trim()
}

/**
 * @description 解析多语言文本块。
 * @param value 字段未知值。
 * @returns 规范化后的多语言文本块。
 */
function parseLocalizedText(value: unknown): CharacterLocalizedText {
  const text = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const pick = (input: unknown): string | undefined =>
    typeof input === 'string' && input.trim() ? input.trim() : undefined
  return {
    ...(pick(text.en) !== undefined ? { en: pick(text.en) } : {}),
    ...(pick(text.cn) !== undefined ? { cn: pick(text.cn) } : {}),
    ...(pick(text.jp) !== undefined ? { jp: pick(text.jp) } : {})
  }
}

/**
 * @description 解析 TTS 托管音色通道。
 * @param value 字段未知值。
 * @returns 托管通道；未配置时为 undefined。
 */
function parseTtsChannels(value: unknown): CharacterTtsChannels | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const fish = (value as Record<string, unknown>).fish
  return typeof fish === 'string' && fish.trim() ? { fish: fish.trim() } : undefined
}

/**
 * @description 解析语音参考线清单。
 * @param value 字段未知值。
 * @returns 语音线数组；未配置或非法时为空数组。
 */
function parseVoiceLines(value: unknown): CharacterVoiceLine[] {
  if (!Array.isArray(value)) {
    return []
  }
  const lines: CharacterVoiceLine[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const record = item as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    const label = typeof record.label === 'string' ? record.label.trim() : ''
    const file = typeof record.file === 'string' ? record.file.trim() : ''
    if (!id || !label || !file) {
      continue
    }
    lines.push({
      id,
      label,
      ...(typeof record.lang === 'string' && record.lang.trim() ? { lang: record.lang.trim() } : {}),
      file
    })
  }
  return lines
}
