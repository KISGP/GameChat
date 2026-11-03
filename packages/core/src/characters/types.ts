import type { CharacterSource } from '@gamechat/type'
import type { ChatEmoticonDefinition } from '@gamechat/schema'
import type { CharacterSettings } from '@gamechat/type'
import { normalizeCharacterVersion } from './mappers'

/** 多语言文本块（本地 info.json 与远端索引条目共用）。 */
export type CharacterLocalizedText = {
  en?: string
  cn?: string
  jp?: string
}

/** 角色 TTS 托管音色通道，按 provider 分键（当前仅 Fish Audio）。 */
export type CharacterTtsChannels = {
  fish?: string
}

/**
 * @description 仓库 v2 语音线条目。
 * @remarks `file` 为角色目录内相对路径（如 `voices/default.wav`），是参考音频，
 *   供本地推理或需要音色样本的服务使用；与 CharacterTtsChannels 的托管音色是两条独立通道。
 */
export type CharacterVoiceLine = {
  id: string
  label: string
  lang?: string
  file: string
}

/**
 * @description 本地 info.json 文档（安装后归一化，全部路径为角色目录内相对路径）。
 * @remarks settings.json 之外的全部角色数据都汇聚在这一个文件中。
 */
export type LocalCharacterInfo = {
  id: string
  updateAt: string | null
  source: CharacterSource
  name: CharacterLocalizedText
  description: CharacterLocalizedText
  /** 介绍文本；未提供时缺省。 */
  information?: CharacterLocalizedText
  avatar: string
  cardBg: string
  pixActivity: string
  rolePile: string
  prompt: string
  tts?: CharacterTtsChannels
  emoticons: ChatEmoticonDefinition[]
  /** 角色已不在远端索引中；仅预设角色会被标记。 */
  remoteUnavailable?: boolean
  /** 最近一次下载或更新的失败文本；重试成功时清除。 */
  syncError?: string
}

/**
 * @description v2 远端索引条目的内存规范化形态。
 * @remarks `avatar`/`cardBg`/`pixActivity`/`rolePile`/`prompt` 为仓库相对路径，
 *   `voices` 的 file 为角色目录内相对路径；`syncError` 仅存在于内存与持久化缓存。
 */
export type RemoteCharacterRecord = {
  id: string
  updateAt: string | null
  name: CharacterLocalizedText
  description: CharacterLocalizedText
  information: CharacterLocalizedText
  resonancePower: CharacterLocalizedText
  avatar: string
  cardBg: string
  pixActivity: string
  rolePile: string
  prompt: string
  voices: CharacterVoiceLine[]
  tts?: CharacterTtsChannels
  emoticons: ChatEmoticonDefinition[]
  syncError?: string
}

/** 下载队列与整表同步的运行状态快照。 */
export type QueueRuntimeState = {
  /** 正在下载或更新的角色 ID 集合。 */
  syncingIds: ReadonlySet<string>
  /** 排队等待下载的角色 ID 集合。 */
  queuedIds: ReadonlySet<string>
  /** 是否存在进行中的整表同步。 */
  isSyncing: boolean
  /** 上一次整表同步的错误文本。 */
  syncError: string
}

/** 记录加载器产出的本地角色记录。 */
export type LocalCharacterRecord = {
  info: LocalCharacterInfo
  name: string
  description: string
  information: string
  visible: boolean
  settings: CharacterSettings
  emoticons: ChatEmoticonDefinition[]
  prompt: string
}

/**
 * @description 将磁盘上的未知 info.json 内容规范化为本地角色信息文档。
 * @param value 从 info.json 读取的未知值。
 * @param expectedId 角色目录名，用于校验文档归属。
 * @returns 规范化后的文档；结构不符或 id 不匹配时返回 null。
 * @remarks 四张图片路径与人设路径为必填：缺失即视为损坏文档整体拒绝，读取侧不放宽。
 */
export function normalizeLocalCharacterInfo(
  value: unknown,
  expectedId: string
): LocalCharacterInfo | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || raw.id !== expectedId) return null
  if (raw.source !== 'preset' && raw.source !== 'custom') return null
  const localized = (input: unknown): CharacterLocalizedText => {
    const text = input && typeof input === 'object' ? (input as CharacterLocalizedText) : {}
    return {
      ...(typeof text.en === 'string' ? { en: text.en } : {}),
      ...(typeof text.cn === 'string' ? { cn: text.cn } : {}),
      ...(typeof text.jp === 'string' ? { jp: text.jp } : {})
    }
  }
  const path = (input: unknown): string | null =>
    typeof input === 'string' && input.trim() ? input : null
  const avatar = path(raw.avatar)
  const cardBg = path(raw.cardBg)
  const pixActivity = path(raw.pixActivity)
  const rolePile = path(raw.rolePile)
  const prompt = path(raw.prompt)
  if (!avatar || !cardBg || !pixActivity || !rolePile || !prompt) return null
  const tts =
    raw.tts &&
    typeof raw.tts === 'object' &&
    typeof (raw.tts as CharacterTtsChannels).fish === 'string'
      ? { fish: (raw.tts as CharacterTtsChannels).fish }
      : undefined
  const information = localized(raw.information)
  return {
    id: raw.id,
    updateAt: normalizeCharacterVersion(typeof raw.updateAt === 'string' ? raw.updateAt : null),
    source: raw.source,
    name: localized(raw.name),
    description: localized(raw.description),
    ...(information.en || information.cn || information.jp ? { information } : {}),
    avatar,
    cardBg,
    pixActivity,
    rolePile,
    prompt,
    ...(tts ? { tts } : {}),
    emoticons: Array.isArray(raw.emoticons) ? (raw.emoticons as ChatEmoticonDefinition[]) : [],
    ...(raw.remoteUnavailable === true ? { remoteUnavailable: true } : {}),
    ...(typeof raw.syncError === 'string' ? { syncError: raw.syncError } : {})
  }
}
