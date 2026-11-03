/**
 * @description 角色同步写入：从远端索引条目构建本地 info.json，并把角色文件集逐文件原子落盘。
 * @remarks settings.json 永远不在写入集合中，用户的可见性与音色配置不会被打断；
 *   info.json 最后写入，作为「该角色更新完成」的提交标记——中途失败时 info 保持旧值，
 *   下一次同步会重新拉取（自愈）。
 */
import { join } from 'path'
import { writeFileAtomic, writeJsonFileAtomic } from '../../infra'
import type { ChatEmoticonDefinition } from '@gamechat/schema'
import type { CharacterSource } from '@gamechat/type'
import { getCharacterDirectoryPath, TTS_VOICE_FILE_NAME } from '../paths'
import type { LocalCharacterInfo, RemoteCharacterRecord } from '../types'

/** 单个角色的远端文件集（已全部拉取到内存）。 */
export type RemoteCharacterBundle = {
  prompt: string
  avatar: Buffer
  cardBg: Buffer
  pixActivity: Buffer
  rolePile: Buffer
  /** 远端索引第一条语音线的内容；角色未配置语音线时为 null。 */
  voice: Buffer | null
  emoticons: Array<{ definition: ChatEmoticonDefinition; content: Buffer }>
}

/**
 * @description 从远端索引条目构建本地 info.json 文档。
 * @param entry 远端索引条目。
 * @param source 角色来源；已安装角色保留原值，新安装角色为 preset。
 * @returns 路径已归一化为本地相对路径的角色信息文档。
 */
export function createLocalCharacterInfo(
  entry: RemoteCharacterRecord,
  source: CharacterSource
): LocalCharacterInfo {
  return {
    id: entry.id,
    updateAt: entry.updateAt,
    source,
    name: entry.name,
    description: entry.description,
    information: { ...entry.information },
    avatar: 'avatar.png',
    cardBg: 'cardBg.png',
    pixActivity: 'pixActivity.png',
    rolePile: 'rolePile.png',
    prompt: 'prompt.md',
    ...(entry.tts ? { tts: entry.tts } : {}),
    emoticons: entry.emoticons.map((definition) => ({ ...definition }))
  }
}

/**
 * @description 将一个角色的远端文件集逐文件原子写入角色目录。
 * @param appDataRoot 应用数据根目录。
 * @param id 角色标识。
 * @param info 本次更新对应的本地角色信息文档。
 * @param bundle 已拉取的远端文件集。
 */
export async function writeCharacterFiles(
  appDataRoot: string,
  id: string,
  info: LocalCharacterInfo,
  bundle: RemoteCharacterBundle
): Promise<void> {
  const directory = getCharacterDirectoryPath(appDataRoot, id)
  await writeFileAtomic(join(directory, 'prompt.md'), bundle.prompt)
  await writeFileAtomic(join(directory, 'avatar.png'), bundle.avatar)
  await writeFileAtomic(join(directory, 'cardBg.png'), bundle.cardBg)
  await writeFileAtomic(join(directory, 'pixActivity.png'), bundle.pixActivity)
  await writeFileAtomic(join(directory, 'rolePile.png'), bundle.rolePile)
  if (bundle.voice) {
    await writeFileAtomic(join(directory, TTS_VOICE_FILE_NAME), bundle.voice)
  }
  for (const { definition, content } of bundle.emoticons) {
    await writeFileAtomic(join(directory, 'emoticons', definition.file), content)
  }
  await writeJsonFileAtomic(join(directory, 'info.json'), info)
}
