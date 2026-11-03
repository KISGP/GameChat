import type {
  CharacterPromptDocument,
  CharacterRegistry,
  FlowDebugEvent,
  FlowDebugResult,
  FlowDebugStartRequest,
  FlowEditorOpenRequest,
  FlowExportResult,
  FlowPackage,
  FlowPackageSummary,
  FlowToolCatalogEntry,
  ProviderStore
} from '@gamechat/type'

/**
 * @description 列出已安装流程包摘要。
 * @returns 用户流程包的标识与显示名。
 */
export function listFlows(): Promise<FlowPackageSummary[]> {
  return window.flows.listFlows()
}

/**
 * @description 读取一个流程包。
 * @param id 流程包标识。
 * @returns 流程包完整内容。
 */
export function loadFlow(id: string): Promise<FlowPackage> {
  return window.flows.loadFlow(id)
}

/**
 * @description 保存流程包：传入流程包 JSON 文本，主进程归一化校验后落盘。
 * @param raw 流程包 JSON 文本。
 * @returns 保存后的流程包；结构非法时主进程抛错。
 */
export function saveFlow(raw: string): Promise<FlowPackage> {
  return window.flows.saveFlow(raw)
}

/**
 * @description 删除一个流程包。
 * @param id 流程包标识。
 */
export function deleteFlow(id: string): Promise<void> {
  return window.flows.deleteFlow(id)
}

/**
 * @description 导出流程包：主进程弹保存对话框并写文件。
 * @param id 流程包标识。
 * @returns 导出结果；用户取消时 canceled 为 true。
 */
export function exportFlow(id: string): Promise<FlowExportResult> {
  return window.flows.exportFlow(id)
}

/**
 * @description 订阅主窗口请求打开某流程的推送。
 * @param listener 接收种类与流程标识的回调。
 * @returns 用于取消订阅的清理函数。
 * @remarks 编排窗口已存在时，主窗口的「编辑」入口经此切换当前编辑的流程。
 */
export function onOpenFlow(
  listener: (request: FlowEditorOpenRequest) => void
): () => void {
  return window.agentLab.onOpenFlow(listener)
}

/**
 * @description 用当前画布流程启动一次临时会话调试。
 * @param request 调试请求。
 * @returns 调试终态。
 */
export function debugStart(request: FlowDebugStartRequest): Promise<FlowDebugResult> {
  return window.agentLab.debugStart(request)
}

/**
 * @description 停止在途调试运行。
 * @param requestId 调试请求标识。
 * @returns 找到并触发取消时返回 true。
 */
export function debugStop(requestId: string): Promise<boolean> {
  return window.agentLab.debugStop(requestId)
}

/**
 * @description 订阅调试运行事件。
 * @param listener 调试事件回调。
 * @returns 用于取消订阅的清理函数。
 */
export function onDebugEvent(listener: (event: FlowDebugEvent) => void): () => void {
  return window.agentLab.onDebugEvent(listener)
}

/**
 * @description 读取一个角色的提示词文档，供角色提示词节点从已有角色填充。
 * @param characterId 角色标识。
 * @returns 角色提示词文档。
 */
export function getCharacterPrompt(characterId: string): Promise<CharacterPromptDocument> {
  return window.ai.getCharacterPrompt(characterId)
}

/**
 * @description 读取本地角色注册表，供角色提示词节点列出可填充的角色。
 * @returns 角色注册表快照。
 */
export function getCharacterRegistry(): Promise<CharacterRegistry> {
  return window.characters.getCharacterRegistry()
}

/**
 * @description 读取供应商与模型配置，供调试界面选择模型。
 * @returns 供应商配置集合。
 */
export function getProviders(): Promise<ProviderStore> {
  return window.settings.getProviders()
}

/**
 * @description 列出调试运行可绑定的工具；模拟角色多于一个按群聊回合解析。
 * @param characterCount 调试将使用的模拟角色数量。
 * @returns 工具包标识、工具名与描述。
 */
export function getToolCatalog(characterCount: number): Promise<FlowToolCatalogEntry[]> {
  return window.agentLab.getToolCatalog(characterCount)
}
