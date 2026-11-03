import type { FlowPackageSummary } from '@gamechat/type'

/**
 * @description 列出已安装流程包摘要。
 * @returns 全部流程包的标识与显示名：内置 standard 在首位，用户流程在后。
 * @remarks 流程的导入、导出、复制与删除由流程画布经同一组 IPC 完成，渲染层设置页只读列表。
 */
export function listFlows(): Promise<FlowPackageSummary[]> {
  return window.flows.listFlows()
}

/**
 * @description 订阅流程存储变更推送：流程画布保存、删除或导入流程后收到最新摘要列表。
 * @param listener 收到最新用户流程摘要列表的回调。
 * @returns 取消订阅函数。
 */
export function onFlowsChanged(listener: (flows: FlowPackageSummary[]) => void): () => void {
  return window.flows.onFlowsChanged(listener)
}
