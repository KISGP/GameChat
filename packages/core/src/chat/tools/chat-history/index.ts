import MiniSearch from 'minisearch'
import type { AgentTool, AgentToolPackage } from '../../../tools'
import { tokenize } from '../../../infra/tokenize'

/** 全史检索返回的默认条数上限。 */
const DEFAULT_QUERY_LIMIT = 6

/** 单条命中返回的正文截断长度，避免多条命中撑爆工具结果。 */
const SNIPPET_MAX_LENGTH = 400

/**
 * @description 创建全会话原文检索工具包（始终可用，不走策略开关）。
 * @returns 全史检索工具包。
 */
export function createChatHistoryToolPackage(): AgentToolPackage {
  return {
    id: 'chat-history',
    routingPrompt: `全史检索规则：

1. 当摘要与近期上下文不足以回答「很久以前发生过什么」类问题时，调用全会话检索。
2. 检索词使用与目标剧情相关的关键词或短语（人名、事件、地点等），不要输出完整句子。
3. 检索只覆盖当前会话原文，跨会话信息请改用长期记忆工具。`,
    tools: [createSearchChatHistoryTool()]
  }
}

/**
 * @description 创建按 BM25 相关性检索当前会话全部原文的工具。
 * @returns 全史检索工具。
 */
function createSearchChatHistoryTool(): AgentTool {
  return {
    name: 'search_chat_history',
    description: 'Search the full raw history of the current chat session by keywords.',
    definition: {
      type: 'function',
      function: {
        name: 'search_chat_history',
        description:
          'Search all raw messages of the current chat session when the summary and recent context are not enough.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['query'],
          properties: {
            query: { type: 'string', description: '检索关键词或短语' },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 20,
              description: '返回条数上限，缺省 6'
            }
          }
        }
      }
    },
    execute: async (input: Record<string, unknown>, context) => {
      const query = typeof input.query === 'string' ? input.query.trim() : ''
      const limit = Math.max(1, Math.min(Number(input.limit) || DEFAULT_QUERY_LIMIT, 20))
      const searchable = context.session.messages.filter(
        (message) => message.content.trim() && message.status !== 'error'
      )
      const searchIndex = new MiniSearch({
        idField: 'id',
        fields: ['text'],
        tokenize,
        processTerm: (term: string) => term
      })
      searchIndex.addAll(
        searchable.map((message) => ({
          id: message.id,
          text: [
            message.content,
            ...(message.attachments || [])
              .map((attachment) => attachment.analysis.trim())
              .filter(Boolean)
          ].join('\n')
        }))
      )
      const scored = searchIndex.search(query)
      const byId = new Map(searchable.map((message) => [message.id, message]))
      const records: {
        messageId: string
        role: (typeof searchable)[number]['role']
        senderId: string
        createdAt: string
        text: string
      }[] = []
      for (const item of scored.slice(0, limit)) {
        const message = byId.get(item.id)
        if (!message) {
          continue
        }
        records.push({
          messageId: message.id,
          role: message.role,
          senderId: message.senderId,
          createdAt: message.createdAt,
          text:
            message.content.length > SNIPPET_MAX_LENGTH
              ? `${message.content.slice(0, SNIPPET_MAX_LENGTH)}…`
              : message.content
        })
      }
      return {
        status: 'completed' as const,
        data: { records, truncated: false },
        sourceIds: records.map((record) => record.messageId),
        complete: true
      }
    }
  }
}
