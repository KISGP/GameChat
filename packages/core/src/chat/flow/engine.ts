/**
 * @description 声明式流程引擎：解释执行完整流程包，覆盖选人、回合生命周期与生成段。
 * @remarks 单聊与群聊共用同一解释器：推进循环、出边求值与变量作用域接受「回合状态 / 运行状态」
 *   两种输入，选人阶段不需要已打开的回合。引擎不依赖 LangGraph 运行时，事件统一经注入的
 *   emit 出口发出；流程结构合法即执行，走完仍未提交回合按阶段守卫失败。
 */
import { HumanMessage, SystemMessage, AIMessage, type BaseMessage } from '@langchain/core/messages'
import type {
  ChatImageInput,
  ConversationSession,
  FlowBranchValue,
  FlowNode,
  FlowNodeRawExchange,
  FlowPackage,
  FlowSelectionSource,
  FlowStepConfig
} from '@gamechat/type'
import type { ResolvedModelConfig } from '@gamechat/type'
import {
  FLOW_BUILTIN_VARIABLES,
  FLOW_FINAL_ANSWER_SECTION_VARIABLES,
  FLOW_INTENT_TEMPLATE_VARIABLES,
  interpolateTemplate,
  matchConditionValue,
  type InterpolateScope
} from '@gamechat/schema'
import { logger } from '../../infra/log'
import { getTraceCallbacks, recordTraceEvent, withTrace } from '../../infra/trace'
import type { AgentToolCall, AgentToolPackage } from '../../tools'
import {
  assertSafeParticipantName,
  buildFinalAnswerRuntimeSections,
  buildSummarySectionText,
  contentToText,
  createChatModel,
  findCurrentInputText,
  getTokenCalibration,
  joinPromptSections,
  parseIntentScore,
  resolveToolTrajectoryBudget,
  truncateToolTrajectory,
  type ContextBudget
} from '../model'
import { MAX_TOOL_ROUNDS } from '../loop-policy'
import {
  createExecuteToolsNode,
  createRouteModelNode,
  serializeExchange,
  type RouteStepOptions
} from '../engine/agent-loop'
import type { TurnEngineContext } from '../engine/context'
import { buildHistoryOmittedSectionText, createFinalAnswerNode } from '../engine/steps'
import { createTurnLifecycle, type TurnLifecycle } from '../engine/turn-lifecycle'
import type { TurnStateValue, TurnStreamEvent } from '../engine/turn-state'
import type { SessionStore } from '../session'
import type {
  ChatContextProvider,
  ChatRuntimeDependencies,
  ScheduledParticipant,
  TurnOutcome
} from '../types'
import { buildFlowScope, readCurrentUserText, type FlowScopeExtras } from './scope'
import { selectSpeaker } from './selection'

/** 流程运行输入：一次聊天运行内不变的数据与宿主回调。 */
export type FlowRunInput = {
  flow: FlowPackage
  requestId: string
  sessionId: string
  modelConfig: ResolvedModelConfig
  currentMessageIds: string[]
  participantNames: Record<string, string>
  participants: ScheduledParticipant[]
  sessionStore: SessionStore
  chatContext: ChatContextProvider
  dependencies: ChatRuntimeDependencies
  /**
   * @description 解析当前回合生效的上下文预算。
   * @param contextWindow 生效模型条目配置的窗口容量。
   * @returns 生效的上下文预算。
   */
  resolveContextBudget: (contextWindow: number | undefined) => Promise<ContextBudget>
  /** @description 读取当前轮次的实时图片。 */
  loadCurrentImages: (sessionId: string, messageIds: string[]) => Promise<ChatImageInput[]>
  /** @description 加载当前发言角色的状态卡段。 */
  loadStateCardSections: (
    session: ConversationSession,
    characterId: string
  ) => Promise<string[]>
  /** @description 加载当前发言角色的记忆段。 */
  loadMemorySections: (session: ConversationSession, characterId: string) => Promise<string[]>
  /** @description 回合前压缩。 */
  compressBeforeTurn: (sessionId: string) => Promise<void>
  /** @description 按生效策略解析对模型可见的工具包。 */
  resolveToolPackages: (state: TurnStateValue) => Promise<AgentToolPackage[]>
  /** 引擎事件出口。 */
  emit: (event: TurnStreamEvent) => void
  /** 当前运行的取消信号。 */
  abortSignal: AbortSignal
}

/**
 * @description 执行一次完整聊天运行。
 * @param input 流程包、运行上下文与宿主回调。
 * @returns 运行结果；失败与中断以异常形式抛出，由运行时门面包容。
 * @remarks 单聊与群聊共用同一份通用流程，行为差异由流程内的人数分支表达；
 *   群聊运行包一层 group-conversation trace，并逐段记录 character-turn-start/end。
 */
export async function runFlow(input: FlowRunInput): Promise<TurnOutcome> {
  const isGroup = input.participants.length > 1
  if (isGroup) {
    for (const participant of input.participants) {
      assertSafeParticipantName(participant.character.name)
    }
  }
  return withTrace(
    isGroup ? 'group-conversation' : 'character-turn',
    {
      sessionId: input.sessionId,
      metadata: {
        requestId: input.requestId,
        modelId: input.modelConfig.modelId
      }
    },
    async () => {
      const machine = new FlowMachine(input)
      await machine.run()
      return { status: 'completed' as const }
    }
  )
}

/** 判断节点可能消费的回合级内置变量：判断这些变量前必须先装配回合。 */
const TURN_LEVEL_VARIABLES = new Set<string>([
  FLOW_BUILTIN_VARIABLES.hasTools,
  FLOW_BUILTIN_VARIABLES.pendingToolCalls,
  FLOW_BUILTIN_VARIABLES.incomplete,
  FLOW_BUILTIN_VARIABLES.characterName
])

/**
 * @description 流程执行机：持有运行级状态（变量、已发言集合、选人结果）与当前回合状态。
 * @remarks 一次 run 构造一个实例；回合状态在第一个需要回合的步骤前自动建立，终答完成后自动提交，
 *   流程结束后仍有打开回合视为结构性错误。
 */
class FlowMachine {
  private turn: TurnStateValue | null = null
  private readonly variables: Record<string, string> = {}
  private readonly spoken = new Set<string>()
  private nextSpeakerId = ''
  private selectionSource: FlowSelectionSource | '' = ''
  private lastSpeakerId = ''
  private committedTurns = 0
  /** 本运行是否执行过工具调用节点：tools_executed 内置变量的取值依据。 */
  private toolsExecuted = false
  /** 最近一次判断节点的求值结果：true 满足 / false 不满足，供分支选边使用。 */
  private lastBranch: FlowBranchValue = 'true'
  private readonly lifecycle: TurnLifecycle
  private readonly context: TurnEngineContext
  private readonly stepLimit: number

  /**
   * @description 组装执行机：创建回合生命周期与步骤共享上下文。
   * @param input 流程运行输入。
   */
  constructor(private readonly input: FlowRunInput) {
    this.lifecycle = createTurnLifecycle({
      requestId: input.requestId,
      sessionId: input.sessionId,
      modelConfig: input.modelConfig,
      currentMessageIds: input.currentMessageIds,
      participantNames: input.participantNames,
      sessionStore: input.sessionStore,
      chatContext: input.chatContext,
      dependencies: input.dependencies,
      loadCurrentImages: input.loadCurrentImages,
      resolveContextBudget: input.resolveContextBudget,
      loadStateCardSections: input.loadStateCardSections,
      loadMemorySections: input.loadMemorySections,
      compressBeforeTurn: input.compressBeforeTurn,
      emit: input.emit,
      abortSignal: input.abortSignal
    })
    this.context = {
      dependencies: input.dependencies,
      chatContext: input.chatContext,
      sessionStore: input.sessionStore,
      loadCurrentImages: input.loadCurrentImages,
      resolveContextBudget: input.resolveContextBudget,
      loadStateCardSections: input.loadStateCardSections,
      loadMemorySections: input.loadMemorySections,
      compressBeforeTurn: input.compressBeforeTurn,
      resolveToolPackages: input.resolveToolPackages
    }
    this.stepLimit = flowStepLimit(input.participants.length)
  }

  /**
   * @description 从入口开始推进流程图，直到没有命中出边。
   * @returns 推进完成的 Promise。
   * @remarks 每步前后检查取消信号；步数超限、节点缺失、结束仍有打开回合或单聊未产出回合都抛错。
   */
  async run(): Promise<void> {
    const graph = this.input.flow.graph
    if (this.input.participants.length > 1) {
      recordTraceEvent('group-schedule-started', {
        sessionId: this.input.sessionId,
        participantIds: this.input.participants.map(
          (participant) => participant.character.id
        )
      })
    }
    let cursor: string | null = graph.entry
    let executed = 0
    while (cursor) {
      this.input.abortSignal.throwIfAborted()
      if (executed >= this.stepLimit) {
        throw new Error(
          `Flow step limit reached after ${executed} steps: ${this.input.flow.id}`
        )
      }
      const node = graph.nodes.find((item) => item.id === cursor)
      if (!node) {
        throw new Error(`Flow node not found: ${cursor}`)
      }
      executed += 1
      this.input.emit({ type: 'node-enter', nodeId: node.id, nodeType: node.type })
      await this.dispatch(node)
      if (node.type === 'executeTools') {
        this.toolsExecuted = true
      }
      this.input.abortSignal.throwIfAborted()
      this.input.emit({ type: 'node-exit', nodeId: node.id })
      this.input.emit({ type: 'variables', variables: this.currentScope().variables })
      cursor = this.pickNextEdge(node.id)
    }
    if (this.turn) {
      throw new Error('Flow ended with an open turn.')
    }
    if (this.input.participants.length === 1 && this.committedTurns === 0) {
      throw new Error('Single-participant flow ended without a committed turn.')
    }
  }

  /**
   * @description 按节点类型执行一步。
   * @param node 当前流程节点。
   * @returns 执行完成的 Promise。
   * @remarks 模型步骤按节点配置重试；工具执行的重试在 AgentToolExecutor 内部完成。
   */
  private async dispatch(node: FlowNode): Promise<void> {
    const config = node.config ?? {}
    switch (node.type) {
      case 'selectSpeaker': {
        await this.dispatchSelectSpeaker(node, config)
        return
      }
      case 'condition': {
        await this.dispatchCondition(config)
        return
      }
      case 'environmentInput':
        return
      case 'route': {
        await this.dispatchRoute(node, config)
        return
      }
      case 'executeTools': {
        await this.dispatchExecuteTools(node)
        return
      }
      case 'display':
        return
      case 'finalAnswer': {
        await this.dispatchFinalAnswer(node, config)
        return
      }
      case 'llm': {
        await this.dispatchLlm(node, config)
        return
      }
      case 'intent': {
        await this.dispatchIntent(node, config)
        return
      }
    }
  }

  /**
   * @description 执行判断步骤：对指定变量求值比较条件，结果决定走「满足」或「不满足」分支。
   * @param config 节点配置：变量、比较操作符与比较值。
   * @returns 判断完成的 Promise。
   * @remarks 判断可能消费回合级变量（has_tools、pending_tool_calls 等），回合未打开时先装配；
   *   比较值语义与 `matchConditionValue` 一致，分支未连线时流程在选边阶段结束。
   */
  private async dispatchCondition(config: FlowStepConfig): Promise<void> {
    if (this.turn === null && config.variable && TURN_LEVEL_VARIABLES.has(config.variable)) {
      await this.ensureTurn()
    }
    const satisfied = matchConditionValue(
      { variable: config.variable ?? '', op: config.op, value: config.value },
      this.currentScope()
    )
    this.lastBranch = satisfied ? 'true' : 'false'
  }

  /**
   * @description 读取节点配置的提示词模板，空白时抛错。
   * @param node 流程节点。
   * @param config 节点配置。
   * @returns 去除首尾空白后的提示词模板。
   * @remarks 提示词由流程图节点单方提供，引擎不做内置默认替换；空白模板说明流程包不完整，
   *   运行期失败并指明节点，保证画布内容与实际下发的提示词一致。
   */
  private requireStepPromptTemplate(node: FlowNode, config: FlowStepConfig): string {
    const template = config.systemPromptTemplate?.trim()
    if (!template) {
      throw new Error(`Flow step requires a prompt template: ${node.id} (${node.type})`)
    }
    return template
  }

  /**
   * @description 执行选人步骤：按来源选出下一位发言者并写入运行级状态。
   * @param node 选人节点。
   * @param config 节点配置。
   * @returns 选人完成的 Promise。
   * @remarks 选人结果以 node-output 发出（调试预览节点可见）：命中时给出发言者名字与来源，
   *   未命中时明确说明，两类信息都用于排查群聊「为何没人接话」。
   */
  private async dispatchSelectSpeaker(node: FlowNode, config: FlowStepConfig): Promise<void> {
    // 评分模板原样下传：被评估角色的变量由 assessIntent 逐候选插值，流程作用域没有这些取值。
    const source = config.source ?? 'first'
    const intentPromptText =
      source === 'intent' ? this.requireStepPromptTemplate(node, config) : ''
    const result = await selectSpeaker({
      source,
      threshold: config.threshold,
      tieBreak: config.tieBreak,
      intentPromptText,
      participants: this.input.participants,
      spoken: this.spoken,
      session: this.requireSession(),
      currentMessageIds: this.input.currentMessageIds,
      requestId: this.input.requestId,
      modelConfig: this.input.modelConfig,
      resolveContextBudget: (contextWindow) => this.input.resolveContextBudget(contextWindow),
      getAbortSignal: () => this.input.abortSignal,
      emit: this.input.emit
    })
    this.nextSpeakerId = result.participant?.character.id ?? ''
    this.selectionSource = result.source
    const scoreLine = result.scores?.length
      ? `评分明细：${result.scores.map((item) => `${item.name} ${item.score}`).join('，')}`
      : ''
    this.emitNodeOutput(
      node,
      result.participant
        ? `选中发言者：${result.participant.character.name}（${result.source}）${
            scoreLine ? `\n${scoreLine}` : ''
          }`
        : result.scores && result.scores.length > 0
          ? `未命中任何发言者：评分均低于阈值。\n${scoreLine}`
          : '未命中任何发言者：没有可参与的候选（均已发言），本轮无人接话。'
    )
    // 每个候选的评分请求原始交换单独发一条产出：预览节点 raw 弹窗可逐请求查看。
    for (const item of result.scores ?? []) {
      if (item.exchange) {
        this.emitNodeOutput(node, `评分请求：${item.name}`, item.exchange)
      }
    }
  }

  /**
   * @description 保证当前有一个打开的回合：没有时立即为下一位发言者装配回合并创建占位。
   * @returns 当前回合状态。
   * @remarks 回合是应用侧账务，流程不再显式声明开始步骤；单聊在没有选择结果时自动取唯一参与者，
   *   群聊必须由选择发言者步骤写入 next_speaker，否则本步骤失败。
   */
  private async ensureTurn(): Promise<TurnStateValue> {
    if (this.turn) {
      return this.turn
    }
    const speakerId =
      this.nextSpeakerId ||
      (this.input.participants.length === 1 ? this.input.participants[0].character.id : '')
    if (!speakerId) {
      throw new Error('Flow step requires a selected speaker.')
    }
    const participant = this.input.participants.find(
      (item) => item.character.id === speakerId
    )
    if (!participant) {
      throw new Error(`Selected speaker is not a participant: ${speakerId}`)
    }
    this.input.emit({
      type: 'character-state',
      characterId: participant.character.id,
      state: 'replying'
    })
    this.turn = await this.lifecycle.begin(participant)
    recordTraceEvent('character-turn-start', {
      sessionId: this.input.sessionId,
      requestId: this.input.requestId,
      characterId: participant.character.id
    })
    return this.turn
  }

  /**
   * @description 执行路由步骤：按节点提示词绑定工具并解析工具调用。
   * @param config 节点配置。
   * @returns 路由完成的 Promise。
   * @remarks 提示词模板取自节点配置并经流程变量插值，空白时抛错。
   */
  private async dispatchRoute(node: FlowNode, config: FlowStepConfig): Promise<void> {
    const state = await this.ensureTurn()
    const options: RouteStepOptions = {
      systemPromptText: interpolateTemplate(
        this.requireStepPromptTemplate(node, config),
        this.currentScope()
      )
    }
    const step = createRouteModelNode(this.context, options)
    const partial = await step(state)
    this.turn = { ...state, ...partial }
    this.emitNodeOutput(
      node,
      formatRouteDecision(partial.routeDecision, this.turn.pendingToolCalls),
      partial.routeRaw
    )
  }

  /**
   * @description 执行工具步骤：执行路由步骤产出的全部待处理工具调用。
   * @returns 工具执行完成的 Promise。
   */
  private async dispatchExecuteTools(node: FlowNode): Promise<void> {
    const state = await this.ensureTurn()
    const step = createExecuteToolsNode(this.context)
    const partial = await step(state)
    this.turn = { ...state, ...partial }
    const traceText = this.writeToolTraceVariable(this.turn)
    this.emitNodeOutput(node, traceText)
  }

  /**
   * @description 执行终答步骤：生成角色最终回复并提交当前回合。
   * @param config 节点配置。
   * @returns 终答完成的 Promise。
   * @remarks 终答即回合终点：草稿产出后立即交回合生命周期落库，流程可以继续做选人等收尾步骤。
   *   提示词模板取自节点配置，空白时抛错。
   */
  private async dispatchFinalAnswer(node: FlowNode, config: FlowStepConfig): Promise<void> {
    const state = await this.ensureTurn()
    const template = this.requireStepPromptTemplate(node, config)
    const step = createFinalAnswerNode({
      renderSystemPrompt: (current) => this.renderFinalSystemPrompt(current, template)
    })
    const partial = await step(state)
    this.turn = { ...state, ...partial }
    this.emitNodeOutput(node, partial.assistantDraft ?? '', partial.replyExchange)
    this.commitTurn()
  }

  /**
   * @description 执行自由模型步骤：模板插值后单次调用，产出写入输出变量。
   * @param node 模型节点。
   * @param config 节点配置。
   * @returns 执行完成的 Promise。
   */
  private async dispatchLlm(node: FlowNode, config: FlowStepConfig): Promise<void> {
    const state = await this.ensureTurn()
    const { text, appended, exchange } = await this.runLlmStep(config, state)
    if (appended.length > 0) {
      this.turn = { ...state, llmMessages: [...state.llmMessages, ...appended] }
    }
    this.writeStepOutput(node, text)
    this.emitNodeOutput(node, text, exchange)
  }

  /**
   * @description 执行发言意愿步骤：给当前输入打 0~100 分并写入输出变量。
   * @param node 意愿节点。
   * @param config 节点配置。
   * @returns 执行完成的 Promise。
   */
  private async dispatchIntent(node: FlowNode, config: FlowStepConfig): Promise<void> {
    const state = await this.ensureTurn()
    const { text, exchange } = await this.runIntentStep(node, config, state)
    this.writeStepOutput(node, text)
    this.emitNodeOutput(node, text, exchange)
  }

  /**
   * @description 发出节点产出事件：供编排调试在节点卡片上显示模型步骤的文本产出。
   * @param node 当前流程节点。
   * @param text 步骤产出的文本。
   * @param raw 原始模型交换；模型步骤提供，供预览节点弹窗查看未加工内容。
   * @returns 无返回值。
   * @remarks 文本与原始交换皆缺省时不发事件，节点卡片保持无输出显示。
   */
  private emitNodeOutput(node: FlowNode, text: string, raw?: FlowNodeRawExchange): void {
    if (!text.trim() && !raw) {
      return
    }
    this.input.emit({
      type: 'node-output',
      nodeId: node.id,
      text,
      ...(raw ? { raw } : {})
    })
  }

  /**
   * @description 提交当前回合：按表情标记分段落库并清空回合。
   * @returns 无返回值。
   * @remarks 由终答步骤完成后自动调用；没有打开回合或没有草稿时抛出阶段守卫错误。
   *   提交后标记已发言并记录回合结束。
   */
  private commitTurn(): void {
    const state = this.turn
    if (!state) {
      throw new Error('commitTurn requires an open turn.')
    }
    if (!state.assistantDraft.trim()) {
      throw new Error('commitTurn requires an assistant draft.')
    }
    this.lifecycle.commit(state)
    this.input.emit({
      type: 'character-state',
      characterId: state.characterId,
      state: 'idle'
    })
    recordTraceEvent('character-turn-end', {
      sessionId: this.input.sessionId,
      requestId: this.input.requestId,
      characterId: state.characterId
    })
    this.spoken.add(state.characterId)
    this.lastSpeakerId = state.characterId
    this.committedTurns += 1
    this.nextSpeakerId = ''
    this.turn = null
  }

  /**
   * @description 执行自由模型步骤：模板插值后单次模型调用。
   * @param config 节点配置。
   * @param state 当前回合状态。
   * @returns 模型输出文本、本步骤追加的消息与原始模型交换。
   * @remarks user 模板非空时以插值后的单条消息替代会话上下文，否则延续当前装配消息；
   *   交换记录只进入回合本地 llmMessages，不写会话存储。
   */
  private async runLlmStep(
    config: FlowStepConfig,
    state: TurnStateValue
  ): Promise<{ text: string; appended: BaseMessage[]; exchange: FlowNodeRawExchange }> {
    const scope = this.currentScope()
    const messages: BaseMessage[] = []
    const appended: BaseMessage[] = []
    const systemText = config.systemPromptTemplate
      ? interpolateTemplate(config.systemPromptTemplate, scope)
      : ''
    if (systemText.trim()) {
      messages.push(new SystemMessage(systemText))
    }
    const userText = config.userTemplate ? interpolateTemplate(config.userTemplate, scope) : ''
    if (userText.trim()) {
      messages.push(new HumanMessage(userText))
      appended.push(new HumanMessage(userText))
    } else {
      messages.push(...state.llmMessages)
    }
    const model = createChatModel(state.modelConfig, { callbacks: getTraceCallbacks() })
    const response = await model.invoke(messages, { signal: state.abortSignal })
    appended.push(response)
    return {
      text: contentToText(response.content),
      appended,
      exchange: serializeExchange(messages, response)
    }
  }

  /**
   * @description 执行发言意愿步骤：以角色人格评估当前输入的发言意愿分。
   * @param node 意愿节点。
   * @param config 节点配置。
   * @param state 当前回合状态。
   * @returns 解析出的意愿分文本（0~100）；解析失败返回空串。
   * @remarks 模板经 {{变量}} 插值组装，节点未配置模板时抛错；被评估角色的
   *   名字与人格经意愿模板变量注入，人格位置由模板掌控。
   */
  private async runIntentStep(
    node: FlowNode,
    config: FlowStepConfig,
    state: TurnStateValue
  ): Promise<{ text: string; exchange: FlowNodeRawExchange }> {
    const baseScope = this.currentScope()
    const scope: InterpolateScope = {
      ...baseScope,
      variables: {
        ...baseScope.variables,
        [FLOW_INTENT_TEMPLATE_VARIABLES.name]: state.character.name,
        [FLOW_INTENT_TEMPLATE_VARIABLES.characterPrompt]: state.prompt
      }
    }
    const systemText = interpolateTemplate(this.requireStepPromptTemplate(node, config), scope)
    const question = config.userTemplate
      ? interpolateTemplate(config.userTemplate, scope)
      : findCurrentInputText(state.llmMessages)
    const messages: BaseMessage[] = [
      new SystemMessage(systemText),
      new HumanMessage(question)
    ]
    const model = createChatModel(state.modelConfig, { callbacks: getTraceCallbacks() })
    try {
      const response = await model.invoke(messages, { signal: state.abortSignal })
      const score = parseIntentScore(contentToText(response.content))
      return {
        text: score === null ? '' : String(score),
        exchange: serializeExchange(messages, response)
      }
    } catch (error) {
      void logger.warn(
        'ai',
        'flow-intent-step-failed',
        'Flow intent step failed; output variable stays empty',
        {
          requestId: state.requestId,
          sessionId: state.sessionId,
          error: error instanceof Error ? error.message : String(error)
        }
      )
      return { text: '', exchange: serializeExchange(messages, new AIMessage('')) }
    }
  }

  /**
   * @description 渲染自定义终答 system：模板 + 表情、群聊、工具证据与结构化协议等运行时规则。
   * @param state 当前回合状态。
   * @param template 终答 system 模板。
   * @returns 拼接后的 system 文本。
   */
  private renderFinalSystemPrompt(state: TurnStateValue, template: string): string {
    const scope = this.buildFinalAnswerScope(state)
    const sections = [
      { text: interpolateTemplate(template, scope) },
      ...buildFinalAnswerRuntimeSections({
        persona: '',
        characterEmoticons: state.characterEmoticons,
        isGroup: state.session.participants.length > 1,
        characterName: state.character.name,
        hasToolEvidence: state.routingMessages.some((message) => message.getType() === 'tool'),
        incomplete: state.incomplete,
        hasRealtimeImages: state.currentImages.length > 0
      })
    ]
    return joinPromptSections(sections)
  }

  /**
   * @description 构造终答模板作用域：在流程变量之上叠加终答 section 变量。
   * @param state 当前回合状态。
   * @returns 含 section 变量的插值作用域。
   */
  private buildFinalAnswerScope(state: TurnStateValue): InterpolateScope {
    const base = buildFlowScope(state, this.variables, this.extras())
    return {
      variables: {
        ...base.variables,
        [FLOW_FINAL_ANSWER_SECTION_VARIABLES.characterPrompt]: state.prompt,
        [FLOW_FINAL_ANSWER_SECTION_VARIABLES.historySummary]:
          buildSummarySectionText(state.session) ?? '',
        [FLOW_FINAL_ANSWER_SECTION_VARIABLES.stateCard]:
          state.stateCardSections.join('\n\n'),
        [FLOW_FINAL_ANSWER_SECTION_VARIABLES.memory]: state.memorySections.join('\n\n'),
        [FLOW_FINAL_ANSWER_SECTION_VARIABLES.historyOmitted]:
          buildHistoryOmittedSectionText(state.historyOmittedCount) ?? '',
        [FLOW_FINAL_ANSWER_SECTION_VARIABLES.hasRealtimeImages]:
          state.currentImages.length > 0 ? 'true' : 'false',
        [FLOW_FINAL_ANSWER_SECTION_VARIABLES.incomplete]: state.incomplete ? 'true' : 'false',
        [FLOW_FINAL_ANSWER_SECTION_VARIABLES.lastUser]: base.lastUser ?? ''
      },
      lastUser: base.lastUser
    }
  }

  /**
   * @description 求值当前节点的下一条出边。
   * @param fromId 当前节点 ID。
   * @returns 后继节点标识；无出边或判断分支未连线时返回 null（流程结束）。
   * @remarks 判断节点按最近一次求值的分支取带对应标记的出边，该分支未连线即流程到此结束；
   *   其他节点走唯一出边。
   */
  private pickNextEdge(fromId: string): string | null {
    const edges = this.input.flow.graph.edges
    const fromNode = this.input.flow.graph.nodes.find((node) => node.id === fromId)
    if (fromNode?.type === 'condition') {
      const branchEdge = edges.find(
        (edge) => edge.from === fromId && edge.branch === this.lastBranch
      )
      return branchEdge?.to ?? null
    }
    const edge = edges.find((item) => item.from === fromId)
    return edge?.to ?? null
  }

  /**
   * @description 构造当前作用域：回合状态可为空，运行级变量始终可用。
   * @returns 插值与条件求值共用的作用域。
   */
  private currentScope(): InterpolateScope {
    return buildFlowScope(this.turn, this.variables, this.extras())
  }

  /**
   * @description 组装运行级作用域补充值。
   * @returns 群聊状态与最新用户输入。
   */
  private extras(): FlowScopeExtras {
    return {
      participantCount: this.input.participants.length,
      nextSpeakerId: this.nextSpeakerId,
      selectionSource: this.selectionSource,
      spokenCount: this.spoken.size,
      lastSpeakerId: this.lastSpeakerId,
      lastUser: readCurrentUserText(this.requireSession(), this.input.currentMessageIds),
      toolsExecuted: this.toolsExecuted
    }
  }

  /**
   * @description 读取当前会话快照。
   * @returns 会话快照。
   * @throws 会话不存在时抛出。
   */
  private requireSession(): ConversationSession {
    const session = this.input.sessionStore.getSession(this.input.sessionId)
    if (!session) {
      throw new Error(`Session not found: ${this.input.sessionId}`)
    }
    return session
  }

  /**
   * @description 记录步骤文本产出到流程变量表。
   * @param node 当前流程节点。
   * @param text 步骤产出的文本。
   * @returns 无返回值。
   * @remarks 产出为空白文本时不写入，变量保持缺省（后续插值替换为空串）。
   */
  private writeStepOutput(node: FlowNode, text: string): void {
    const name = node.config?.outputVariable
    if (!name || !text.trim()) {
      return
    }
    this.variables[name] = text
  }

  /**
   * @description 把本回合工具轨迹的文本形式写入流程变量，供模型调用节点以 {{tool_trace}} 引用。
   * @param state 当前回合状态。
   * @returns 轨迹文本（与写入变量的内容一致）。
   * @remarks 轨迹按工具轨迹预算截断后展平为「[调用]/[结果]」文本行；轨迹为空时写入空串，
   *   变量保持已定义状态以便插值得到空内容。
   */
  private writeToolTraceVariable(state: TurnStateValue): string {
    const calibration = getTokenCalibration().getCoefficient(state.modelConfig.modelId)
    const trajectory = truncateToolTrajectory(state.routingMessages, {
      maxTokens: resolveToolTrajectoryBudget({
        totalTokens: state.budget.wallTokens,
        systemReserveTokens: state.systemReserveTokens,
        historyEstimateTokens: state.historyEstimateTokens
      }),
      imageTokenEstimate: state.budget.imageTokenEstimate,
      calibration
    })
    const text = formatToolTrajectoryText(trajectory.messages)
    this.variables[FLOW_BUILTIN_VARIABLES.toolTrace] = text
    return text
  }
}

/**
 * @description 把工具轨迹消息展平为面向模型提示词的文本行。
 * @param messages 截断后的工具轨迹消息。
 * @returns 以空行分隔的「[调用] 工具名 参数」「[结果] 内容」文本。
 */
function formatToolTrajectoryText(messages: readonly BaseMessage[]): string {
  const lines: string[] = []
  for (const message of messages) {
    if (message.getType() === 'ai') {
      for (const call of (message as AIMessage).tool_calls ?? []) {
        lines.push(`[调用] ${call.name} ${JSON.stringify(call.args ?? {})}`)
      }
      continue
    }
    const text = contentToText(message.content).trim()
    if (text) {
      lines.push(`[结果] ${text}`)
    }
  }
  return lines.join('\n\n')
}

/**
 * @description 把路由决策格式化为面向展示的文本行。
 * @param reason 路由响应中的决策理由文本；未发起模型调用时缺省。
 * @param pendingCalls 路由产出的待执行工具调用。
 * @returns 「[调用]/[理由]」文本行；两者皆缺时为空串。
 */
function formatRouteDecision(
  reason: string | undefined,
  pendingCalls: readonly AgentToolCall[]
): string {
  const lines = pendingCalls.map(
    (call) => `[调用] ${call.name} ${JSON.stringify(call.args ?? {})}`
  )
  const trimmedReason = reason?.trim()
  if (trimmedReason) {
    lines.push(`[理由] ${trimmedReason}`)
  }
  return lines.join('\n\n')
}

/**
 * @description 计算流程解释器的总步数上限。
 * @param participantCount 参与者数量。
 * @returns 允许执行的最大步数。
 * @remarks 群聊连续对话由意愿阈值自然冷场收尾，本上限只兜底失控循环；
 *   数值按单轮工具循环加选人回环余量推导，远大于正常对话所需。
 */
function flowStepLimit(participantCount: number): number {
  const perTurn = MAX_TOOL_ROUNDS * 2 + 8
  return participantCount === 1
    ? perTurn + 6
    : participantCount * perTurn + participantCount * 2 + 8
}
