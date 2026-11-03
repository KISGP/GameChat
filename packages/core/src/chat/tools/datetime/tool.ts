import type { AgentTool } from '../../../tools'

/**
 * @description 创建返回指定 IANA 时区当前日期和时间的只读工具。
 * @returns 当前时间工具。
 */
export function createCurrentDatetimeTool(): AgentTool {
  return {
    name: 'get_current_datetime',
    description: 'Get the current date and time for a requested IANA timezone.',
    definition: {
      type: 'function',
      function: {
        name: 'get_current_datetime',
        description: 'Get the current date and time for a requested IANA timezone.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            timezone: { type: 'string', description: 'IANA timezone such as Asia/Shanghai.' }
          }
        }
      }
    },
    execute: async (input) => {
      const timezone =
        typeof input.timezone === 'string' && input.timezone.trim()
          ? input.timezone.trim()
          : Intl.DateTimeFormat().resolvedOptions().timeZone
      try {
        return {
          status: 'completed',
          data: {
            timezone,
            value: new Intl.DateTimeFormat('zh-CN', {
              dateStyle: 'full',
              timeStyle: 'long',
              timeZone: timezone
            }).format(new Date())
          },
          complete: true
        }
      } catch (error) {
        throw new Error(
          `Invalid timezone: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
  }
}
