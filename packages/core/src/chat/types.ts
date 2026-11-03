import type { CharacterSummary, FlowPackage } from '@gamechat/type'
import type { ChatEmoticonImage } from '@gamechat/schema'
import type { AgentPolicy } from '../tools'
import type { WorldSearchResult } from '../world/search'

/** 角色人设 prompt 读写记录。 */
export type CharacterPromptRecord = {
  characterId: string
  prompt: string
}

/** 长期记忆宿主适配：聊天引擎对记忆能力的最小依赖面。 */
export type MemoryAdapter = {
  /** @description 读取记忆总开关等运行设置。 */
  getSettings: () => { enabled: boolean }
  /** @description 读取角色长期记忆全文；尚无记忆时为空串。 */
  getCharacterMemory: (characterId: string) => Promise<string>
  /** @description 全量替换角色长期记忆，返回保存后的记忆全文。 */
  saveCharacterMemory: (characterId: string, content: string) => Promise<string>
  /** @description 向角色长期记忆末尾追加一条记录，返回保存后的记忆全文。 */
  appendCharacterMemory: (characterId: string, entry: string) => Promise<string>
}

/** 背景资料检索宿主适配：world 工具包对检索能力的最小依赖面。 */
export type ChatWorldSearch = {
  /** @description 按自然语言查询检索剧情场景与名词解释。 */
  search: (query: string) => Promise<WorldSearchResult>
}

/** 聊天运行时的角色依赖：按标识读取角色摘要、表情目录与人设 prompt。 */
export type ChatRuntimeDependencies = {
  getCharacter: (characterId: string) => Promise<CharacterSummary>
  getCharacterEmoticons: (characterId: string) => Promise<ChatEmoticonImage[]>
  getCharacterPrompt: (characterId: string) => Promise<CharacterPromptRecord>
}

/** 一次运行中被选中的发言成员：角色摘要与该角色的人设 prompt。 */
export type ScheduledParticipant = {
  character: CharacterSummary
  prompt: string
}

/** 一次运行或回合的执行结果。 */
export type TurnOutcome = {
  status: 'completed' | 'error' | 'aborted'
  /** 失败时的可展示错误文本。 */
  errorMessage?: string
  /** 失败或中断时出错回合的发言角色标识；尚未进入回合时缺省。 */
  characterId?: string
}

/** 聊天策略上下文：按统一设置解析 Agent 策略、流程包与可见工具名。 */
export type ChatContextProvider = {
  getAgentPolicy: () => Promise<AgentPolicy>
  /**
   * @description 读取当前生效的通用流程包。
   * @returns 流程包；缺失或损坏时抛出。
   * @remarks 每次运行读取一次，单聊与群聊共用同一份流程，改选流程在下一次回复即生效。
   */
  getFlow: () => Promise<FlowPackage>
  getAgentToolNames: (policy: AgentPolicy) => string[]
}
