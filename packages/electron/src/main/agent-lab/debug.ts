/**
 * @description 编排调试后端：用 lab 当前画布流程跑一次临时会话，并推送流式与步骤事件。
 * @remarks 调试使用内存会话（不写真实聊天记录）、应用全部可开关工具与指定模型；
 *   工具仍执行真实副作用，界面必须提示 token 成本与外部写入风险。
 */
import type {
  FlowDebugCharacter,
  FlowDebugEvent,
  FlowDebugResult,
  FlowDebugStartRequest,
  FlowDebugToolTrace
} from '@gamechat/type'
import { AGENT_LAB_DEBUG_EVENT_CHANNEL } from '@gamechat/schema'
import { AGENT_POLICY_TOOL_PACKAGE_IDS, normalizeFlowPackage } from '@gamechat/schema'
import {
  SessionStore,
  createAgentLoopPolicy,
  createChatToolPackageResolver,
  findProviderModel,
  getChatHost,
  resolveContextBudget,
  resolveImageTokenEstimate,
  resolveModelConfig,
  runFlow,
  type ChatToolPackageResolver,
  type TurnStreamEvent
} from '@gamechat/core'
import {
  getCharacterEmoticons,
  getCharacterSummaryById
} from '../characters/index'
import { getProviders } from '../settings/index'
import { broadcastToAllWindows } from '../../broadcast'
import { handleLogged } from '../ipc/logged-handler'
import { logger } from '../logging/index'

/** 在途调试运行：requestId 到取消控制器。 */
const activeDebugRuns = new Map<string, AbortController>()

/** 调试运行不绑定的工具包：写入目标是真实用户数据文件的常驻包。 */
const DEBUG_EXCLUDED_TOOL_PACKAGE_IDS: ReadonlySet<string> = new Set([
  'chat-memory-tools',
  'state-card'
])

/**
 * @description 过滤调试运行不绑定的工具包。
 * @param packages 回合解析出的工具包清单。
 * @returns 剔除会写真实用户数据文件的工具包后的清单。
 * @remarks 编排调试本质是临时会话：memory 与状态卡工具的写入目标是真实用户数据文件，
 *   调试运行一律不绑定；萌娘百科的共享 HTTP 缓存不属于用户数据，保留。
 *   工具清单枚举与调试运行必须共用本过滤，保证节点展示与实际绑定一致。
 */
export function filterDebugToolPackages<T extends { id: string }>(packages: T[]): T[] {
  return packages.filter((toolPackage) => !DEBUG_EXCLUDED_TOOL_PACKAGE_IDS.has(toolPackage.id))
}

/**
 * @description 取消全部在途调试运行。
 * @returns 无返回值。
 * @remarks 接入应用退出链与编排窗口关闭：调试运行消耗模型 token，窗口或应用关闭后不应继续。
 */
export function cancelAllDebugRuns(): void {
  for (const controller of activeDebugRuns.values()) {
    controller.abort()
  }
}

/**
 * @description 注册编排调试域 IPC handler。
 */
export function registerAgentLabDebugIpc(): void {
  handleLogged(
    'agent-lab:debugStart',
    (_event, request: FlowDebugStartRequest) => debugStart(request),
    (request: FlowDebugStartRequest) => ({
      requestId: request?.requestId,
      characterCount: request?.characters?.length ?? 0
    })
  )
  handleLogged(
    'agent-lab:debugStop',
    (_event, requestId: string) => debugStop(requestId),
    (requestId: string) => ({ requestId })
  )
}

/**
 * @description 执行一次调试运行。
 * @param request 调试请求：画布流程、测试角色、输入与模型。
 * @returns 调试终态。
 * @remarks 请求画布在入口重新归一化，未保存的草稿也可运行；运行结束或失败都推送 run-finished。
 */
export async function debugStart(request: FlowDebugStartRequest): Promise<FlowDebugResult> {
  if (
    !request ||
    typeof request !== 'object' ||
    typeof request.requestId !== 'string' ||
    !request.requestId.trim()
  ) {
    throw new Error('Invalid debug request.')
  }
  if (typeof request.input !== 'string') {
    throw new Error('Invalid debug input.')
  }
  if (typeof request.modelId !== 'string' || !request.modelId.trim()) {
    throw new Error('Debug request requires a model.')
  }
  if (!Array.isArray(request.characters)) {
    throw new Error('Invalid debug character list.')
  }
  const flow = normalizeFlowPackage(request.flow)
  if (!flow) {
    throw new Error('Invalid flow package for debugging.')
  }
  const characters: FlowDebugCharacter[] = []
  const seenCharacterIds = new Set<string>()
  for (const item of request.characters) {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.id !== 'string' ||
      typeof item.name !== 'string' ||
      typeof item.prompt !== 'string'
    ) {
      continue
    }
    const id = item.id.trim()
    if (!id || seenCharacterIds.has(id)) {
      continue
    }
    seenCharacterIds.add(id)
    characters.push({
      id,
      name: item.name.trim(),
      prompt: item.prompt,
      ...(typeof item.sourceCharacterId === 'string' && item.sourceCharacterId
        ? { sourceCharacterId: item.sourceCharacterId }
        : {})
    })
  }
  if (characters.length < 1) {
    throw new Error('Debugging requires at least one character prompt node.')
  }
  const providers = await getProviders()
  const resolved = findProviderModel(providers, request.modelId)
  if (!resolved) {
    throw new Error(`Model not found: ${request.modelId}`)
  }
  const modelConfig = resolveModelConfig(resolved.provider, resolved.model)
  const controller = new AbortController()
  activeDebugRuns.set(request.requestId, controller)

  broadcastDebugEvent({ type: 'run-started', requestId: request.requestId })
  try {
    const participants = await Promise.all(
      characters.map(async (item) => {
        const source = item.sourceCharacterId
          ? await getCharacterSummaryById(item.sourceCharacterId).catch(
              async (error: unknown) => {
                await logger.warn(
                  'main',
                  'agent-lab-debug-source-character-missing',
                  'Debug source character is unavailable; falling back to the prompt-only character',
                  {
                    requestId: request.requestId,
                    characterId: item.sourceCharacterId,
                    error: error instanceof Error ? error.message : String(error)
                  }
                )
                return null
              }
            )
          : null
        return {
          character: {
            id: item.id,
            name: item.name || source?.name || '模拟角色',
            ...(source?.description ? { description: source.description } : {}),
            avatar: source?.avatar ?? '',
            ...(source?.cardBg ? { cardBg: source.cardBg } : {}),
            pixActivity: source?.pixActivity ?? '',
            rolePile: source?.rolePile ?? ''
          },
          prompt: item.prompt,
          ...(item.sourceCharacterId
            ? { sourceCharacterId: item.sourceCharacterId }
            : {})
        }
      })
    )
    const participantById = new Map(
      participants.map((participant) => [participant.character.id, participant])
    )
    const participantNames = Object.fromEntries(
      participants.map((participant) => [
        participant.character.id,
        participant.character.name
      ])
    )
    const sessionStore = new SessionStore({ persist: false })
    const target =
      characters.length === 1
        ? { ownerId: characters[0].id }
        : { ownerId: sessionStore.createGroup(characters.map((item) => item.id)).id }
    const appended = sessionStore.appendUserMessage({
      sessionId: null,
      target,
      segment: { type: 'text', text: request.input }
    })
    const policy = {
      ...createAgentLoopPolicy(),
      enabledToolPackageIds: [...AGENT_POLICY_TOOL_PACKAGE_IDS]
    }
    const toolResolver: ChatToolPackageResolver = createChatToolPackageResolver({
      world: getChatHost().getWorldSearch(),
      memory: getChatHost().getMemory()
    })
    await runFlow({
      flow,
      requestId: request.requestId,
      sessionId: appended.session.id,
      modelConfig,
      currentMessageIds: [appended.userMessage.id],
      participantNames,
      participants,
      sessionStore,
      chatContext: {
        getAgentPolicy: async () => policy,
        getFlow: async () => flow,
        getAgentToolNames: () => []
      },
      dependencies: {
        getCharacter: async (characterId) =>
          participantById.get(characterId)?.character ?? {
            id: characterId,
            name: characterId,
            avatar: '',
            pixActivity: '',
            rolePile: ''
          },
        getCharacterEmoticons: async (characterId) => {
          const source = participantById.get(characterId)?.sourceCharacterId
          if (!source) {
            return []
          }
          return getCharacterEmoticons(source).catch(
            async (error: unknown) => {
              await logger.warn(
                'main',
                'agent-lab-debug-emoticons-failed',
                'Failed to load source character emoticons for debugging',
                {
                  requestId: request.requestId,
                  characterId: source,
                  error: error instanceof Error ? error.message : String(error)
                }
              )
              return []
            }
          )
        },
        getCharacterPrompt: async (characterId) => ({
          characterId,
          prompt: participantById.get(characterId)?.prompt ?? ''
        })
      },
      resolveContextBudget: (contextWindow) => resolveDebugBudget(contextWindow),
      loadCurrentImages: async () => [],
      loadStateCardSections: async () => [],
      loadMemorySections: async (_session, characterId) => {
        const source = participantById.get(characterId)?.sourceCharacterId
        if (!source) {
          return []
        }
        const memory = getChatHost().getMemory()
        if (!memory.getSettings().enabled) {
          return []
        }
        const content = await memory.getCharacterMemory(source).catch(() => '')
        return content ? [`【长期记忆】\n${content}`] : []
      },
      compressBeforeTurn: async () => undefined,
      resolveToolPackages: async (state) =>
        filterDebugToolPackages(
          toolResolver.resolveToolPackages({
            policy: state.policy,
            isGroupTurn: characters.length > 1,
            hasEmoticonCatalog:
              state.userEmoticons.length > 0 || state.characterEmoticons.length > 0
          })
        ),
      emit: (event) => broadcastDebugEvent(toDebugEvent(event, request.requestId, participantNames)),
      abortSignal: controller.signal
    })
    const result: FlowDebugResult = { requestId: request.requestId, status: 'completed' }
    broadcastDebugEvent({ type: 'run-finished', requestId: request.requestId, result })
    return result
  } catch (error) {
    const aborted = controller.signal.aborted || isAbortError(error)
    const result: FlowDebugResult = {
      requestId: request.requestId,
      status: aborted ? 'aborted' : 'error',
      ...(aborted ? {} : { errorMessage: toErrorMessage(error) })
    }
    broadcastDebugEvent({ type: 'run-finished', requestId: request.requestId, result })
    return result
  } finally {
    activeDebugRuns.delete(request.requestId)
  }
}

/**
 * @description 停止一次在途调试运行。
 * @param requestId 调试请求标识。
 * @returns 找到并触发取消时返回 true。
 */
export function debugStop(requestId: string): boolean {
  const controller = activeDebugRuns.get(requestId)
  if (!controller) {
    return false
  }
  controller.abort()
  return true
}

/**
 * @description 解析调试运行使用的上下文预算。
 * @param contextWindow 模型窗口容量。
 * @returns 生效的上下文预算。
 */
async function resolveDebugBudget(
  contextWindow: number | undefined
): Promise<Awaited<ReturnType<typeof resolveContextBudget>>> {
  const appSettings = await getChatHost().getAppSettings()
  return resolveContextBudget({
    contextWindow,
    budgetRatio: appSettings.contextBudget.budgetRatio,
    imageTokenEstimate: resolveImageTokenEstimate(appSettings.chatImageProcessing)
  })
}

/**
 * @description 把引擎事件翻译为跨进程调试事件。
 * @param event 引擎事件。
 * @param requestId 调试运行标识，随全部变体下发供渲染层过滤。
 * @param names 角色 ID 到展示名的映射。
 * @returns 调试事件。
 */
function toDebugEvent(
  event: TurnStreamEvent,
  requestId: string,
  names: Record<string, string>
): FlowDebugEvent {
  switch (event.type) {
    case 'turn-started':
      return {
        type: 'turn-started',
        requestId,
        characterId: event.characterId,
        characterName: names[event.characterId] ?? event.characterId
      }
    case 'turn-committed':
      return { type: 'turn-committed', requestId, characterId: event.characterId }
    case 'token':
      return { type: 'token', requestId, characterId: event.characterId, text: event.text }
    case 'tool-trace':
      return {
        type: 'tool-trace',
        requestId,
        trace: toDebugToolTrace(event.characterId, event.trace)
      }
    case 'image-analysis':
      return {
        type: 'image-analysis',
        requestId,
        characterId: event.characterId,
        resourceId: event.resourceId,
        analysis: event.analysis
      }
    case 'character-state':
      return {
        type: 'character-state',
        requestId,
        characterId: event.characterId,
        state: event.state
      }
    case 'node-enter':
      return { type: 'node-enter', requestId, nodeId: event.nodeId, nodeType: event.nodeType }
    case 'node-exit':
      return { type: 'node-exit', requestId, nodeId: event.nodeId }
    case 'node-output':
      return {
        type: 'node-output',
        requestId,
        nodeId: event.nodeId,
        text: event.text,
        ...(event.raw ? { raw: event.raw } : {})
      }
    case 'variables':
      return { type: 'variables', requestId, variables: event.variables }
    case 'context-usage':
      return { type: 'context-usage', requestId, characterId: event.characterId, usage: event.usage }
  }
}

/**
 * @description 把内部工具轨迹转换为调试界面使用的跨进程形状。
 * @param characterId 发言角色 ID。
 * @param trace 引擎工具轨迹。
 * @returns 调试工具轨迹。
 */
function toDebugToolTrace(
  characterId: string,
  trace: {
    round: number
    toolCallId: string
    toolName: string
    input: Record<string, unknown>
    outputSummary: string
    output?: unknown
    status: 'completed' | 'failed' | 'rejected'
  }
): FlowDebugToolTrace {
  return {
    characterId,
    round: trace.round,
    toolCallId: trace.toolCallId,
    toolName: trace.toolName,
    input: trace.input,
    outputSummary: trace.outputSummary,
    ...(trace.output !== undefined ? { output: trace.output } : {}),
    status: trace.status
  }
}

/**
 * @description 向全部窗口广播一条调试事件。
 * @param event 调试事件。
 * @returns 无返回值。
 */
function broadcastDebugEvent(event: FlowDebugEvent): void {
  broadcastToAllWindows(AGENT_LAB_DEBUG_EVENT_CHANNEL, event)
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
 * @description 将未知错误转换为可展示文本。
 * @param error 待转换错误。
 * @returns 错误消息文本。
 */
function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
