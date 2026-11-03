import type { ChatAppendMessageRequest, ChatAppendMessageResult, ChatCompressSessionRequest, ChatCompressSessionResult, ChatCreateGroupRequest, ChatDeleteGroupRequest, ChatDeleteGroupResult, ChatDeleteSessionRequest, ChatDeleteSessionResult, ChatExportSessionRequest, ChatExportSessionResult, ChatGroup, ChatRemoveFailedTurnRequest, ChatRemoveFailedTurnResult, ChatRenameSessionRequest, ChatRenameSessionResult, ChatRetryMessageRequest, ChatRunAccepted, ChatSetGroupPinnedRequest, ChatTriggerRunRequest, CharacterSessionStateCardView, ConversationSession, ConversationSessionSummary } from '@gamechat/type'
import {
  createAgentLoopPolicy,
  createChatRuntime,
  createChatToolPackageResolver,
  getCharacterSessionStateCards as getCharacterSessionStateCardsFromCore,
  getUserEmoticons,
  type ChatRuntime,
  type ChatToolPackageResolver
} from '@gamechat/core'
import {
  getCharacterEmoticons,
  getCharacterPrompt,
  getCharacterSummaryById,
  saveCharacterPrompt
} from '../characters/index'
import { getMemoryService } from '../memory/index'
import { getWorldSearch } from '../world/index'
import { getFlow } from '../flows/index'
import { getUnifiedSettingsStore } from '../settings/index'
import { createSingleLazyPromise } from '@gamechat/core'

/** 进程内共享的聊天运行时；首次获取时构造。 */
let runtime: ChatRuntime | null = null
/** 工具名解析器：只用于按策略枚举可见工具名，与运行时内部的解析器各自持有检索客户端。 */
let toolNameResolver: ChatToolPackageResolver | null = null

/** 聊天域初始化门：记忆设置与会话文档加载完成前，运行时相关 IPC 在门上等待。 */
const initialization = createSingleLazyPromise(async () => {
  await getMemoryService().initializeSettings()
  await getRuntime().initialize()
})

/**
 * @description 等待聊天运行时完成初始化。
 * @returns 初始化完成即兑现的 Promise；失败后重试会重新执行初始化。
 * @remarks 供聊天域 IPC handler 在窗口先行创建的启动模式下串行化于初始化之后。
 */
export function whenChatReady(): Promise<void> {
  return initialization.get()
}

/**
 * @description 获取进程内共享的聊天运行时。
 * @returns 惰性构造并缓存的 ChatRuntime 单例。
 * @remarks import 本模块零副作用；运行时在首次获取时才构造，
 *   构造前必须已完成 configureChatHost（由应用启动链保证）。
 */
function getRuntime(): ChatRuntime {
  if (!runtime) {
    runtime = createChatRuntime(
      {
        getCharacter: async (characterId) => getCharacterSummaryById(characterId),
        getCharacterEmoticons,
        getCharacterPrompt: async (characterId) => getCharacterPrompt(characterId)
      },
      {
        getAgentPolicy: async () => {
          const settings = await getUnifiedSettingsStore().get()
          return {
            ...createAgentLoopPolicy(),
            enabledToolPackageIds: settings.agent.enabledToolPackageIds
          }
        },
        getFlow,
        getAgentToolNames: (policy) => getToolNameResolver().getEnabledToolNames(policy)
      }
    )
  }
  return runtime
}

/**
 * @description 获取按策略枚举可见工具名的解析器。
 * @returns 进程内共享的工具名解析器。
 */
function getToolNameResolver(): ChatToolPackageResolver {
  if (!toolNameResolver) {
    toolNameResolver = createChatToolPackageResolver({
      world: getWorldSearch(),
      memory: getMemoryService()
    })
  }
  return toolNameResolver
}

export { getCharacterPrompt, saveCharacterPrompt, getCharacterEmoticons, getUserEmoticons }

/**
 * @description 初始化聊天运行时并加载记忆设置。
 * @remarks 重复调用复用同一次初始化；Langfuse 观测生命周期归应用启动链管理，不在聊天域内部触发。
 */
export async function initializeChat(): Promise<void> {
  await whenChatReady()
}

/**
 * @description 返回当前管理的会话列表摘要，供界面侧栏使用。
 * @returns 当前会话摘要数组。
 */
export function getSessionSummaries(): ConversationSessionSummary[] {
  return getRuntime().getSessionSummaries()
}

/**
 * @description 换入并返回指定会话的全量快照，供界面打开会话时使用。
 * @param sessionId 会话标识。
 * @returns 会话全量快照；不存在或文档无效时返回 null。
 */
export function getSessionDetail(sessionId: string): Promise<ConversationSession | null> {
  return getRuntime().getSessionDetail(sessionId)
}

/**
 * @description 读取角色参与的全部会话中该角色的状态卡视图。
 * @param characterId 角色标识。
 * @returns 按会话排列的状态卡视图数组；无参与会话时为空数组。
 * @remarks 状态卡跟会话走、按角色分卡：以会话摘要的成员关系过滤，再逐会话读取该角色的卡；
 *   会话展示文案与聊天会话列表同口径（自定义标题 → 末条消息预览 → 固定兜底）。
 */
export async function getCharacterSessionStateCards(
  characterId: string
): Promise<CharacterSessionStateCardView[]> {
  return getCharacterSessionStateCardsFromCore(getRuntime(), characterId)
}

/**
 * @description 返回全部独立群聊对象。
 * @returns 群聊快照列表。
 */
export function getGroups(): ChatGroup[] {
  return getRuntime().getGroups()
}

/**
 * @description 创建成员固定的独立群聊。
 * @param request 群聊成员列表。
 * @returns 新建群聊快照。
 */
export function createGroup(request: ChatCreateGroupRequest): ChatGroup {
  return getRuntime().createGroup(request.participantIds)
}

/**
 * @description 发送一个新的聊天运行请求，调度模型执行并返回已接受的运行信息。
 * @param request 运行请求对象。
 * @returns 已接受的运行信息，包含请求 ID 等元数据。
 */
export async function appendMessage(
  request: ChatAppendMessageRequest
): Promise<ChatAppendMessageResult> {
  return getRuntime().appendMessage(request)
}

/**
 * @description 触发等待窗口对应的一次聊天运行。
 * @param request 触发请求。
 * @returns 已接受的运行信息。
 */
export async function triggerRun(request: ChatTriggerRunRequest): Promise<ChatRunAccepted> {
  return getRuntime().triggerRun(request)
}

/**
 * @description 删除会话末尾的失败回复气泡并以其用户消息重新启动一次运行。
 * @param request 重试请求，包含会话 ID、失败 assistant 消息 ID 与模型条目标识。
 * @returns 已接受的运行信息。
 */
export async function retryMessage(request: ChatRetryMessageRequest): Promise<ChatRunAccepted> {
  return getRuntime().retryMessage(request)
}

/**
 * @description 移除一轮失败的对话消息，供渲染层「重新编辑」在重新发送前清场。
 * @param request 清理请求，包含会话 ID 与失败的 assistant 消息 ID。
 * @returns 清理后的会话快照与摘要。
 */
export async function removeFailedTurn(
  request: ChatRemoveFailedTurnRequest
): Promise<ChatRemoveFailedTurnResult> {
  return getRuntime().removeFailedTurn(request)
}

/**
 * @description 删除指定会话的内存快照与磁盘数据。
 * @param request 删除请求，包含会话 ID。
 * @returns 被删除的会话 ID。
 */
export async function deleteSession(
  request: ChatDeleteSessionRequest
): Promise<ChatDeleteSessionResult> {
  return getRuntime().deleteSession(request)
}

/**
 * @description 删除指定群聊及其全部会话数据。
 * @param request 删除请求，包含群聊 ID。
 * @returns 被删除的群聊 ID。
 */
export async function deleteGroup(request: ChatDeleteGroupRequest): Promise<ChatDeleteGroupResult> {
  return getRuntime().deleteGroup(request)
}

/**
 * @description 校验角色的聊天数据处于可删除状态：不属于任何群聊，且名下没有活跃运行。
 * @param characterId 角色标识（会话归属者）。
 * @returns 无返回值。
 * @remarks 供删除角色流程在移除角色文件前调用；违反条件时抛出携带原因的错误。
 */
export function assertCharacterChatDeletable(characterId: string): void {
  getRuntime().assertCharacterChatDeletable(characterId)
}

/**
 * @description 删除角色名下的全部会话数据，并逐会话广播 session-removed。
 * @param characterId 角色标识。
 * @returns 全部会话删除完成后的 Promise。
 */
export function deleteCharacterChatData(characterId: string): Promise<void> {
  return getRuntime().deleteCharacterChatData(characterId)
}

/**
 * @description 设置群聊的侧栏置顶标记。
 * @param request 置顶请求，包含群聊 ID 与目标标记。
 * @returns 更新后的群聊快照。
 */
export function setGroupPinned(request: ChatSetGroupPinnedRequest): ChatGroup {
  return getRuntime().setGroupPinned(request)
}

/**
 * @description 设置会话的自定义标题。
 * @param request 改名请求，包含会话 ID 与新标题。
 * @returns 改名后的会话快照与摘要。
 */
export function renameSession(request: ChatRenameSessionRequest): Promise<ChatRenameSessionResult> {
  return getRuntime().renameSession(request)
}

/**
 * @description 手动触发一次会话历史压缩（会话命令）。
 * @param request 压缩请求，包含会话 ID。
 * @returns 压缩结果。
 */
export function compressSession(
  request: ChatCompressSessionRequest
): Promise<ChatCompressSessionResult> {
  return getRuntime().compressSession(request)
}

/**
 * @description 将整个会话导出为 Markdown 文件并落盘。
 * @param request 导出请求，包含会话 ID。
 * @returns 导出结果；用户在保存对话框取消时返回 canceled。
 */
export function exportSession(request: ChatExportSessionRequest): Promise<ChatExportSessionResult> {
  return getRuntime().exportSession(request)
}

/**
 * @description 取消当前正在执行的请求任务。
 * @param requestId 要取消的请求 ID。
 * @returns 成功取消则返回 `true`。
 */
export function abortRun(requestId: string): boolean {
  return getRuntime().abortRun(requestId)
}

/**
 * @description 在应用退出前中止当前全部聊天运行。
 */
export function shutdownChat(): void {
  if (runtime) {
    runtime.shutdown()
  }
}
