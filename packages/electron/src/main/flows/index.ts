/**
 * @description 流程域宿主适配：通用流程包存储、当前流程解析与导入检查。
 * @remarks 引擎与存储在 core（chat/flow 与 flows），本模块只做宿主装配：
 *   用户流程落盘在应用数据目录的 flows/，内置标准流程从随包资源 flows/ 读取。
 */
import { FLOW_STANDARD_ID } from '@gamechat/type'
import type { FlowPackage, FlowPackageSummary } from '@gamechat/type'
import { FLOW_STORES_CHANGED_CHANNEL } from '@gamechat/schema'
import { createFlowPackageStore, type FlowPackageStore } from '@gamechat/core'
import { broadcastToAllWindows } from '../../broadcast'
import { logger } from '../logging/index'
import { getUnifiedSettingsStore, saveFlowSettings } from '../settings/index'
import { getAppDataRoot, getBundledResourcePath } from '../utils/path'

/** 进程内共享的流程包存储；惰性构造。 */
let store: FlowPackageStore | null = null

/**
 * @description 获取流程包存储单例。
 * @returns 惰性构造的流程包存储。
 */
export function getFlowStore(): FlowPackageStore {
  if (!store) {
    store = createFlowPackageStore({
      appDataRoot: () => getAppDataRoot(),
      builtinDir: getBundledResourcePath('flows'),
      log: logger
    })
  }
  return store
}

/**
 * @description 读取设置中当前生效的流程标识。
 * @returns 当前流程标识。
 */
async function readCurrentFlowId(): Promise<string> {
  const settings = await getUnifiedSettingsStore().get()
  return settings.flows.currentFlowId
}

/**
 * @description 读取当前生效的通用流程包。
 * @returns 当前流程包；读取失败时回退内置标准流程。
 * @remarks 单聊与群聊共用同一份流程，行为差异由流程内的人数分支表达。
 */
export async function getFlow(): Promise<FlowPackage> {
  const flowStore = getFlowStore()
  const flowId = await readCurrentFlowId()
  try {
    return await flowStore.load(flowId)
  } catch (error) {
    void logger.warn(
      'ai',
      'flow-current-fallback-standard',
      'Current flow is unavailable; falling back to the built-in standard flow',
      {
        flowId,
        error: error instanceof Error ? error.message : String(error)
      }
    )
    return flowStore.load(FLOW_STANDARD_ID)
  }
}

/**
 * @description 列出用户流程包。
 * @returns 全部流程摘要列表：内置 standard 在首位，用户流程在后。
 */
export function listFlows(): Promise<FlowPackageSummary[]> {
  return getFlowStore().list()
}

/**
 * @description 读取一个流程包。
 * @param id 流程标识。
 * @returns 流程包完整内容。
 */
export function loadFlow(id: string): Promise<FlowPackage> {
  return getFlowStore().load(id)
}

/**
 * @description 向所有窗口广播流程存储的最新摘要列表。
 * @returns 广播完成后的 Promise。
 * @remarks 保存、删除与导入通道在落盘成功后调用；订阅端拿到列表即可刷新，无需再拉取。
 */
async function announceFlowsChanged(): Promise<void> {
  broadcastToAllWindows(FLOW_STORES_CHANGED_CHANNEL, await getFlowStore().list())
}

/**
 * @description 删除一个用户流程包；删除当前流程时把当前流程回退到标准流程。
 * @param id 流程标识。
 * @returns 删除完成后的 Promise。
 */
export async function deleteFlow(id: string): Promise<void> {
  await getFlowStore().delete(id)
  const settings = await getUnifiedSettingsStore().get()
  if (settings.flows.currentFlowId === id) {
    await saveFlowSettings({ currentFlowId: FLOW_STANDARD_ID })
  }
  await announceFlowsChanged()
}

/**
 * @description 保存一份流程包。
 * @param raw 导入通道读取的未受信任数据。
 * @returns 保存后的流程包。
 * @throws 结构非法或写入失败时抛出。
 */
export async function saveFlow(raw: unknown): Promise<FlowPackage> {
  const pkg = await getFlowStore().save(raw)
  await announceFlowsChanged()
  return pkg
}
