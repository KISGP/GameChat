import type { AgentTool, AgentToolContext, AgentToolPackage } from '../../../tools'

/**
 * @description 创建读取聊天表情原图的工具包。
 * @returns 可供真实聊天 Agent 使用的表情读取工具包。
 */
export function createChatEmoticonToolPackage(): AgentToolPackage {
  return {
    id: 'chat-emoticons',
    routingPrompt: `表情规则：
- 当最新消息包含表情标记，且理解该表情对回应必要时，才读取聊天表情。
- 使用 read_chat_emoticon 并传入聊天记录中的精确全局 ID。`,
    tools: [createReadChatEmoticonTool()]
  }
}

/**
 * @description 创建按全局 ID 读取聊天表情原图的工具。
 * @returns 可供 Agent 调用的表情读取工具。
 */
function createReadChatEmoticonTool(): AgentTool {
  return {
    name: 'read_chat_emoticon',
    description:
      'Read a chat emoticon image by its global id to understand the emotion it conveys.',
    definition: {
      type: 'function',
      function: {
        name: 'read_chat_emoticon',
        description: 'Load one chat emoticon image for visual confirmation.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Global emoticon id from chat history.' }
          }
        }
      }
    },
    execute: async (input: Record<string, unknown>, context: AgentToolContext) => {
      const id = typeof input.id === 'string' ? input.id.trim() : ''
      if (!id) return { status: 'failed' as const, error: 'id is required.' }
      if (!context.emoticonResources) {
        return { status: 'failed' as const, error: 'Emoticon resources are unavailable.' }
      }
      const image = await context.emoticonResources.read(id)
      if (!image || image.unavailable || !image.dataUrl) {
        return { status: 'failed' as const, error: `Emoticon not found or unavailable: ${id}` }
      }
      return {
        status: 'completed' as const,
        data: { id, description: image.description },
        sourceIds: [id],
        modelContent: [
          { type: 'text', text: `Loaded emoticon ${id}. Description: ${image.description}` },
          { type: 'image_url', image_url: { url: image.dataUrl } }
        ]
      }
    }
  }
}
