import type { LangfuseSpan, ObservationLevel } from '@langfuse/tracing'
import type { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import { app } from 'electron'
import { type TraceSettings } from '@gamechat/type'
import { DEFAULT_TRACE_BASE_URL } from '@gamechat/schema'
import { logger } from '../logging/index'
import { getUnifiedSettingsStore } from '../settings/index'
import {
  setTraceSink,
  type TraceAdapter,
  type TraceObservation
} from '@gamechat/core'

let nodeSdk: import('@opentelemetry/sdk-node').NodeSDK | null = null
let callbackHandler: import('@langfuse/langchain').CallbackHandler | null = null
let tracingModule: typeof import('@langfuse/tracing') | null = null
let activeConfig: TraceSettings | null = null

type TraceAttributes = {
  sessionId?: string
  input?: unknown
  metadata?: Record<string, unknown>
}

/** core 观察补写的参数类型。 */
type TraceObservationPatch = Parameters<TraceObservation['update']>[0]

/**
 * @description 把 core 的观察补写翻译为 Langfuse span 属性更新。
 * @param span 目标 Langfuse span。
 * @param patch core 传入的观察补写。
 * @returns 无返回值。
 * @remarks core 的 level 是自由字符串，Langfuse 只接受固定级别，非固定值回落 DEFAULT；
 *   未提供的字段不写入，避免把 undefined 覆写为有效值。
 */
function updateLangfuseSpan(span: LangfuseSpan, patch: TraceObservationPatch): void {
  span.update({
    ...(patch.input !== undefined ? { input: patch.input } : {}),
    ...(patch.output !== undefined ? { output: patch.output } : {}),
    ...(patch.metadata !== undefined ? { metadata: patch.metadata } : {}),
    ...(patch.level !== undefined ? { level: toObservationLevel(patch.level) } : {}),
    ...(patch.statusMessage !== undefined ? { statusMessage: patch.statusMessage } : {})
  })
}

/**
 * @description 把 core 的自由字符串级别映射为 Langfuse 观察级别。
 * @param level core 传入的级别字符串。
 * @returns Langfuse 观察级别；非固定值时回落 DEFAULT。
 */
function toObservationLevel(level: string): ObservationLevel {
  if (level === 'DEBUG' || level === 'DEFAULT' || level === 'WARNING' || level === 'ERROR') {
    return level
  }
  return 'DEFAULT'
}

/** 追踪启用期间的 core 适配：把引擎固定观测点接到 Langfuse SDK 上。 */
const activeTraceAdapter: TraceAdapter = {
  getCallbacks: () => getTraceCallbacks(),
  withTrace: (name, attributes, run) =>
    withTrace(name, attributes, (span) =>
      run(span ? { update: (patch) => updateLangfuseSpan(span, patch) } : null)
    ),
  recordEvent: (name, metadata) => recordTraceEvent(name, metadata)
}

/** 追踪关闭期间的 core 适配：引擎观测点直通执行业务回调，不产生追踪开销。 */
const disabledTraceAdapter: TraceAdapter = {
  getCallbacks: () => [],
  withTrace: (_name, _attributes, run) => run(null),
  recordEvent: () => undefined
}

/**
 * @description 判断当前构建形态是否允许加载 Langfuse 追踪运行时。
 * @returns 开发环境（非打包构建）返回 true；打包版不含 Langfuse SDK，始终返回 false。
 * @remarks Langfuse 相关 npm 包位于 devDependencies，不会被打进安装包，
 * 因此打包版必须避免任何对 SDK 的 require，否则会直接崩溃。
 */
function isTraceRuntimeAvailable(): boolean {
  return !app.isPackaged
}

/**
 * @description 判断追踪配置是否具备启用条件。
 * @param settings 待检查的追踪设置。
 * @returns 开关打开且公私钥均非空时返回 true。
 */
function isTraceConfigured(settings: TraceSettings): boolean {
  return settings.enabled && settings.publicKey !== '' && settings.secretKey !== ''
}

/**
 * @description 比较两份追踪配置是否完全一致，用于判断是否需要重载。
 * @param left 左侧配置。
 * @param right 右侧配置。
 * @returns 四个字段均相等时返回 true。
 */
function isSameTraceConfig(left: TraceSettings | null, right: TraceSettings): boolean {
  return Boolean(
    left &&
    left.enabled === right.enabled &&
    left.baseUrl === right.baseUrl &&
    left.publicKey === right.publicKey &&
    left.secretKey === right.secretKey
  )
}

/**
 * @description 按给定配置动态加载 Langfuse SDK 并启动 OpenTelemetry SDK 与回调处理器。
 * @param settings 已确认具备启用条件的追踪设置。
 * @remarks SDK 通过动态 import 懒加载并缓存模块引用，保证打包版在不触达该路径时永不 require；
 * 上报模式固定为 immediate，保证桌面应用随时退出时已产生的 span 不依赖退出时机补传。
 */
async function startTrace(settings: TraceSettings): Promise<void> {
  const [{ LangfuseSpanProcessor }, { NodeSDK }, { CallbackHandler }, tracing] = await Promise.all([
    import('@langfuse/otel'),
    import('@opentelemetry/sdk-node'),
    import('@langfuse/langchain'),
    import('@langfuse/tracing')
  ])
  const spanProcessor = new LangfuseSpanProcessor({
    publicKey: settings.publicKey,
    secretKey: settings.secretKey,
    baseUrl: settings.baseUrl || DEFAULT_TRACE_BASE_URL,
    exportMode: 'immediate'
  })
  const sdk = new NodeSDK({ spanProcessors: [spanProcessor] })
  sdk.start()
  nodeSdk = sdk
  callbackHandler = new CallbackHandler()
  tracingModule = tracing
  activeConfig = settings
  // SDK 就绪后才把引擎观测点接到 Langfuse，未启用时引擎走空实现适配。
  setTraceSink(activeTraceAdapter)
}

/**
 * @description 停止 Langfuse 追踪并释放 OpenTelemetry SDK 资源。
 * @remarks 关闭失败只记录日志，不向上抛出，避免阻塞设置保存或应用退出流程；
 *   引擎观测点同步切回空实现适配，关闭期间不再产生任何追踪。
 */
async function stopTrace(): Promise<void> {
  setTraceSink(disabledTraceAdapter)
  callbackHandler = null
  tracingModule = null
  activeConfig = null
  const sdk = nodeSdk
  nodeSdk = null
  if (!sdk) {
    return
  }
  try {
    await sdk.shutdown()
  } catch (error) {
    void logger.error('ai', 'trace-stop-failed', 'Failed to shut down Langfuse', {
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

/**
 * @description 读取当前设置并初始化 Langfuse 追踪；未启用、缺少密钥或处于打包构建时保持关闭。
 * @remarks 供应用启动流程调用；任何初始化失败都只记录日志，不影响聊天主流程。
 */
export async function initTrace(): Promise<void> {
  if (!isTraceRuntimeAvailable()) {
    return
  }
  try {
    const settings = (await getUnifiedSettingsStore().get()).app.trace
    if (!isTraceConfigured(settings)) {
      void logger.info(
        'ai',
        'trace-disabled',
        'Langfuse tracing is disabled or missing credentials'
      )
      return
    }
    await startTrace(settings)
  } catch (error) {
    void logger.error('ai', 'trace-init-failed', 'Failed to init Langfuse', {
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

/**
 * @description 按最新设置重载 Langfuse 追踪；配置未变化或处于打包构建时不做任何事。
 * @remarks 供应用设置保存流程调用；重载失败后追踪保持关闭，等待下次保存或重启再恢复。
 */
export async function reloadTrace(): Promise<void> {
  if (!isTraceRuntimeAvailable()) {
    return
  }
  try {
    const settings = (await getUnifiedSettingsStore().get()).app.trace
    if (isSameTraceConfig(activeConfig, settings)) {
      return
    }
    await stopTrace()
    if (!isTraceConfigured(settings)) {
      return
    }
    await startTrace(settings)
  } catch (error) {
    void logger.error('ai', 'trace-reload-failed', 'Failed to reload Langfuse', {
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

/**
 * @description 冲刷并关闭 Langfuse 追踪，确保退出前已产生的 span 尽量上报。
 * @remarks 供应用退出流程调用；实现为尽力而为，不阻塞退出。
 */
export async function shutdownTrace(): Promise<void> {
  await stopTrace()
}

/**
 * @description 返回当前追踪层是否已启用。
 * @returns Langfuse 回调处理器就绪时返回 true。
 */
export function isTraceEnabled(): boolean {
  return callbackHandler !== null
}

/**
 * @description 返回应附加到模型调用的 LangChain 回调列表。
 * @returns 启用时包含单例 CallbackHandler，未启用时返回空数组。
 */
export function getTraceCallbacks(): BaseCallbackHandler[] {
  return callbackHandler ? [callbackHandler] : []
}

/**
 * @description 在 Langfuse 中开启一个作为 trace 根的业务观察，并在其上下文中执行回调。
 * @param name 观察名称，例如 `chat-run`、`group-intent`。
 * @param attributes 附加到观察的会话与元数据。
 * @param run 在该观察上下文中执行的业务回调；入参为当前观察，未启用时为 null。
 * @returns 业务回调的执行结果。
 * @remarks 未启用时直接执行回调，不产生任何开销；回调抛出的异常会在观察上标记 ERROR 后原样上抛。
 */
export async function withTrace<T>(
  name: string,
  attributes: TraceAttributes,
  run: (observation: LangfuseSpan | null) => Promise<T>
): Promise<T> {
  const tracing = tracingModule
  if (!callbackHandler || !tracing) {
    return run(null)
  }
  try {
    return await tracing.startActiveObservation(name, async (observation) => {
      observation.update({
        ...(attributes.input !== undefined ? { input: attributes.input } : {}),
        ...(attributes.metadata ? { metadata: attributes.metadata } : {})
      })
      return tracing.propagateAttributes(
        attributes.sessionId ? { sessionId: attributes.sessionId } : {},
        async () => {
          try {
            return await run(observation)
          } catch (error) {
            observation.update({
              level: 'ERROR',
              statusMessage: error instanceof Error ? error.message : String(error)
            })
            throw error
          }
        }
      )
    })
  } catch (error) {
    void logger.error('ai', 'trace-failed', 'Langfuse trace wrapper failed', {
      name,
      error: error instanceof Error ? error.message : String(error)
    })
    throw error
  }
}

/**
 * @description 在当前活动 trace 下记录一个即时业务事件，例如群聊意图评分或发言者选择。
 * @param name 业务事件名，使用 kebab-case，如 group-intent-assessed。
 * @param metadata 事件载荷，须为可序列化的键值对象。
 * @remarks 当前没有活动 trace 时静默跳过，避免在 Langfuse 中产生孤立的根 trace；任何失败只记录日志。
 */
export function recordTraceEvent(name: string, metadata: Record<string, unknown>): void {
  const tracing = tracingModule
  if (!callbackHandler || !tracing || !tracing.getActiveTraceId()) {
    return
  }
  try {
    tracing.startObservation(name, { metadata }, { asType: 'event' }).end()
  } catch (error) {
    void logger.error('ai', 'trace-event-failed', 'Failed to record Langfuse event', {
      name,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}
