import type { AgentTool, AgentToolPackage } from '../../../tools'
import { DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT, MoeGirlpediaApiClient } from './api'

/**
 * @description 创建只读萌娘百科搜索和页面读取工具包。
 * @param client 可选的可复用萌娘百科 API 客户端。
 * @returns 萌娘百科 Agent 工具包。
 */
export function createMoeGirlpediaToolPackage(client = new MoeGirlpediaApiClient()): AgentToolPackage {
  return {
    id: 'moegirlpedia',
    routingPrompt: `萌娘百科规则：

1. 公开百科类问题、外部事实查询、游戏或作品介绍，且剧情、名词解释、记忆、时间工具都覆盖不了时，使用萌娘百科。
2. 对"某个游戏、作品、角色、组织、地点或名词是什么"这类一般问题，若答案能从 wiki 证据中获益，调用 search_moegirlpedia。
3. 页面精确标题未知时，先调用 search_moegirlpedia 再读页面。
4. 仅在搜索结果给出相关精确标题、或用户已给出精确标题时，才读取页面。
5. 用户需要详细事实信息时，不要停留在搜索结果标题；结束路由阶段前先读取最相关的精确页面。
6. 需要剧情工具时，不要用萌娘百科回答当前角色的原作剧情问题；也不要把它当作本地名词解释或长期记忆工具的替代品。
7. 用户要的是观点、改写、翻译、计算等不需要外部事实的任务时，不要调用萌娘百科。
8. 萌娘百科结果是其事实类回答的唯一事实来源；结果不支持某个细节时，不要用模型记忆补全，留待终答阶段说明证据不足。`,
    tools: [createSearchTool(client), createReadPageTool(client)]
  }
}

/**
 * @description 创建搜索萌娘百科页面的 Agent 工具。
 * @param client 萌娘百科 API 客户端。
 * @returns 搜索工具定义。
 */
function createSearchTool(client: MoeGirlpediaApiClient): AgentTool {
  return {
    name: 'search_moegirlpedia',
    description: 'Search Moegirlpedia for page titles matching a topic or an exact name.',
    definition: {
      type: 'function',
      function: {
        name: 'search_moegirlpedia',
        description:
          'Search Moegirlpedia for page titles. Returns titles, with short snippets when full-text matching is used. Read the most relevant page afterwards for details.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['query'],
          properties: {
            query: { type: 'string', minLength: 1, maxLength: 120 },
            limit: { type: 'integer', minimum: 1, maximum: MAX_SEARCH_LIMIT }
          }
        }
      }
    },
    execute: async (input, context) => {
      const query = parseText(input.query, 'query', 120)
      const limit = parseLimit(input.limit)
      const result = await client.search(query, limit, context.abortSignal)
      return {
        status: 'completed' as const,
        data: { query, channel: result.channel, items: result.items },
        sourceIds: result.items.map((item) => item.title),
        complete: true
      }
    }
  }
}

/**
 * @description 创建读取萌娘百科页面正文的 Agent 工具。
 * @param client 萌娘百科 API 客户端。
 * @returns 页面读取工具定义。
 */
function createReadPageTool(client: MoeGirlpediaApiClient): AgentTool {
  return {
    name: 'read_moegirlpedia_page',
    description: 'Read the plain-text content of one Moegirlpedia page.',
    definition: {
      type: 'function',
      function: {
        name: 'read_moegirlpedia_page',
        description:
          'Read one Moegirlpedia page by its exact title. Search first if the title is uncertain.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['title'],
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 160 }
          }
        }
      }
    },
    execute: async (input, context) => {
      const title = parseText(input.title, 'title', 160)
      const page = await client.readPage(title, context.abortSignal)
      return {
        status: 'completed' as const,
        data: { title: page.title, pageId: page.pageId, content: page.content, url: page.url },
        sourceIds: [page.title],
        complete: true
      }
    }
  }
}

/**
 * @description 校验工具输入中的文本字段。
 * @param value 未受信任的输入值。
 * @param field 字段名称。
 * @param maxLength 允许的最大字符数。
 * @returns 去除首尾空白后的文本。
 */
function parseText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${field} must be a non-empty string.`)
  const normalized = value.trim()
  if (normalized.length > maxLength)
    throw new Error(`${field} must be at most ${maxLength} characters.`)
  return normalized
}

/**
 * @description 校验搜索结果数量。
 * @param value 模型提供的数量参数。
 * @returns 规范化后的结果数量。
 */
function parseLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_SEARCH_LIMIT
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_SEARCH_LIMIT
  )
    throw new Error(`limit must be an integer between 1 and ${MAX_SEARCH_LIMIT}.`)
  return value
}
