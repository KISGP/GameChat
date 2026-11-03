import type { BaseMessage } from '@langchain/core/messages'

/**
 * @description 提取 LangChain 消息内容中的文本部分。
 * @param content 模型消息或增量携带的内容，可为字符串或多模态内容块数组。
 * @returns 合并后的文本内容；无可提取文本时返回空字符串。
 * @remarks 这是消息文本提取的唯一实现，回合终答、调度评分与工具调用回退共用。
 */
export function contentToText(content: unknown): string {  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part
      }

      if (!part || typeof part !== 'object') {
        return ''
      }

      const data = part as { text?: unknown; content?: unknown }
      if (typeof data.text === 'string') {
        return data.text
      }

      return typeof data.content === 'string' ? data.content : ''
    })
    .join('')
}

/**
 * @description 从装配后的模型历史消息中取当前触发输入的文本。
 * @param messages 装配后的模型历史消息。
 * @returns 末位消息的文本；消息为空或无文本时返回空字符串。
 * @remarks 装配已排除本回合的 assistant 占位，末位消息即触发本回合的最新输入（单聊为用户
 *   消息，群聊可为任一参与者发言），其文本作为消化阶段的信息需求锚点与流程变量 last_user。
 */
export function findCurrentInputText(messages: readonly BaseMessage[]): string {
  const last = messages[messages.length - 1]
  return last ? contentToText(last.content).trim() : ''
}
