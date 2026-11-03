import {
  SystemMessage,
  ToolMessage,
  AIMessageChunk,
  type AIMessage,
  type BaseMessage
} from '@langchain/core/messages'
import type { MessageContent } from '@langchain/core/messages'
import type { FlowNodeRawExchange } from '@gamechat/type'
import { logger } from '../../infra/log'
import type {
  AgentTool,
  AgentToolCall,
  AgentToolContext,
  AgentToolResult
} from '../../tools'
import { AgentToolExecutor } from '../../tools'
import { AgentToolRegistry } from '../../tools'
import {
  buildRoutingSystemPrompt,
  contentToText,
  createChatModel,
  getTokenCalibration,
  joinPromptSections,
  parseJsonObject,
  resolveToolTrajectoryBudget,
  truncateToolTrajectory
} from '../model'
import { processChatImage } from '../media'
import { getChatHost } from '../host'
import { getTraceCallbacks } from '../../infra/trace'
import type { AgentLoopRuntime, TurnStateValue } from './turn-state'
import type { TurnEngineContext } from './context'

/** 路由步骤配置：自定义提示词。 */
export type RouteStepOptions = {
  /** 由流程解释器按流程变量插值后的路由基座文本，节点未配置模板时已在派发侧抛错；工具包路由规则与角色上下文仍会追加。 */
  systemPromptText: string
}

/**
 * @description 创建路由步骤：按预算调用绑定工具的模型并规范化工具调用。
 * @param context 回合引擎共享上下文。
 * @param options 步骤配置：并行调用开关与自定义提示词。
 * @returns 路由步骤函数。
 * @remarks 达到最大工具轮次时置 incomplete 并退出；本步骤不向用户流式输出文本。
 *   绑定的是应用当前启用的全部工具，流程不参与工具挑选。路由决策文本（决策理由与
 *   待执行调用）随步骤结果返回，供编排调试展示，不进入工具轨迹。
 */
/**
 * @description 把一次模型交换序列化为调试原始数据。
 * @param messages 发送给模型的输入消息。
 * @param response 模型响应消息。
 * @returns 角色与文本内容组成的请求序列，以及响应的文本与工具调用清单。
 * @remarks 供编排调试的「原始请求」弹窗展示未加工内容；消息取 LangChain 消息类型名作角色。
 */
export function serializeExchange(
  messages: readonly BaseMessage[],
  response: BaseMessage
): FlowNodeRawExchange {
  return {
    messages: messages.map((message) => ({
      role: message.getType(),
      content: contentToText(message.content)
    })),
    content: contentToText(response.content),
    toolCalls: ((response as AIMessage).tool_calls ?? []).map((call) => ({
      name: call.name,
      args: call.args ?? {}
    }))
  }
}

export function createRouteModelNode(context: TurnEngineContext, options: RouteStepOptions) {
  return async (
    state: TurnStateValue
  ): Promise<Partial<TurnStateValue> & { routeDecision?: string; routeRaw?: FlowNodeRawExchange }> => {
    const maxToolRounds = state.policy.maxToolRounds
    if (state.toolRounds >= maxToolRounds) {
      void logger.warn('ai', 'agent-tool-round-limit-reached', 'Agent tool round limit reached', {
        requestId: state.requestId,
        sessionId: state.sessionId,
        toolRounds: state.toolRounds
      })
      return { incomplete: true, pendingToolCalls: [] }
    }

    const signature = buildLoopSignature(state, options, maxToolRounds)
    const runtime =
      state.loopRuntime?.signature === signature
        ? state.loopRuntime
        : await createLoopRuntime(state, context, options, maxToolRounds, signature)
    if (runtime.definitions.length === 0 || !runtime.boundModel) {
      return { pendingToolCalls: [], loopRuntime: runtime }
    }
    const trajectory = truncateToolTrajectory(state.routingMessages, {
      maxTokens: resolveToolTrajectoryBudget({
        totalTokens: state.budget.wallTokens,
        systemReserveTokens: state.systemReserveTokens,
        historyEstimateTokens: state.historyEstimateTokens
      }),
      imageTokenEstimate: state.budget.imageTokenEstimate,
      calibration: getTokenCalibration().getCoefficient(state.modelConfig.modelId)
    })
    const messages: BaseMessage[] = [
      new SystemMessage(runtime.routingSystemPrompt),
      ...state.llmMessages,
      ...trajectory.messages
    ]
    const response = await runtime.boundModel.invoke(messages, { signal: state.abortSignal })
    const toolCalls = normalizeToolCalls(response, runtime.definitions)
    const routeDecision = contentToText(response.content)
    const routeRaw = serializeExchange(messages, response)
    if (toolCalls.length === 0) {
      return { pendingToolCalls: [], loopRuntime: runtime, routeDecision, routeRaw }
    }
    return {
      pendingToolCalls: toolCalls,
      routingMessages: [...state.routingMessages, createToolCallMessage(response, toolCalls)],
      toolRounds: state.toolRounds + 1,
      loopRuntime: runtime,
      routeDecision,
      routeRaw
    }
  }
}

/**
 * @description 创建工具执行步骤：执行待处理调用并把结果转回工具消息。
 * @param context 回合引擎共享上下文。
 * @returns 工具执行步骤函数。
 * @remarks 路由步骤已构建运行时时优先复用其执行器与策略；工具轨迹经回合状态的事件出口发出。
 *   执行范围就是路由步骤产出的全部待处理调用，应用启用的工具全部可用。
 */
export function createExecuteToolsNode(context: TurnEngineContext) {
  return async (state: TurnStateValue): Promise<Partial<TurnStateValue>> => {
    const maxToolRounds =
      state.loopRuntime?.maxToolRounds ?? state.policy.maxToolRounds
    // executeTools 不发起路由模型调用，路由基座文本留空占位。
    const signature = buildLoopSignature(state, { systemPromptText: '' }, maxToolRounds)
    const runtime =
      state.loopRuntime ??
      (await createLoopRuntime(state, context, { systemPromptText: '' }, maxToolRounds, signature))
    const toolContext = await buildAgentToolContext(state, context, runtime)
    const toolResults = await runtime.executor.executeParallel(
      state.pendingToolCalls,
      toolContext,
      state.toolRounds,
      (trace) => {
        state.emit({ type: 'tool-trace', characterId: state.characterId, trace })
      }
    )
    const nextMessages: BaseMessage[] = [
      ...state.routingMessages,
      ...toolResults.map(
        (result) =>
          new ToolMessage({
            tool_call_id: result.id,
            name: result.name,
            content: toToolMessageContent(result.result)
          })
      )
    ]
    return {
      routingMessages: truncateToolTrajectory(nextMessages, {
        maxTokens: resolveToolTrajectoryBudget({
          totalTokens: state.budget.wallTokens,
          systemReserveTokens: state.systemReserveTokens,
          historyEstimateTokens: state.historyEstimateTokens
        }),
        imageTokenEstimate: state.budget.imageTokenEstimate,
        calibration: getTokenCalibration().getCoefficient(state.modelConfig.modelId)
      }).messages,
      pendingToolCalls: [],
      loopRuntime: runtime
    }
  }
}

/**
 * @description 构造循环运行时签名：配置、策略或模型变化时重建工具绑定与执行器。
 * @param state 当前回合状态。
 * @param options 路由或工具执行步骤配置。
 * @param maxToolRounds 生效的工具轮次上限。
 * @returns 稳定的配置签名。
 */
function buildLoopSignature(
  state: TurnStateValue,
  options: RouteStepOptions,
  maxToolRounds: number
): string {
  return JSON.stringify({
    modelId: state.modelConfig.modelId,
    characterId: state.characterId,
    policy: state.policy,
    maxToolRounds,
    options
  })
}

/**
 * @description 组装回合作用域的循环运行时：工具包、执行器、绑定模型与路由提示词各构建一次。
 * @param state 当前回合状态。
 * @param context 回合引擎共享上下文。
 * @param options 步骤配置。
 * @param maxToolRounds 生效的工具轮次上限。
 * @param signature 运行时配置签名。
 * @returns 本回合循环内复用的运行时。
 * @remarks 策略、工具包与路由提示词在同签名步骤间复用；模型实例由模型工厂按生效配置复用。
 */
async function createLoopRuntime(
  state: TurnStateValue,
  context: TurnEngineContext,
  options: RouteStepOptions,
  maxToolRounds: number,
  signature: string
): Promise<AgentLoopRuntime> {
  const policy = state.policy
  const packages = await context.resolveToolPackages({ ...state, policy })
  const executor = new AgentToolExecutor(new AgentToolRegistry(packages))
  const definitions = executor.getDefinitions()
  if (definitions.length === 0) {
    return {
      signature,
      packages,
      executor,
      definitions,
      boundModel: null,
      routingSystemPrompt: '',
      policy,
      maxToolRounds
    }
  }

  const model = createChatModel(state.modelConfig, { callbacks: getTraceCallbacks() })
  if (!model.bindTools) {
    throw new Error('The configured chat model does not support native tool calling.')
  }
  const boundModel = model.bindTools(definitions, {
    parallel_tool_calls: true,
    tool_choice: 'auto'
  })
  const routingSystemPrompt = joinPromptSections(
    buildRoutingSystemPrompt({
      basePrompt: options.systemPromptText,
      packagePrompts: packages.map((toolPackage) => ({
        text: toolPackage.routingPrompt ?? ''
      })),
      characterName: state.character.name
    })
  )
  return {
    signature,
    packages,
    executor,
    definitions,
    boundModel,
    routingSystemPrompt,
    policy,
    maxToolRounds
  }
}

/**
 * @description 组装当前回合的 Agent 工具上下文。
 * @param state 当前回合状态。
 * @param context 回合引擎共享上下文。
 * @param runtime 本回合循环运行时（提供生效策略）。
 * @returns 工具执行与校验使用的上下文。
 * @remarks 图片资源仅在单角色回合开放；图片分析更新经事件出口交由 runtime 门面落库。
 */
async function buildAgentToolContext(
  state: TurnStateValue,
  context: TurnEngineContext,
  runtime: AgentLoopRuntime
): Promise<AgentToolContext> {
  const isGroupTurn = state.session.participants.length > 1
  return {
    character: state.character,
    session: state.session,
    policy: runtime.policy,
    abortSignal: state.abortSignal,
    imageResources: isGroupTurn
      ? undefined
      : {
          read: async (resourceId) => {
            const image = await context.sessionStore.readAttachment(state.sessionId, resourceId)
            if (!image) {
              return null
            }
            const appSettings = await getChatHost().getAppSettings()
            return {
              attachment: image.attachment,
              dataUrl: await processChatImage(image.dataUrl, appSettings.chatImageProcessing)
            }
          },
          updateAnalysis: async (resourceId, analysis) => {
            state.emit({ type: 'image-analysis', characterId: state.characterId, resourceId, analysis })
          }
        },
    emoticonResources: {
      read: async (id) =>
        state.userEmoticons.find((item) => item.id === id) ||
        state.characterEmoticons.find((item) => item.id === id) ||
        null
    }
  }
}

/**
 * @description 将 LangChain AI 消息中的工具调用转换为安全的执行参数。
 * @param message 模型返回的 AI 消息。
 * @param definitions 当前已注册的工具定义。
 * @returns 可并行执行的工具调用列表。
 */
function normalizeToolCalls(
  message: AIMessageChunk,
  definitions: AgentTool['definition'][]
): AgentToolCall[] {
  const nativeCalls = (message.tool_calls || [])
    .filter((call) => typeof call.id === 'string' && typeof call.name === 'string')
    .map((call) => ({
      id: call.id as string,
      name: call.name as string,
      args: call.args && typeof call.args === 'object' ? (call.args as Record<string, unknown>) : {}
    }))

  if (nativeCalls.length > 0) return nativeCalls
  const fallback = inferToolCallFromContent(message, definitions)
  if (fallback) {
    void logger.warn(
      'ai',
      'agent-tool-call-content-fallback',
      'Converted JSON content to a native tool call',
      {
        toolName: fallback.name
      }
    )
    return [fallback]
  }
  return []
}

/**
 * @description 为不支持原生 tool_calls 的兼容接口，从严格匹配的 JSON 内容中推断一个工具调用。
 * @param message 模型返回的 AI 消息。
 * @param definitions 当前已注册的工具定义。
 * @returns 唯一匹配的工具调用，否则返回 null。
 * @remarks 只有参数对象、必填字段和字段类型均匹配且候选工具唯一时才会回退，普通文本不会触发工具。
 */
function inferToolCallFromContent(
  message: AIMessageChunk,
  definitions: AgentTool['definition'][]
): AgentToolCall | null {
  const args = parseJsonObject(contentToText(message.content))
  if (!args) return null
  const candidates = definitions.filter((definition) => matchesToolArguments(definition, args))
  if (candidates.length !== 1) return null
  return { id: `content-fallback-${Date.now()}`, name: candidates[0].function.name, args }
}

/**
 * @description 判断 JSON 参数是否严格符合一个工具定义的必要字段和基础类型。
 * @param definition 工具定义。
 * @param args 待匹配的 JSON 参数。
 * @returns 参数匹配时返回 true。
 */
function matchesToolArguments(
  definition: AgentTool['definition'],
  args: Record<string, unknown>
): boolean {
  const schema = definition.function.parameters
  const required = Array.isArray(schema.required) ? schema.required : []
  if (!required.every((key) => typeof key === 'string' && key in args)) return false
  const properties = schema.properties
  if (!properties || typeof properties !== 'object') return false
  if (
    schema.additionalProperties === false &&
    Object.keys(args).some((key) => !(key in properties))
  )
    return false
  return Object.entries(args).every(([key, value]) => {
    const property = properties[key]
    if (!property || typeof property !== 'object') return false
    const type = (property as { type?: unknown }).type
    return type === undefined || typeMatches(value, type)
  })
}

/**
 * @description 检查 JSON 值是否符合工具 schema 的基础类型。
 * @param value 待检查的值。
 * @param type schema 类型。
 * @returns 类型匹配时返回 true。
 */
function typeMatches(value: unknown, type: unknown): boolean {
  if (type === 'string') return typeof value === 'string'
  if (type === 'array') return Array.isArray(value)
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value)
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'boolean') return typeof value === 'boolean'
  if (type === 'object') return Boolean(value && typeof value === 'object' && !Array.isArray(value))
  return false
}

/**
 * @description 构造与工具结果消息严格配对的路由消息。
 * @param response 原始 AI 消息。
 * @param calls 已归一化并将被执行的工具调用。
 * @returns 可与 ToolMessage 配对的 AI 消息。
 * @remarks 按归一化结果重建 tool_calls：原始响应中被过滤掉的畸形调用不进入消息，
 *   否则下一轮路由请求会出现「有 tool_call 无配对结果」而被严格校验的供应商拒绝。
 *   原生调用保留原文本 content；content 回退路径置空，避免模型在历史里看到自己输出的路由 JSON。
 */
function createToolCallMessage(response: AIMessageChunk, calls: AgentToolCall[]): AIMessageChunk {
  const isNativeCall = (response.tool_calls?.length ?? 0) > 0
  return new AIMessageChunk({
    content: isNativeCall ? response.content : '',
    tool_calls: calls.map((call) => ({
      id: call.id,
      name: call.name,
      args: call.args,
      type: 'tool_call' as const
    }))
  })
}

/**
 * @description 将结构化工具结果编码为模型可读取的 ToolMessage 内容。
 * @param result 工具执行结果。
 * @returns 稳定的 JSON 内容；多模态结果原样透传。
 */
function toToolMessageContent(result: AgentToolResult): MessageContent {
  if (Array.isArray(result.modelContent)) {
    return result.modelContent
  }
  return serializeToolResult(result)
}

/**
 * @description 将结构化工具结果编码为模型可读取的 JSON 内容。
 * @param result 工具执行结果。
 * @returns 稳定的 JSON 内容；序列化失败时返回可读错误。
 */
function serializeToolResult(result: AgentToolResult): string {
  try {
    return JSON.stringify(result)
  } catch (error) {
    return JSON.stringify({
      status: 'failed',
      error: `Unable to serialize tool result: ${error instanceof Error ? error.message : String(error)}`
    })
  }
}
