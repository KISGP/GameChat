import { mkdir, readFile, stat } from 'fs/promises'
import path from 'path'
import { logger } from '../../infra/log'
import {
  createKeyedLazyPromise,
  createSerialQueue,
  pathExists,
  writeFileAtomic,
  type SerialQueue
} from '../../infra'
import { getChatSessionStateCardPath } from '../paths'

/** 会话状态卡读取结果：全文与最近写入时间，不含设置页展示所需的会话层字段。 */
export type SessionStateCardContent = {
  /** 该卡归属的发言角色 ID。 */
  characterId: string
  /** 状态卡 Markdown 全文；尚无内容时为空串。 */
  content: string
  /** 最近写入时间（ISO 8601）；尚无文件时为 null。 */
  updatedAt: string | null
}

/**
 * @description 管理会话状态卡：跟会话走、按角色分卡，每份 Markdown 记录该角色在本会话剧情中的精确状态并由模型自编辑。
 * @remarks 状态卡文件位于会话目录内，随会话目录的删除一并移除；读取侧把内容视为不可信文本，
 *   仅做修剪不改结构。读取经按键惰性缓存，写入成功后失效对应键（缓存读写成对）；
 *   写入按会话串行执行，并行工具调用不会互相覆盖。import 本模块零副作用，单例经 getChatStateCardService。
 */
export class SessionStateCardService {
  /** 以状态卡文件路径为键的全文缓存；路径由已校验的 ownerId 与 sessionId 构造，天然唯一。 */
  private readonly cache = createKeyedLazyPromise<string, string>((filePath) =>
    this.readFromDisk(filePath)
  )
  /** 按会话串行化状态卡写入的队列，避免并行工具调用的读改写竞争。 */
  private readonly writeQueues = new Map<string, SerialQueue>()

  /**
   * @description 读取指定角色在会话中的状态卡 Markdown 全文。
   * @param ownerId 会话拥有者标识。
   * @param sessionId 会话标识。
   * @param characterId 发言角色标识。
   * @returns 状态卡全文；尚无内容时返回空串。
   */
  async getSessionCard(ownerId: string, sessionId: string, characterId: string): Promise<string> {
    return this.cache.get(getChatSessionStateCardPath(ownerId, sessionId, characterId))
  }

  /**
   * @description 在会话状态卡末尾追加一行并失效缓存。
   * @param ownerId 会话拥有者标识。
   * @param sessionId 会话标识。
   * @param characterId 发言角色标识。
   * @param entry 待追加的一行正文；首尾空白会被修剪。
   * @returns 追加后的状态卡全文。
   * @remarks 与整文替换统一进入按会话串行队列；状态卡为空时以该行初始化。
   */
  async appendSessionCard(
    ownerId: string,
    sessionId: string,
    characterId: string,
    entry: string
  ): Promise<string> {
    const trimmedEntry = entry.trim()
    return this.getWriteQueue(ownerId, sessionId, characterId).enqueue(async () => {
      const filePath = getChatSessionStateCardPath(ownerId, sessionId, characterId)
      const current = await this.cache.get(filePath)
      const next = current ? `${current}\n${trimmedEntry}` : trimmedEntry
      return this.persistSessionCard(filePath, next)
    }).promise
  }

  /**
   * @description 保存会话状态卡 Markdown 全文并失效缓存。
   * @param ownerId 会话拥有者标识。
   * @param sessionId 会话标识。
   * @param characterId 发言角色标识。
   * @param content 状态卡全文；首尾空白会被修剪。
   * @returns 保存后的状态卡全文。
   */
  async saveSessionCard(
    ownerId: string,
    sessionId: string,
    characterId: string,
    content: string
  ): Promise<string> {
    const trimmed = content.trim()
    return this.getWriteQueue(ownerId, sessionId, characterId).enqueue(() =>
      this.persistSessionCard(getChatSessionStateCardPath(ownerId, sessionId, characterId), trimmed)
    ).promise
  }

  /**
   * @description 读取指定角色在会话中的状态卡只读视图。
   * @param ownerId 会话拥有者标识。
   * @param sessionId 会话标识。
   * @param characterId 发言角色标识。
   * @returns 状态卡全文与最近写入时间；尚无文件时内容为空串、时间为 null。
   */
  async getSessionCardView(
    ownerId: string,
    sessionId: string,
    characterId: string
  ): Promise<SessionStateCardContent> {
    const filePath = getChatSessionStateCardPath(ownerId, sessionId, characterId)
    const content = await this.cache.get(filePath)
    if (!content) {
      return { characterId, content: '', updatedAt: null }
    }
    try {
      return { characterId, content, updatedAt: (await stat(filePath)).mtime.toISOString() }
    } catch (error) {
      void logger.warn(
        'ai',
        'session-state-card-stat-failed',
        'Failed to stat session state card; reported without updated time',
        {
          ownerId,
          sessionId,
          characterId,
          error: error instanceof Error ? error.message : String(error)
        }
      )
      return { characterId, content, updatedAt: null }
    }
  }

  /**
   * @description 把状态卡全文原子写盘并失效读取缓存。
   * @param filePath 状态卡文件路径。
   * @param content 已定稿的状态卡全文。
   * @returns 写入的状态卡全文。
   * @remarks 只应由按会话串行队列内的写入任务调用，保证写盘与缓存失效成对发生。
   */
  private async persistSessionCard(filePath: string, content: string): Promise<string> {
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFileAtomic(filePath, content)
    this.cache.invalidate(filePath)
    return content
  }

  /**
   * @description 从磁盘读取状态卡 Markdown。
   * @param filePath 状态卡文件路径。
   * @returns 状态卡全文；尚无文件或读取失败时返回空串。
   * @remarks 读取失败记日志并按空处理，不阻断回合。
   */
  private async readFromDisk(filePath: string): Promise<string> {
    if (!(await pathExists(filePath))) {
      return ''
    }
    try {
      return (await readFile(filePath, 'utf8')).trim()
    } catch (error) {
      void logger.error(
        'ai',
        'session-state-card-read-failed',
        'Failed to read session state card; treated as empty',
        { filePath, error: error instanceof Error ? error.message : String(error) }
      )
      return ''
    }
  }

  /**
   * @description 返回会话内单张角色卡的写入串行队列，懒创建。
   * @param ownerId 会话拥有者标识。
   * @param sessionId 会话标识。
   * @param characterId 发言角色标识。
   * @returns 该角色卡的串行队列。
   */
  private getWriteQueue(ownerId: string, sessionId: string, characterId: string): SerialQueue {
    const key = getChatSessionStateCardPath(ownerId, sessionId, characterId)
    let queue = this.writeQueues.get(key)
    if (!queue) {
      queue = createSerialQueue()
      this.writeQueues.set(key, queue)
    }
    return queue
  }
}

let stateCardServiceInstance: SessionStateCardService | null = null

/**
 * @description 获取进程内共享的会话状态卡服务。
 * @returns 惰性构造并缓存的 SessionStateCardService 单例。
 * @remarks import 本模块零副作用。
 */
export function getChatStateCardService(): SessionStateCardService {
  if (!stateCardServiceInstance) {
    stateCardServiceInstance = new SessionStateCardService()
  }
  return stateCardServiceInstance
}
