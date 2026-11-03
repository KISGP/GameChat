import { createSerialQueue } from '../../infra'
import { logger } from '../../infra/log'

/** @description 持久化写盘回调：队列只负责时序，落盘内容仍由 SessionStore 从内存快照读取。 */
export type SessionPersistQueueCallbacks = {
  persistSession: (sessionId: string) => Promise<void>
  persistGroups: () => Promise<void>
}

/**
 * @description 会话持久化时序器：串行队列保证写盘顺序。
 * @remarks 落盘只发生在回合提交、运行收尾与结构变更等时点，流式期间不产生写盘请求；
 *   队列中的每次写入都会在执行时读取最新内存快照，单次失败记录日志后允许后续保存继续。
 */
export class SessionPersistQueue {
  private readonly queue = createSerialQueue()
  private readonly pendingSessionIds = new Set<string>()

  /**
   * @description 创建持久化队列。
   * @param callbacks 实际写盘回调集合。
   */
  constructor(private readonly callbacks: SessionPersistQueueCallbacks) {}

  /**
   * @description 将会话保存请求加入串行队列，并统一记录保存失败。
   * @param sessionId 要保存的会话 ID。
   */
  scheduleSession(sessionId?: string): void {
    if (sessionId) {
      this.pendingSessionIds.add(sessionId)
    }
    this.enqueueSessions()
  }

  /**
   * @description 将群聊注册表写入串行持久化队列。
   */
  scheduleGroups(): void {
    void this.queue
      .enqueue(() => this.callbacks.persistGroups())
      .promise.catch((error) => {
        void logger.error('main', 'group-persist-failed', 'Failed to persist group chat registry', {
          error: error instanceof Error ? error.message : String(error)
        })
      })
  }

  /**
   * @description 等待队列中全部已排队的写盘任务执行完成。
   * @returns 队列排空后兑现的 Promise。
   * @remarks 供全量会话换出内存前调用：先冲刷在途写盘，再移除内存快照，避免排队任务
   *   执行时读不到快照而静默丢数据。
   */
  async flush(): Promise<void> {
    await this.queue.enqueue(async () => {}).promise
  }

  /**
   * @description 将一批会话写盘任务串接到队列尾部。
   * @remarks 失败会记录日志并允许后续保存继续执行。
   */
  private enqueueSessions(): void {
    const sessionIds = [...this.pendingSessionIds]
    this.pendingSessionIds.clear()
    if (sessionIds.length === 0) {
      return
    }
    void this.queue
      .enqueue(async () => {
        for (const sessionId of sessionIds) {
          await this.callbacks.persistSession(sessionId)
        }
      })
      .promise.catch((error) => {
        void logger.error('main', 'sessions-save-failed', 'Failed to save conversation sessions', {
          sessionIds,
          error: error instanceof Error ? error.message : String(error)
        })
      })
  }
}
