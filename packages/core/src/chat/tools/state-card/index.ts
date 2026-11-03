import type { AgentTool, AgentToolPackage } from '../../../tools'
import { getChatStateCardService } from '../../state-card'

/**
 * @description 创建会话状态卡自编辑工具包：read_state_card 重读全文，append_state_card 追加一行，write_state_card 整文替换。
 * @returns 状态卡工具包。
 * @remarks 状态卡跟会话走：一张卡记录整个会话共享的剧情状态，任意发言角色（含群聊成员）的回合都可维护。
 *   状态卡记录精确状态，事件经过由滚动摘要负责。
 */
export function createStateCardToolPackage(): AgentToolPackage {
  return {
    id: 'state-card',
    routingPrompt: `状态卡规则：

1. 状态卡记录当前剧情的精确状态（位置、时间、旗标、好感当前值、开放线索等），其全文已附在对话中；事件经过由滚动摘要负责，不要把叙事写进状态卡。
2. 仅当剧情推进实际改变了状态时才写：小更新用 append_state_card 追加一行；内容变乱或需要全面整理时用 write_state_card 整文替换。
3. write_state_card 的 card 参数是改写后的完整状态卡全文，不是增量片段；提交前与上下文中的既有内容比对，避免把旧状态写回去或遗漏仍然有效的状态。
4. 不确定当前内容时可调用 read_state_card 重读确认。`,
    tools: [createReadStateCardTool(), createAppendStateCardTool(), createWriteStateCardTool()]
  }
}

/**
 * @description 创建重读状态卡全文的工具。
 * @returns read_state_card 工具。
 */
function createReadStateCardTool(): AgentTool {
  return {
    name: 'read_state_card',
    description: 'Read your own session state card (Markdown) to confirm the story state.',
    definition: {
      type: 'function',
      function: {
        name: 'read_state_card',
        description: 'Read your own session state card content.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {}
        }
      }
    },
    execute: async (_input: Record<string, unknown>, context) => {
      const content = await getChatStateCardService().getSessionCard(
        context.session.ownerId,
        context.session.id,
        context.character.id
      )
      return {
        status: 'completed' as const,
        data: { card: content || '（暂无状态卡）' },
        complete: true
      }
    }
  }
}

/**
 * @description 创建向状态卡末尾追加一行的工具。
 * @returns append_state_card 工具。
 */
function createAppendStateCardTool(): AgentTool {
  return {
    name: 'append_state_card',
    description: 'Append one line to your own session state card when a story state value changes.',
    definition: {
      type: 'function',
      function: {
        name: 'append_state_card',
        description:
          'Append a single line to your own session state card. Use it for small state updates such as a changed location, flag or open thread.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['entry'],
          properties: {
            entry: {
              type: 'string',
              description: '要追加的一行状态正文'
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
          data: { appended: false, message: '状态卡条目为空，未追加。' },
          complete: true
        }
      }
      const saved = await getChatStateCardService().appendSessionCard(
        context.session.ownerId,
        context.session.id,
        context.character.id,
        entry
      )
      return {
        status: 'completed' as const,
        data: { appended: true, length: saved.length },
        complete: true
      }
    }
  }
}

/**
 * @description 创建整文替换状态卡的工具。
 * @returns write_state_card 工具。
 * @remarks 提交空全文时拒绝写入并给出可读说明。
 */
function createWriteStateCardTool(): AgentTool {
  return {
    name: 'write_state_card',
    description:
      'Replace your own session state card with the provided full Markdown for a thorough reorganization.',
    definition: {
      type: 'function',
      function: {
        name: 'write_state_card',
        description:
          'Overwrite your own session state card with the complete rewritten Markdown. Pass the full content, not a fragment.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['card'],
          properties: {
            card: {
              type: 'string',
              description: '改写后的完整状态卡全文（Markdown）'
            }
          }
        }
      }
    },
    execute: async (input: Record<string, unknown>, context) => {
      const card = typeof input.card === 'string' ? input.card.trim() : ''
      if (!card) {
        return {
          status: 'completed' as const,
          data: { saved: false, message: '状态卡全文为空，未写入。' },
          complete: true
        }
      }
      const saved = await getChatStateCardService().saveSessionCard(
        context.session.ownerId,
        context.session.id,
        context.character.id,
        card
      )
      return {
        status: 'completed' as const,
        data: { saved: true, length: saved.length },
        complete: true
      }
    }
  }
}
