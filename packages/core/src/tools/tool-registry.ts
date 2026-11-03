import type {
  AgentToolPackage,
  AgentTool,
  AgentToolCall,
  AgentToolCallRejection,
  AgentToolContext
} from './agent-types'

/**
 * @description 注册 Agent 工具包提供的工具，并协调工具包级别的调用校验。
 */
export class AgentToolRegistry {
  private readonly tools = new Map<string, AgentTool>()

  /**
   * @description 创建工具注册表并校验工具名称在所有工具包中唯一。
   * @param toolPackages 当前 Agent 启用的工具包。
   */
  constructor(private readonly toolPackages: AgentToolPackage[]) {
    toolPackages.forEach((toolPackage) => {
      toolPackage.tools.forEach((tool) => {
        if (this.tools.has(tool.name)) {
          throw new Error(`Duplicate Agent tool name: ${tool.name}`)
        }
        this.tools.set(tool.name, tool)
      })
    })
  }

  /**
   * @description 返回所有已注册工具的模型定义。
   * @returns 可绑定到模型的工具定义。
   */
  getDefinitions(): AgentTool['definition'][] {
    return [...this.tools.values()].map((tool) => tool.definition)
  }

  /**
   * @description 按名称查找已注册工具。
   * @param name 模型请求的工具名称。
   * @returns 匹配的工具；不存在时返回 `null`。
   */
  get(name: string): AgentTool | null {
    return this.tools.get(name) || null
  }

  /**
   * @description 汇总所有工具包对同一轮工具调用施加的拒绝结果。
   * @param calls 模型在当前轮请求的工具调用。
   * @param context 当前聊天与 Agent 上下文。
   * @returns 按调用 ID 索引的拒绝原因。
   */
  validateCalls(
    calls: AgentToolCall[],
    context: AgentToolContext
  ): Map<string, AgentToolCallRejection> {
    const rejections = new Map<string, AgentToolCallRejection>()
    this.toolPackages.forEach((toolPackage) => {
      toolPackage.validateCalls?.(calls, context).forEach((rejection) => {
        rejections.set(rejection.callId, rejection)
      })
    })
    return rejections
  }
}
