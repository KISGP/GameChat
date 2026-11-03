import type { ChatImageInput, ConversationSession } from '@gamechat/type'
import type { ChatContextProvider, ChatRuntimeDependencies } from '../types'
import type { ContextBudget } from '../model'
import type { SessionStore } from '../session'
import type { AgentToolPackage } from '../../tools'
import type { TurnStateValue } from './turn-state'

/**
 * @description TurnEngine 共享上下文：图只编译一次，运行期可变数据一律经由回合状态传递。
 */
export type TurnEngineContext = {
  dependencies: ChatRuntimeDependencies
  chatContext: ChatContextProvider
  sessionStore: SessionStore
  /**
   * @description 读取当前轮次用户消息携带的实时图片，并按应用设置完成压缩处理。
   * @param sessionId 会话 ID。
   * @param messageIds 本轮用户消息 ID。
   * @returns 处理后的实时图片输入；单角色回合以外返回空数组。
   */
  loadCurrentImages: (sessionId: string, messageIds: string[]) => Promise<ChatImageInput[]>
  /**
   * @description 解析当前回合生效的上下文预算。
   * @param contextWindow 生效模型条目配置的窗口容量；未配置时为 undefined。
   * @returns 由全局预算比例与图片处理档位推导的上下文预算。
   */
  resolveContextBudget: (contextWindow: number | undefined) => Promise<ContextBudget>
  /**
   * @description 加载当前发言角色在会话中的状态卡提示词段。
   * @param session 当前会话快照。
   * @param characterId 当前发言角色 ID。
   * @returns 状态卡段文本数组；该角色尚无状态卡时为空数组。
   * @remarks 状态卡跟会话走、按角色分卡：群聊中每位角色只注入并维护自己的卡。
   */
  loadStateCardSections: (
    session: ConversationSession,
    characterId: string
  ) => Promise<string[]>
  /**
   * @description 加载当前发言角色的记忆段（整份常驻注入）。
   * @param session 当前会话快照。
   * @param characterId 当前发言角色 ID。
   * @returns 记忆段文本数组；记忆关闭、无内容或读取失败时为空数组。
   */
  loadMemorySections: (session: ConversationSession, characterId: string) => Promise<string[]>
  /**
   * @description 在会话串行队列内执行一次回合前压缩（默认保留窗口）。
   * @param sessionId 目标会话 ID。
   * @returns 无返回值；压无可压时静默返回，调用失败时向上抛出。
   * @remarks 由回合前预算护栏节点在输入触及预算时调用；无视自动压缩开关与水位，尊重熔断器。
   */
  compressBeforeTurn: (sessionId: string) => Promise<void>
  /**
   * @description 解析当前回合对模型可见的工具包。
   * @param state 当前回合状态，含策略、实时图片与表情清单。
   * @returns 本回合可绑定到模型的工具包集合。
   */
  resolveToolPackages: (state: TurnStateValue) => Promise<AgentToolPackage[]>
}
