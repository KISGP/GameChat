import type { AgentToolPackage } from '../../../tools'
import { createCurrentDatetimeTool } from './tool'

/**
 * @description 创建提供当前时间查询的只读工具包。
 * @returns 时间工具包。
 */
export function createDatetimeToolPackage(): AgentToolPackage {
  return {
    id: 'datetime',
    routingPrompt: `时间规则：

1. 仅当用户询问当前日期、当前时间或其他时效性时间时，才调用当前时间工具。
2. 剧情（Story）或记忆问题不要使用当前时间工具。`,
    tools: [createCurrentDatetimeTool()]
  }
}
