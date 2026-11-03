import type { AgentPolicy } from '../tools'

/**
 * @description Agent 工具循环轮次预算，是内部常量而非用户设置。
 * @remarks 流程步骤上限按本常量推导（见 chat/flow/engine 的 flowStepLimit），
 *   调整本值时必须同步核对该推导。
 */
export const MAX_TOOL_ROUNDS = 100

/**
 * @description 创建 Agent 循环共享的最大工具调用轮次策略。
 * @returns 工具调用轮次策略。
 */
export function createAgentLoopPolicy(): Pick<AgentPolicy, 'maxToolRounds'> {
  return { maxToolRounds: MAX_TOOL_ROUNDS }
}
