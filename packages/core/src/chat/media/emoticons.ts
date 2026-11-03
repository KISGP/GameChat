import { createSingleLazyPromise, readImageDataUrl, pathExists } from '../../infra'
import { logger } from '../../infra/log'
import { getChatHost } from '../host'
import { CHAT_USER_EMOTICONS, type ChatEmoticonImage } from '@gamechat/schema'
import { join } from 'path'

const userEmoticons = createSingleLazyPromise<ChatEmoticonImage[]>(async () =>
  Promise.all(
    CHAT_USER_EMOTICONS.map(async (definition) => {
      const filePath = join(getChatHost().bundledEmoticonsRoot(), definition.file)
      if (!(await pathExists(filePath))) {
        await logger.warn('main', 'user-emoticon-missing', 'Bundled user emoticon is missing', {
          emoticonId: definition.id,
          file: definition.file
        })
        return { id: definition.id, description: definition.description, unavailable: true }
      }
      try {
        return {
          id: definition.id,
          description: definition.description,
          dataUrl: await readImageDataUrl(filePath)
        }
      } catch (error) {
        await logger.warn(
          'main',
          'user-emoticon-read-failed',
          'Failed to read bundled user emoticon',
          {
            emoticonId: definition.id,
            file: definition.file,
            error: error instanceof Error ? error.message : String(error)
          }
        )
        return { id: definition.id, description: definition.description, unavailable: true }
      }
    })
  )
)

/**
 * @description 读取应用内置的用户表情图片清单。
 * @returns 用户表情定义及 Data URL；文件缺失时返回占位状态。
 */
export function getUserEmoticons(): Promise<ChatEmoticonImage[]> {
  return userEmoticons.get()
}

/**
 * @description 按 ID 读取一个应用内置用户表情。
 * @param id 表情全局唯一 ID。
 * @returns 匹配的表情图片；不存在时返回 null。
 */
export async function readUserEmoticon(id: string): Promise<ChatEmoticonImage | null> {
  const image = (await getUserEmoticons()).find((item) => item.id === id)
  return image || null
}
