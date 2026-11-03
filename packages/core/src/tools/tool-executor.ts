import { logger } from '../infra/log'
import type { AgentTool, AgentToolCall, AgentToolContext, AgentToolResult } from './agent-types'
import type { AgentToolTrace } from './agent-policy'
import { AgentToolRegistry } from './tool-registry'

/** 工具执行治理配置：并发、超时与重试。 */
export type AgentToolExecutorOptions = {
  /** 同时执行的工具调用数量上限；缺省不限制。 */
  concurrency?: number
  /** 单次工具调用超时毫秒数；缺省不设超时。 */
  timeoutMs?: number
  /** 工具失败后的重试次数；缺省 0。 */
  retries?: number
}

/**
 * @description 执行已注册的 Agent 工具，并将失败或策略拒绝转换为模型可读取的结果。
 * @remarks 并发、超时与重试由构造参数控制；默认值与历史行为一致（全部并行、无超时、不重试）。
 */
export class AgentToolExecutor {
  /**
   * @description 创建基于能力工具注册表的执行器。
   * @param registry 当前 Agent 的工具注册表。
   * @param options 工具执行治理配置。
   */
  constructor(
    private readonly registry: AgentToolRegistry,
    private readonly options: AgentToolExecutorOptions = {}
  ) {}

  /**
   * @description 返回供模型绑定的全部工具定义。
   * @returns 可绑定到模型的工具定义。
   */
  getDefinitions(): AgentTool['definition'][] {
    return this.registry.getDefinitions()
  }

  /**
   * @description 按并发与重试策略执行同一轮工具调用，并先应用能力包的批量策略校验。
   * @param calls 模型请求的工具调用。
   * @param context 当前聊天与 Agent 上下文。
   * @param round 当前工具调用轮次。
   * @param onTrace 工具轨迹回调。
   * @returns 按模型调用 ID 对应的结构化工具结果，顺序与输入一致。
   * @remarks 并发上限只约束同时在飞的调用数量；重试只覆盖抛错与 failed 结果，rejected 不重试。
   *   中断信号一旦触发即停止后续重试与排队调用。
   */
  async executeParallel(
    calls: AgentToolCall[],
    context: AgentToolContext,
    round: number,
    onTrace?: (trace: AgentToolTrace) => void
  ): Promise<{ id: string; name: string; result: AgentToolResult }[]> {
    if (calls.length === 0) {
      return []
    }
    const rejections = this.registry.validateCalls(calls, context)
    const results = new Array<{ id: string; name: string; result: AgentToolResult }>(
      calls.length
    )
    const concurrency = Math.min(
      calls.length,
      Math.max(1, this.options.concurrency ?? calls.length)
    )
    let nextIndex = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        const index = nextIndex
        nextIndex += 1
        if (index >= calls.length) {
          return
        }
        const call = calls[index]
        results[index] = await this.executeOne(
          call,
          rejections.get(call.id),
          context,
          round,
          onTrace
        )
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()))
    return results
  }

  /**
   * @description 执行单个工具调用，并按配置重试。
   * @param call 工具调用。
   * @param rejection 能力包给出的拒绝结果；存在时直接返回，不执行工具。
   * @param context 当前聊天与 Agent 上下文。
   * @param round 当前工具调用轮次。
   * @param onTrace 工具轨迹回调。
   * @returns 单个工具调用的结构化结果。
   */
  private async executeOne(
    call: AgentToolCall,
    rejection: { message: string } | undefined,
    context: AgentToolContext,
    round: number,
    onTrace?: (trace: AgentToolTrace) => void
  ): Promise<{ id: string; name: string; result: AgentToolResult }> {
    context.abortSignal?.throwIfAborted()
    if (rejection) {
      onTrace?.({
        round,
        toolCallId: call.id,
        toolName: call.name,
        input: call.args,
        outputSummary: rejection.message,
        output: { status: 'rejected', error: rejection.message },
        status: 'rejected'
      })
      return {
        id: call.id,
        name: call.name,
        result: { status: 'rejected', error: rejection.message }
      }
    }

    const tool = this.registry.get(call.name)
    if (!tool) {
      return {
        id: call.id,
        name: call.name,
        result: { status: 'rejected', error: `Tool ${call.name} is not available.` }
      }
    }

    const attempts = Math.max(0, this.options.retries ?? 0) + 1
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      context.abortSignal?.throwIfAborted()
      try {
        const result = await this.runWithTimeout(
          () => tool.execute(call.args, context),
          context.abortSignal
        )
        context.abortSignal?.throwIfAborted()
        if (result.status === 'failed' && attempt < attempts - 1) {
          await this.delay(attempt, context.abortSignal)
          continue
        }
        onTrace?.({
          round,
          toolCallId: call.id,
          toolName: call.name,
          input: call.args,
          outputSummary: summarizeToolResult(result),
          output: result,
          status: result.status,
          sourceIds: result.sourceIds
        })
        return { id: call.id, name: call.name, result }
      } catch (error) {
        if (context.abortSignal?.aborted || isAbortError(error)) {
          throw error
        }
        if (attempt < attempts - 1) {
          await this.delay(attempt, context.abortSignal)
          continue
        }
        const message = error instanceof Error ? error.message : String(error)
        void logger.warn('ai', 'agent-tool-failed', 'Agent tool execution failed', {
          toolName: call.name,
          error: message
        })
        onTrace?.({
          round,
          toolCallId: call.id,
          toolName: call.name,
          input: call.args,
          outputSummary: message,
          output: { status: 'failed', error: message },
          status: 'failed'
        })
        return {
          id: call.id,
          name: call.name,
          result: { status: 'failed', error: message }
        }
      }
    }
    return {
      id: call.id,
      name: call.name,
      result: { status: 'failed', error: 'Tool execution exhausted retries.' }
    }
  }

  /**
   * @description 在配置的超时时间内执行一次工具调用。
   * @param run 工具执行函数。
   * @param signal 当前回合取消信号。
   * @returns 工具执行结果。
   * @remarks 未配置超时时直接执行；超时与中断都拒绝 Promise，工具自身若忽略信号仍会继续运行。
   */
  private async runWithTimeout<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const timeoutMs = this.options.timeoutMs
    if (!timeoutMs) {
      return run()
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error(`Tool execution timed out after ${timeoutMs} ms.`))
      }, timeoutMs)
      const onAbort = (): void => {
        cleanup()
        reject(signal?.reason instanceof Error ? signal.reason : new Error('Aborted'))
      }
      const cleanup = (): void => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      run().then(
        (value) => {
          cleanup()
          resolve(value)
        },
        (error: unknown) => {
          cleanup()
          reject(error)
        }
      )
    })
  }

  /**
   * @description 重试前的退避等待。
   * @param attempt 已失败的尝试序号（从 0 开始）。
   * @param signal 当前回合取消信号。
   * @returns 等待完成的 Promise；中断时立即拒绝。
   */
  private async delay(attempt: number, signal?: AbortSignal): Promise<void> {
    const waitMs = 200 * (attempt + 1)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        resolve()
      }, waitMs)
      const onAbort = (): void => {
        cleanup()
        reject(signal?.reason instanceof Error ? signal.reason : new Error('Aborted'))
      }
      const cleanup = (): void => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
      }
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }
}

/**
 * @description 判断错误是否为中断导致。
 * @param error 待检查错误。
 * @returns 中断错误返回 true。
 */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/**
 * @description 将结构化工具结果压缩为可写入 Agent 轨迹的摘要。
 * @param result 工具执行结果。
 * @returns 不超过 240 个字符的结果摘要。
 */
function summarizeToolResult(result: AgentToolResult): string {
  const serialized = JSON.stringify(result)
  return serialized.length > 240 ? `${serialized.slice(0, 237)}...` : serialized
}
