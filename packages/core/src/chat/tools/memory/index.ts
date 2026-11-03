import type { MemoryAdapter } from '../../types'
import type { AgentTool, AgentToolPackage } from '../../../tools'

/**
 * @description 创建长期记忆读写工具包：read_memory 重读记忆全文，append_memory 追加单条，write_memory 全量替换。
 * @param memory 长期记忆适配。
 * @returns 记忆工具包。
 */
export function createMemoryToolPackage(memory: MemoryAdapter): AgentToolPackage {
  return {
    id: 'chat-memory-tools',
    routingPrompt: `记忆工具规则：

1. 你的长期记忆全文已在上下文中，通常无需调用 read_memory。
2. 出现值得长期记住的内容时调用 append_memory 追加一条：用户明确要求记住的事，或你判断为重要的剧情事实（关系变化、承诺约定、重要决定）与用户的稳定偏好；与既有记忆重复的内容、琐碎日常不要追加。
3. 仅当用户明确要求整理、忘记或全面改写记忆时，才调用 write_memory；memory 参数必须是改写后的完整记忆全文（Markdown 列表，每条一行），不要用它追加单条内容。
4. 当用户质疑你记错了、或你怀疑上下文中的记忆缺少关键细节时，可调用 read_memory 重读确认。`,
    tools: [
      createReadMemoryTool(memory),
      createAppendMemoryTool(memory),
      createWriteMemoryTool(memory)
    ]
  }
}

/**
 * @description 创建向记忆末尾追加单条记录的工具。
 * @param memory 长期记忆服务。
 * @returns append_memory 工具。
 */
function createAppendMemoryTool(memory: MemoryAdapter): AgentTool {
  return {
    name: 'append_memory',
    description: 'Append one entry to your long-term memory when something worth keeping happens.',
    definition: {
      type: 'function',
      function: {
        name: 'append_memory',
        description:
          'Append a single memory entry to the end of your long-term memory. Use it for important story facts, commitments and stable user preferences; never append duplicates or trivial daily details.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['entry'],
          properties: {
            entry: {
              type: 'string',
              description: '要追加的一条记忆正文（一行 Markdown 列表项，无需携带列表符号）'
            }
          }
        }
      }
    },
    execute: async (input: Record<string, unknown>, context) => {
      const entry = typeof input.entry === 'string' ? input.entry.trim() : ''
      if (!entry) {
        return {
          status: 'completed' as const,
          data: { appended: false, message: '记忆条目为空，未追加。' },
          complete: true
        }
      }
      const saved = await memory.appendCharacterMemory(context.character.id, entry)
      return {
        status: 'completed' as const,
        data: { appended: true, length: saved.length },
        complete: true
      }
    }
  }
}

/**
 * @description 创建重读记忆全文的工具。
 * @param memory 长期记忆服务。
 * @returns read_memory 工具。
 */
function createReadMemoryTool(memory: MemoryAdapter): AgentTool {
  return {
    name: 'read_memory',
    description: 'Read your current long-term memory (Markdown) to confirm what you remember.',
    definition: {
      type: 'function',
      function: {
        name: 'read_memory',
        description: 'Read your current long-term memory content.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {}
        }
      }
    },
    execute: async (_input: Record<string, unknown>, context) => {
      const content = await memory.getCharacterMemory(context.character.id)
      return {
        status: 'completed' as const,
        data: { memory: content || '（暂无记忆）' },
        complete: true
      }
    }
  }
}

/**
 * @description 创建提交改写后完整记忆的工具。
 * @param memory 长期记忆服务。
 * @returns write_memory 工具。
 */
function createWriteMemoryTool(memory: MemoryAdapter): AgentTool {
  return {
    name: 'write_memory',
    description:
      'Rewrite your long-term memory with the provided full Markdown; use only when the user explicitly asks you to reorganize, forget or fully rewrite it.',
    definition: {
      type: 'function',
      function: {
        name: 'write_memory',
        description:
          'Overwrite your long-term memory with the full rewritten Markdown. Pass the complete memory, not a fragment.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['memory'],
          properties: {
            memory: {
              type: 'string',
              description: '改写后的完整记忆全文（Markdown 列表，每条一行）'
            }
          }
        }
      }
    },
    execute: async (input: Record<string, unknown>, context) => {
      const memoryText = typeof input.memory === 'string' ? input.memory.trim() : ''
      if (!memoryText) {
        return {
          status: 'completed' as const,
          data: { saved: false, message: '记忆全文为空，未写入。' },
          complete: true
        }
      }
      const saved = await memory.saveCharacterMemory(context.character.id, memoryText)
      return {
        status: 'completed' as const,
        data: { saved: true, length: saved.length },
        complete: true
      }
    }
  }
}
