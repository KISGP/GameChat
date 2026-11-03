import type { CharacterSummary, ChatImageAttachment, ConversationSession } from '@gamechat/type'
import type { ResolvedModelConfig } from '@gamechat/type'
import type { AgentPolicy, AgentToolPackageId, AgentToolTrace } from './agent-policy'
import type { ChatEmoticonImage } from '@gamechat/schema'
import type { AIMessageChunk, BaseMessage, MessageContent } from '@langchain/core/messages'
import type { BaseCallbackHandler } from '@langchain/core/callbacks/base'

export type AgentToolContext = {
  character: CharacterSummary
  session: ConversationSession
  policy: AgentPolicy
  abortSignal?: AbortSignal
  imageResources?: {
    read: (
      resourceId: string
    ) => Promise<{ attachment: ChatImageAttachment; dataUrl: string } | null>
    updateAnalysis: (resourceId: string, analysis: string) => Promise<void>
  }
  emoticonResources?: {
    read: (id: string) => Promise<ChatEmoticonImage | null>
  }
}

export type AgentToolDefinition = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export type AgentToolCall = {
  id: string
  name: string
  args: Record<string, unknown>
}

export type AgentToolCallRejection = {
  callId: string
  message: string
}

export type AgentToolResultStatus = 'completed' | 'failed' | 'rejected'

export type AgentToolResult = {
  status: AgentToolResultStatus
  data?: unknown
  error?: string
  sourceIds?: string[]
  complete?: boolean
  modelContent?: MessageContent
}

export type AgentTool = {
  name: string
  description: string
  definition: AgentToolDefinition
  execute: (input: Record<string, unknown>, context: AgentToolContext) => Promise<AgentToolResult>
}

export type AgentToolPackage = {
  id: AgentToolPackageId
  tools: AgentTool[]
  /** 该工具包对应的工具路由阶段规则段；仅在包启用时拼入路由 system prompt。 */
  routingPrompt?: string
  validateCalls?: (calls: AgentToolCall[], context: AgentToolContext) => AgentToolCallRejection[]
}

export type AgentModel = {
  bindTools?: (
    tools: AgentToolDefinition[],
    options?: { parallel_tool_calls?: boolean; tool_choice?: 'auto' | 'required' }
  ) => AgentModel
  stream: (
    messages: BaseMessage[],
    options?: { signal?: AbortSignal }
  ) => AsyncIterable<AIMessageChunk> | Promise<AsyncIterable<AIMessageChunk>>
}

export type AgentModelFactoryOptions = {
  callbacks?: BaseCallbackHandler[]
}

export type AgentModelFactory = (
  modelConfig: ResolvedModelConfig,
  options?: AgentModelFactoryOptions
) => AgentModel

export type AgentRunRequest = {
  modelConfig: ResolvedModelConfig
  history: BaseMessage[]
  systemPromptText: string
  context: AgentToolContext
  tools: AgentToolPackage[]
  abortSignal: AbortSignal
  onChunk: (text: string) => void
  callbacks?: BaseCallbackHandler[]
  onTrace?: (trace: AgentToolTrace) => void
}

export type AgentRunResult = {
  assistantDraft: string
  messages: BaseMessage[]
  traces: AgentToolTrace[]
  toolRounds: number
  incomplete: boolean
}
