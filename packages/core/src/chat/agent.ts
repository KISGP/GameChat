import type { AgentToolPackage } from '../tools'
import type { AgentPolicy } from '../tools'
import { createDatetimeToolPackage } from './tools/datetime'
import { createWorldToolPackage } from './tools/world'
import { createMemoryToolPackage } from './tools/memory'
import { createChatHistoryToolPackage } from './tools/chat-history'
import { createMoeGirlpediaToolPackage } from './tools/moegirlpedia'
import { createChatImageToolPackage } from './tools/chat-images'
import { createChatEmoticonToolPackage } from './tools/chat-emoticons'
import { createStateCardToolPackage } from './tools/state-card'
import { MoeGirlpediaApiClient } from './tools/moegirlpedia/api'
import type { ChatWorldSearch, MemoryAdapter } from './types'

export type ChatToolServices = {
  world: ChatWorldSearch
  memory: MemoryAdapter
}

export type ChatToolPackageRequest = {
  policy: AgentPolicy
  /** 是否为群聊回合；群聊回合不绑定图片工具。 */
  isGroupTurn: boolean
  /** 当前回合是否存在可用表情目录。 */
  hasEmoticonCatalog: boolean
}

export type ChatToolPackageResolver = {
  /** @description 按回合请求解析对模型可见的工具包。 */
  resolveToolPackages: (request: ChatToolPackageRequest) => AgentToolPackage[]
  /** @description 返回当前策略会暴露给模型的工具名称。 */
  getEnabledToolNames: (policy: AgentPolicy) => string[]
}

/**
 * @description 创建聊天工具包解析器，全解析器生命周期内复用同一个萌娘百科 API 客户端。
 * @param services 聊天工具依赖的领域服务集合。
 * @returns 供 TurnEngine 使用的工具包解析器。
 * @remarks 工具包的路由规则段由各包自带（routingPrompt），运行时不维护工具专属路由知识；
 *   萌娘百科客户端为无状态匿名只读客户端，跨回合共享以复用其只读查询缓存。
 */
export function createChatToolPackageResolver(services: ChatToolServices): ChatToolPackageResolver {
  const moegirlpediaClient = new MoeGirlpediaApiClient()

  return {
    resolveToolPackages: (request) => {
      return [
        ...createEnabledToolPackages(services, request.policy, moegirlpediaClient),
        createChatHistoryToolPackage(),
        createStateCardToolPackage(),
        // 记忆读写工具受记忆总开关门控：开关关闭时记忆不注入也不可写。
        ...(services.memory.getSettings().enabled
          ? [createMemoryToolPackage(services.memory)]
          : []),
        ...(!request.isGroupTurn ? [createChatImageToolPackage()] : []),
        ...(request.hasEmoticonCatalog ? [createChatEmoticonToolPackage()] : [])
      ]
    },
    getEnabledToolNames: (policy) => [
      ...createEnabledToolPackages(services, policy, undefined).flatMap((toolPackage) =>
        toolPackage.tools.map((tool) => tool.name)
      ),
      ...createChatHistoryToolPackage().tools.map((tool) => tool.name),
      ...(services.memory.getSettings().enabled
        ? createMemoryToolPackage(services.memory).tools.map((tool) => tool.name)
        : [])
    ]
  }
}

/**
 * @description 根据当前策略创建本次回合可见的策略类工具包。
 * @param services 聊天工具依赖的领域服务集合。
 * @param policy 本回合生效的 Agent 策略。
 * @param moegirlpediaClient 当前解析器持有的萌娘百科客户端；仅枚举工具名时允许缺省。
 * @returns 本次回合可绑定到模型的策略类工具包。
 */
function createEnabledToolPackages(
  services: ChatToolServices,
  policy: AgentPolicy,
  moegirlpediaClient: MoeGirlpediaApiClient | undefined
): AgentToolPackage[] {
  const enabled = new Set<string>(policy.enabledToolPackageIds)
  const toolPackages = [
    createWorldToolPackage(services.world),
    createDatetimeToolPackage(),
    createMoeGirlpediaToolPackage(moegirlpediaClient)
  ]
  return toolPackages.filter((toolPackage) => enabled.has(toolPackage.id))
}
