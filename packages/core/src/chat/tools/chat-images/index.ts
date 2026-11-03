import type { AgentTool, AgentToolContext, AgentToolPackage } from '../../../tools'

/**
 * @description 创建读取会话历史图片并更新图片综合摘要的工具包。
 * @returns 仅在当前运行提供图片资源上下文时使用的工具包。
 */
export function createChatImageToolPackage(): AgentToolPackage {
  return {
    id: 'chat-images',
    routingPrompt: `图片规则：
- 当历史图片摘要不足以回答当前问题时，用 read_chat_image 重读对应图片。
- 重读后调用 update_chat_image_analysis 保存融合了既有有用信息的完整摘要。`,
    tools: [createReadChatImageTool(), createUpdateChatImageAnalysisTool()]
  }
}

/**
 * @description 创建按资源索引读取历史图片的工具。
 * @returns 可供 Agent 调用的图片读取工具。
 */
function createReadChatImageTool(): AgentTool {
  return {
    name: 'read_chat_image',
    description: 'Read a previous chat image by its resourceId when the image summary is insufficient.',
    definition: {
      type: 'function',
      function: {
        name: 'read_chat_image',
        description: 'Load one previous chat image for visual re-analysis.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['resourceId'],
          properties: {
            resourceId: { type: 'string', description: 'Image resourceId from chat history.' }
          }
        }
      }
    },
    execute: async (input: Record<string, unknown>, context: AgentToolContext) => {
      const resourceId = typeof input.resourceId === 'string' ? input.resourceId.trim() : ''
      if (!resourceId) {
        return { status: 'failed' as const, error: 'resourceId is required.' }
      }
      if (!context.imageResources) {
        return { status: 'failed' as const, error: 'Image resources are unavailable.' }
      }
      const image = await context.imageResources.read(resourceId)
      if (!image) {
        return { status: 'failed' as const, error: `Image resource not found: ${resourceId}` }
      }
      return {
        status: 'completed' as const,
        data: { resourceId, fileName: image.attachment.fileName, analysis: image.attachment.analysis },
        sourceIds: [resourceId],
        modelContent: [
          {
            type: 'text',
            text: `Loaded image ${resourceId}. Existing summary: ${image.attachment.analysis || '(none)'}`
          },
          { type: 'image_url', image_url: { url: image.dataUrl } }
        ]
      }
    }
  }
}

/**
 * @description 创建覆盖指定图片综合摘要的工具。
 * @returns 可供 Agent 调用的图片摘要更新工具。
 */
function createUpdateChatImageAnalysisTool(): AgentTool {
  return {
    name: 'update_chat_image_analysis',
    description: 'Replace a chat image summary with a fused, more complete analysis after re-reading it.',
    definition: {
      type: 'function',
      function: {
        name: 'update_chat_image_analysis',
        description: 'Persist a fused summary for one chat image resource.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['resourceId', 'analysis'],
          properties: {
            resourceId: { type: 'string' },
            analysis: { type: 'string', description: 'Complete replacement summary, including prior useful facts.' }
          }
        }
      }
    },
    execute: async (input: Record<string, unknown>, context: AgentToolContext) => {
      const resourceId = typeof input.resourceId === 'string' ? input.resourceId.trim() : ''
      const analysis = typeof input.analysis === 'string' ? input.analysis.trim() : ''
      if (!resourceId || !analysis) {
        return { status: 'failed' as const, error: 'resourceId and non-empty analysis are required.' }
      }
      if (!context.imageResources) {
        return { status: 'failed' as const, error: 'Image resources are unavailable.' }
      }
      await context.imageResources.updateAnalysis(resourceId, analysis)
      return { status: 'completed' as const, data: { resourceId, analysis }, sourceIds: [resourceId] }
    }
  }
}
