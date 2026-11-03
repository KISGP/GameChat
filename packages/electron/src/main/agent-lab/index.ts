/**
 * @description Agent 编排窗口宿主适配：注册打开（可指定流程）或聚焦编排窗口的 IPC。
 * @remarks 流程包的读写经 flows:* 通道，本域承担窗口生命周期、调试运行与可用工具枚举。
 */
import type {
  FlowEditorOpenRequest,
  FlowToolCatalogEntry
} from '@gamechat/type'
import { AGENT_POLICY_TOOL_PACKAGE_IDS } from '@gamechat/schema'
import { createAgentLoopPolicy, createChatToolPackageResolver, getChatHost } from '@gamechat/core'
import { handleLogged } from '../ipc/logged-handler'
import { openAgentLabWindow } from './window'
import { filterDebugToolPackages, registerAgentLabDebugIpc } from './debug'

/**
 * @description 列出编排调试运行可绑定的工具。
 * @param characterCount 调试将使用的模拟角色数量：多于一个按群聊回合解析，不绑定图片工具。
 * @returns 工具包标识、工具名与描述。
 * @remarks 调试运行与真实聊天共用同一套工具包解析器；lab 调试固定启用全部可开关工具包，
 *   所以这里列出的就是运行时实际可调用的工具。
 */
async function listAvailableTools(characterCount: number): Promise<FlowToolCatalogEntry[]> {
  const resolver = createChatToolPackageResolver({
    world: getChatHost().getWorldSearch(),
    memory: getChatHost().getMemory()
  })
  const packages = filterDebugToolPackages(
    resolver.resolveToolPackages({
      policy: {
        ...createAgentLoopPolicy(),
        enabledToolPackageIds: [...AGENT_POLICY_TOOL_PACKAGE_IDS]
      },
      isGroupTurn: characterCount > 1,
      hasEmoticonCatalog: true
    })
  )
  return packages.flatMap((toolPackage) =>
    toolPackage.tools.map((tool) => ({
      packageId: toolPackage.id,
      name: tool.name,
      description: tool.description
    }))
  )
}

/**
 * @description 注册 Agent 编排窗口域 IPC handler。
 */
export function registerAgentLabIpc(): void {
  handleLogged(
    'agent-lab:openWindow',
    (_event, request?: FlowEditorOpenRequest) => openAgentLabWindow(request),
    (request?: FlowEditorOpenRequest) => ({
      flowId: request?.flowId ?? null
    })
  )
  handleLogged(
    'agent-lab:getToolCatalog',
    (_event, characterCount: number) => listAvailableTools(characterCount),
    (characterCount: number) => ({ characterCount })
  )
  registerAgentLabDebugIpc()
}
