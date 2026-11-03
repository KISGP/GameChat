/**
 * @description 聊天运行时入口：宿主注入宿主绑定与角色依赖后构造运行时实例。
 * @remarks 宿主自行持有实例单例与启动顺序：先 configureChatHost（及 setLogSink/setTraceSink），
 *   再 createChatRuntime，随后 await runtime.initialize()；实例方法承担会话、运行与导出全部操作。
 *   编排调试等嵌入方直接消费 runFlow 与内存模式 SessionStore，以及本桶列出的工具包工厂、
 *   Agent 工具类型与提示词/模型配置原语，不经 ChatRuntime。
 */
import type { CharacterSessionStateCardView } from '@gamechat/type'
import { createChatToolPackageResolver, type ChatToolPackageResolver } from './agent'
import { getChatHost } from './host'
import { ChatRuntime } from './run'
import { getChatStateCardService } from './state-card'
import type { ChatContextProvider, ChatRuntimeDependencies } from './types'

export { getUserEmoticons } from './media'
export { ChatRuntime } from './run'
export { SessionStore, type SessionStoreOptions } from './session'
export { runFlow, type FlowRunInput } from './flow/engine'
export type { TurnStateValue, TurnStreamEvent } from './engine/turn-state'
export { configureChatHost, getChatHost, type ChatHostBindings } from './host'
export { createAgentLoopPolicy, MAX_TOOL_ROUNDS } from './loop-policy'
export type {
  ChatContextProvider,
  ChatRuntimeDependencies,
  ChatWorldSearch,
  MemoryAdapter,
  CharacterPromptRecord
} from './types'
export { createChatToolPackageResolver, type ChatToolPackageResolver } from './agent'
export type {
  CharacterSummary,
  ChatAppendMessageResult,
  ChatImageAttachment,
  ChatImageInput,
  ChatRunAccepted,
  ChatRunEvent,
  ChatUserSegment,
  ConversationSession,
  ConversationSessionSummary,
  ConversationMessage
} from '@gamechat/type'
export { createDatetimeToolPackage } from './tools/datetime'
export { createMoeGirlpediaToolPackage } from './tools/moegirlpedia'
export { createWorldToolPackage } from './tools/world'
export {
  findProviderModel,
  parseIntentScore,
  resolveContextBudget,
  resolveImageTokenEstimate,
  resolveModelConfig,
  buildFinalSystemPrompt,
  buildRoutingSystemPrompt,
  joinPromptSections
} from './model'

/**
 * @description 创建聊天运行时实例。
 * @param dependencies 角色依赖（角色摘要、表情目录与人设 prompt 读取）。
 * @param context 策略上下文（Agent 策略与可见工具名解析）。
 * @returns 就绪待初始化的 ChatRuntime 实例。
 * @remarks world 检索与长期记忆适配经宿主绑定在工厂内装配进工具包解析器；
 *   调用前必须完成 configureChatHost。
 */
export function createChatRuntime(
  dependencies: ChatRuntimeDependencies,
  context: ChatContextProvider
): ChatRuntime {
  const host = getChatHost()
  const toolResolver: ChatToolPackageResolver = createChatToolPackageResolver({
    world: host.getWorldSearch(),
    memory: host.getMemory()
  })
  return new ChatRuntime(dependencies, context, toolResolver)
}

/**
 * @description 读取角色参与的全部会话中该角色的状态卡视图。
 * @param runtime 目标聊天运行时实例。
 * @param characterId 角色标识。
 * @returns 按会话排列的状态卡视图数组；无参与会话时为空数组。
 * @remarks 状态卡跟会话走、按角色分卡：以会话摘要的成员关系过滤，再逐会话读取该角色的卡；
 *   会话展示文案与聊天会话列表同口径（自定义标题 → 末条消息预览 → 固定兜底）。
 */
export async function getCharacterSessionStateCards(
  runtime: ChatRuntime,
  characterId: string
): Promise<CharacterSessionStateCardView[]> {
  const summaries = runtime
    .getSessionSummaries()
    .filter((summary) => summary.participants.includes(characterId))
  return Promise.all(
    summaries.map(async (summary) => {
      const view = await getChatStateCardService().getSessionCardView(
        summary.ownerId,
        summary.id,
        characterId
      )
      return {
        sessionId: summary.id,
        sessionTitle: summary.title || summary.lastMessagePreview || '新的对话已开始',
        ...view
      }
    })
  )
}
