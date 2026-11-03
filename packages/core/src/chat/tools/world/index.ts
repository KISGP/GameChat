import type { AgentTool, AgentToolPackage } from '../../../tools'
import type { ChatWorldSearch } from '../../types'

/**
 * @description 创建检索 world 背景资料（剧情场景与名词解释）的只读工具包。
 * @param world 背景资料检索适配。
 * @returns 独立的 World 背景资料工具包。
 */
export function createWorldToolPackage(world: ChatWorldSearch): AgentToolPackage {
  return {
    id: 'world',
    routingPrompt: `世界观规则：

1. 对话话题涉及原作事件、人物、地点、组织、物品或设定时，主动调用 search_world，不要等用户明确提问。
2. 查询词从用户原话提炼：先解析指代，再展开为具体的人名、地名、事件名、物品名；结果与话题不相关时换关键词再次调用。
3. 查到的场景与词条是世界观的既定事实：以角色自身经历与亲眼所见的口吻自然消化，绝不以「查资料」「检索到」的口吻提及工具。
4. 没有命中或结果与话题无关时，凭角色人格与已有上下文自然回应；绝不编造原作事实，也绝不向用户暴露检索机制。
5. 引用剧情与设定时以检索结果为准，不用模型自身对原作的记忆补完细节。`,
    tools: [createSearchWorldTool(world)]
  }
}

/**
 * @description 创建按自然语言查询检索本地背景资料的工具。
 * @param world 本地 World 资料服务。
 * @returns search_world 工具。
 */
function createSearchWorldTool(world: ChatWorldSearch): AgentTool {
  return {
    name: 'search_world',
    description:
      'Search the local world lore (story scenes and glossary terms) with a natural-language query. Returns the most relevant story scenes (dialogue transcripts with context headers) and glossary definitions. Use it whenever the conversation touches canon events, characters, places, organizations, items or settings.',
    definition: {
      type: 'function',
      function: {
        name: 'search_world',
        description:
          'Search story scenes and glossary terms relevant to the query. An empty result means nothing matched; respond without inventing canon facts.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['query'],
          properties: {
            query: {
              type: 'string',
              description:
                "Keywords derived from the user's words: resolve pronouns and expand character, place and event names."
            }
          }
        }
      }
    },
    execute: async (input: Record<string, unknown>) => {
      if (typeof input.query !== 'string' || !input.query.trim()) {
        return {
          status: 'failed' as const,
          error:
            "query (string) is required: derive keywords from the user's words about the topic."
        }
      }
      const result = await world.search(input.query.trim())
      return {
        status: 'completed' as const,
        data: { scenes: result.scenes, terms: result.terms },
        sourceIds: [
          ...result.scenes.map((scene) => `${scene.category}/${scene.task}/${scene.title}`),
          ...result.terms.map((term) => term.term)
        ],
        complete: true
      }
    }
  }
}
