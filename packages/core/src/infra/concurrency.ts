/**
 * @description core 并发原语：惰性缓存、single-flight 与串行队列。
 * @remarks 主应用与 core 共用的完整集合；
 *   settings/world 等既有域经 infra/fs 的再导出继续消费 createSingleLazyPromise。
 */

/**
 * @description 创建单槽惰性 Promise 缓存：首次读取执行 loader 并缓存结果，失败时丢弃缓存。
 * @param loader 用于生成值的异步函数，仅在缓存缺失时调用。
 * @returns 提供 get 与 invalidate 的单槽缓存。
 * @remarks loader 被并发调用时会共享同一次执行；失败的 Promise 不缓存，下一次 get 会重试。
 */
export function createSingleLazyPromise<V>(loader: () => Promise<V>): {
  get(): Promise<V>
  invalidate(): void
} {
  let cached: Promise<V> | null = null
  return {
    get(): Promise<V> {
      if (!cached) {
        cached = loader().catch((error: unknown) => {
          cached = null
          throw error
        })
      }
      return cached
    },
    invalidate(): void {
      cached = null
    }
  }
}

/**
 * @description 创建按键惰性 Promise 缓存：每个键独立缓存并共享并发读取，失败的键自动失效。
 * @param loader 根据键生成值的异步函数，仅在对应键缓存缺失时调用。
 * @returns 提供 get 与 invalidate 的按键缓存。
 * @remarks invalidate 不传键时清空全部缓存；失败 Promise 不缓存，同键下一次 get 会重试。
 */
export function createKeyedLazyPromise<K, V>(
  loader: (key: K) => Promise<V>
): {
  get(key: K): Promise<V>
  invalidate(key?: K): void
} {
  const entries = new Map<K, Promise<V>>()
  return {
    get(key: K): Promise<V> {
      const cached = entries.get(key)
      if (cached) return cached
      const pending = loader(key).catch((error: unknown) => {
        if (entries.get(key) === pending) entries.delete(key)
        throw error
      })
      entries.set(key, pending)
      return pending
    },
    invalidate(key?: K): void {
      if (key === undefined) entries.clear()
      else entries.delete(key)
    }
  }
}

/**
 * @description 创建 single-flight 并发控制：运行期间重复触发共享同一次执行，结束后自动复位。
 * @returns 提供 run 与 isRunning 的 single-flight 控制器。
 * @remarks 任务失败同样会复位；所有等待方共享同一个包含失败的 Promise。
 */
export function createSingleFlight<T>(): {
  run(task: () => Promise<T>): Promise<T>
  isRunning(): boolean
} {
  let current: Promise<T> | null = null
  return {
    run(task: () => Promise<T>): Promise<T> {
      if (current) return current
      current = task().finally(() => {
        current = null
      })
      return current
    },
    isRunning(): boolean {
      return current !== null
    }
  }
}

/** 串行队列任务句柄：暴露任务结果并支持开始前取消。 */
export type SerialQueueHandle<T> = {
  /** 当前任务完成（或失败、取消）后 resolve 的 Promise。 */
  promise: Promise<T>
  /** @description 任务尚未开始时取消执行并使 promise 以错误 reject；已开始时返回 false。 */
  cancel(): boolean
}

/** 串行队列：按入队顺序执行任务。 */
export type SerialQueue = {
  /** @description 将任务追加到队列尾部，前序任务结束后串行执行。 */
  enqueue<T>(task: () => Promise<T>): SerialQueueHandle<T>
}

/**
 * @description 创建失败隔离的串行任务队列：任务按入队顺序执行，单个任务失败不阻塞后续任务。
 * @returns 串行队列实例。
 * @remarks 被取消的任务以错误 reject 其对外 Promise，但队列链路本身不受任何任务失败影响。
 */
export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    enqueue<T>(task: () => Promise<T>): SerialQueueHandle<T> {
      let started = false
      let cancelled = false
      let resolveTask!: (value: T) => void
      let rejectTask!: (reason?: unknown) => void
      const promise = new Promise<T>((resolve, reject) => {
        resolveTask = resolve
        rejectTask = reject
      })
      const link = tail.then(async () => {
        if (cancelled) {
          rejectTask(new Error('Task was cancelled before it started'))
          return
        }
        started = true
        try {
          resolveTask(await task())
        } catch (error) {
          rejectTask(error)
        }
      })
      tail = link.catch(() => undefined)
      return {
        promise,
        cancel(): boolean {
          if (started || cancelled) return false
          cancelled = true
          return true
        }
      }
    }
  }
}
