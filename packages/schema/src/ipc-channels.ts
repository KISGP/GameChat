/**
 * @description 主进程与渲染层之间的 IPC 通道名常量：广播与监听两侧共用的单一事实源。
 */

/** 角色注册表变更推送通道。 */
export const CHARACTER_REGISTRY_CHANGED_CHANNEL = 'character:registryChanged'

/** 角色下载进度推送通道。 */
export const CHARACTER_DOWNLOAD_PROGRESS_CHANNEL = 'character:downloadProgress'

/** 流程包存储变更推送通道：编排窗口保存、删除或导入流程后发布最新用户流程摘要列表。 */
export const FLOW_STORES_CHANGED_CHANNEL = 'flows:storesChanged'

/** 聊天运行事件推送通道。 */
export const CHAT_RUN_EVENT_CHANNEL = 'chat:run:event'

/** world 资料下载进度推送通道。 */
export const WORLD_SYNC_PROGRESS_CHANNEL = 'world:downloadProgress'

/** 更新状态推送通道。 */
export const UPDATER_STATE_CHANNEL = 'update:state'

/** 编排调试运行事件推送通道。 */
export const AGENT_LAB_DEBUG_EVENT_CHANNEL = 'agent-lab:debug-event'
