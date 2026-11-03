export type ActiveRun = {
  controller: AbortController
  sessionId: string
  messageId: string
  startedAt: number
  chunkCount: number
  charCount: number
}

export class RunRegistry {
  private readonly activeRuns = new Map<string, ActiveRun>()

  /**
   * @description 为一次运行创建中止控制器并登记到注册表。
   * @param requestId 运行请求标识。
   * @param sessionId 运行所属会话 ID。
   * @param messageId 本次运行写入的 assistant 消息 ID。
   * @returns 新登记的运行记录。
   */
  register(requestId: string, sessionId: string, messageId: string): ActiveRun {
    const activeRun: ActiveRun = {
      controller: new AbortController(),
      sessionId,
      messageId,
      startedAt: Date.now(),
      chunkCount: 0,
      charCount: 0
    }

    this.activeRuns.set(requestId, activeRun)
    return activeRun
  }

  /**
   * @description 读取指定请求的运行记录。
   * @param requestId 运行请求标识。
   * @returns 运行记录；未登记时返回 `undefined`。
   */
  get(requestId: string): ActiveRun | undefined {
    return this.activeRuns.get(requestId)
  }

  /**
   * @description 向指定请求的运行发出中止信号。
   * @param requestId 运行请求标识。
   * @returns 收到中止信号的运行记录；未登记时返回 `undefined`。
   * @remarks 只发信号不注销，注销由运行收尾流程调用 delete 完成。
   */
  abort(requestId: string): ActiveRun | undefined {
    const activeRun = this.activeRuns.get(requestId)
    activeRun?.controller.abort()
    return activeRun
  }

  /**
   * @description 中止指定会话当前仍在注册表中的运行。
   * @param sessionId 目标会话 ID。
   * @returns 被中止的运行；不存在时返回 `undefined`。
   */
  abortBySession(sessionId: string): ActiveRun | undefined {
    const entry = [...this.activeRuns.entries()]
      .reverse()
      .find(([, run]) => run.sessionId === sessionId && !run.controller.signal.aborted)
    if (!entry) return undefined
    entry[1].controller.abort()
    return entry[1]
  }

  /**
   * @description 判断会话当前是否存在尚未结束的运行。
   * @param sessionId 目标会话 ID。
   * @returns 存在仍在执行的运行时返回 `true`。
   * @remarks 这是会话派生运行态（running）的唯一事实来源；会话存储经活性谓词读取本判定。
   */
  hasLiveRun(sessionId: string): boolean {
    return [...this.activeRuns.values()].some(
      (run) => run.sessionId === sessionId && !run.controller.signal.aborted
    )
  }

  /**
   * @description 中止当前注册表中的所有聊天运行。
   * @returns 已收到中止信号的运行快照。
   */
  abortAll(): ActiveRun[] {
    const activeRuns = [...this.activeRuns.values()]
    activeRuns.forEach((activeRun) => activeRun.controller.abort())
    return activeRuns
  }

  /**
   * @description 累计一次流式输出的分片数与字符数。
   * @param requestId 运行请求标识。
   * @param chunk 本次收到的流式文本。
   * @returns 更新后的运行记录；未登记时返回 `undefined`。
   */
  trackChunk(requestId: string, chunk: string): ActiveRun | undefined {
    const activeRun = this.activeRuns.get(requestId)
    if (!activeRun) {
      return undefined
    }

    activeRun.chunkCount += 1
    activeRun.charCount += chunk.length
    return activeRun
  }

  /**
   * @description 从注册表注销指定请求的运行。
   * @param requestId 运行请求标识。
   * @remarks 注销后该会话的派生运行态随之结束；本方法不会发出中止信号。
   */
  delete(requestId: string): void {
    this.activeRuns.delete(requestId)
  }
}
