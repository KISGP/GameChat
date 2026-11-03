/**
 * @description core 追踪出口：模块级 sink，宿主注入实现，缺省 no-op。
 * @remarks 追踪生命周期归宿主应用层管理；core 只在引擎固定点位调用本模块的三个入口，
 *   不感知具体追踪供应商。宿主未注入时全部调用无开销。
 */
import type { BaseCallbackHandler } from '@langchain/core/callbacks/base'

/** 附加到追踪观察的属性。 */
export type TraceAttributes = {
  sessionId?: string
  input?: unknown
  metadata?: Record<string, unknown>
}

/** 追踪观察句柄：业务回调内用于补写输出或标记失败。 */
export type TraceObservation = {
  /** @description 更新观察的输出、元数据或失败状态；字段均可选。 */
  update: (patch: {
    input?: unknown
    output?: unknown
    metadata?: Record<string, unknown>
    level?: string
    statusMessage?: string
  }) => void
}

/** 追踪适配：宿主映射到各自追踪供应商的最小接口。 */
export type TraceAdapter = {
  /** @description 返回应附加到模型调用的 LangChain 回调列表；未启用时返回空数组。 */
  getCallbacks: () => BaseCallbackHandler[]
  /** @description 开启一个业务观察并在其上下文中执行回调；未启用时直接执行回调。 */
  withTrace: <T>(
    name: string,
    attributes: TraceAttributes,
    run: (observation: TraceObservation | null) => Promise<T>
  ) => Promise<T>
  /** @description 在当前活动 trace 下记录一个即时业务事件；无活动 trace 时静默跳过。 */
  recordEvent: (name: string, metadata: Record<string, unknown>) => void
}

const noopAdapter: TraceAdapter = {
  getCallbacks: () => [],
  withTrace: (_name, _attributes, run) => run(null),
  recordEvent: () => undefined
}

let adapter: TraceAdapter = noopAdapter

/**
 * @description 注入追踪适配，宿主自此承接引擎的追踪观测。
 * @param next 宿主追踪适配实现。
 */
export function setTraceSink(next: TraceAdapter): void {
  adapter = next
}

/**
 * @description 返回应附加到模型调用的追踪回调列表。
 * @returns 启用时包含宿主回调，未启用时返回空数组。
 */
export function getTraceCallbacks(): BaseCallbackHandler[] {
  return adapter.getCallbacks()
}

/**
 * @description 开启一个业务观察并在其上下文中执行回调。
 * @param name 观察名称，例如 `chat-run`、`group-intent`。
 * @param attributes 附加到观察的会话与元数据。
 * @param run 在该观察上下文中执行的业务回调；入参为当前观察，未启用时为 null。
 * @returns 业务回调的执行结果。
 * @remarks 未启用时直接执行回调；回调抛出的异常交由宿主适配在观察上标记后原样上抛。
 */
export async function withTrace<T>(
  name: string,
  attributes: TraceAttributes,
  run: (observation: TraceObservation | null) => Promise<T>
): Promise<T> {
  return adapter.withTrace(name, attributes, run)
}

/**
 * @description 在当前活动 trace 下记录一个即时业务事件。
 * @param name 业务事件名，使用 kebab-case，如 group-intent-assessed。
 * @param metadata 事件载荷，须为可序列化的键值对象。
 * @remarks 无活动 trace 时静默跳过，避免产生孤立的根 trace。
 */
export function recordTraceEvent(name: string, metadata: Record<string, unknown>): void {
  adapter.recordEvent(name, metadata)
}
