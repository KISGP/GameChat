/**
 * @description 记忆整文改写的整理模型消息构造（纯函数）。
 */

/** 记忆改写消息对：system 与 user 两条消息的纯文本内容。 */
export type MemoryRewriteMessages = {
  system: string
  user: string
}

/**
 * @description 构造记忆整文改写的整理模型消息。
 * @param input 当前记忆 MD 全文与带消息编号的新压缩区间转录。
 * @returns system 与 user 两条消息的纯文本内容。
 * @remarks 提示词要求模型输出改写后的完整记忆 Markdown 全文；空输出由调用方按失败处理并保留旧文。
 */
export function buildMemoryRewriteMessages(input: {
  currentMemory: string
  transcript: string
}): MemoryRewriteMessages {
  const system = `你是记忆整理器。把提供的对话区间中值得长期记住的内容融入当前记忆，输出整理后的完整记忆。
要求：
- 只提取长期有效的事实：用户的身份、偏好、目标、承诺，以及用户与角色之间的关系与约定。
- 一次性寒暄、剧情过程细节、情绪起伏不写入记忆。
- 与既有记忆重复时不要叠加，过时或矛盾的内容直接修正或删除。
- 用简洁的 Markdown 列表书写，每条一行；不要标题、不要解释、不要代码块标记。
- 没有需要新增或修改的内容时，原样输出当前记忆全文。
- 只输出记忆正文。`
  const user = `[当前记忆]
${input.currentMemory || '（暂无记忆）'}

[新压缩对话区间]（行首 [n] 为消息编号）
${input.transcript}`
  return { system, user }
}
