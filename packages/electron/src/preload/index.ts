import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { ChatCompressSessionRequest, ChatDeleteSessionRequest, ChatDeleteGroupRequest, ChatExportSessionRequest, ChatRenameSessionRequest, ChatRemoveFailedTurnRequest, ChatSetGroupPinnedRequest, ChatRunEvent, ChatAppendMessageRequest, ChatCreateGroupRequest, ChatRetryMessageRequest, ChatTriggerRunRequest, CharacterDownloadProgress, CharacterRegistry, CharacterSessionStateCardView } from '@gamechat/type'
import { CHAT_RUN_EVENT_CHANNEL } from '@gamechat/schema'
import {
  CHARACTER_DOWNLOAD_PROGRESS_CHANNEL,
  CHARACTER_REGISTRY_CHANGED_CHANNEL,
  FLOW_STORES_CHANGED_CHANNEL
} from '@gamechat/schema'
import type { RendererLogEventPayload } from '@gamechat/type'
import { MemorySettingsStore } from '@gamechat/type'
import { AgentSettingsStore } from '@gamechat/type'
import { ProviderConnectionTestRequest, ProviderStore } from '@gamechat/type'
import { AppSettings } from '@gamechat/type'
import { AppearanceSettings, UnifiedSettings } from '@gamechat/type'
import type { StorageLocationTarget, StorageUsageSnapshot } from '@gamechat/type'
import type { WorldSyncProgress, WorldSyncResult, WorldSyncStatus } from '@gamechat/type'
import { WORLD_SYNC_PROGRESS_CHANNEL } from '@gamechat/schema'
import type { GachaUrlRequest } from '@gamechat/type'
import type { FlowExportResult, FlowPackage, FlowPackageSummary, FlowSettingsStore, FlowEditorOpenRequest, FlowDebugStartRequest, FlowDebugResult, FlowDebugEvent, FlowToolCatalogEntry } from '@gamechat/type'
import type { TtsSynthesisRequest } from '@gamechat/type'
import type { ChatEmoticonImage } from '@gamechat/schema'
import type { UpdaterSnapshot } from '@gamechat/type'
import { AGENT_LAB_DEBUG_EVENT_CHANNEL, UPDATER_STATE_CHANNEL } from '@gamechat/schema'

const api = {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  /** @description 请求主进程打开或聚焦 Agent 调度台独立窗口，可指定种类与要编辑的流程。 */
  openAgentLab: (request?: FlowEditorOpenRequest): Promise<void> =>
    ipcRenderer.invoke('agent-lab:openWindow', request)
}

const ai = {
  getCharacterPrompt: (characterId: string) =>
    ipcRenderer.invoke('chat:getCharacterPrompt', characterId),
  saveCharacterPrompt: (characterId: string, promptText: string) =>
    ipcRenderer.invoke('chat:saveCharacterPrompt', characterId, promptText),
  getSessions: () => ipcRenderer.invoke('chat:getSessions'),
  getSessionDetail: (sessionId: string) => ipcRenderer.invoke('chat:getSessionDetail', sessionId),
  getGroups: () => ipcRenderer.invoke('chat:getGroups'),
  createGroup: (request: ChatCreateGroupRequest) => ipcRenderer.invoke('chat:createGroup', request),
  getUserEmoticons: (): Promise<ChatEmoticonImage[]> => ipcRenderer.invoke('chat:getUserEmoticons'),
  getCharacterEmoticons: (characterId: string): Promise<ChatEmoticonImage[]> =>
    ipcRenderer.invoke('chat:getCharacterEmoticons', characterId),
  appendMessage: (request: ChatAppendMessageRequest) =>
    ipcRenderer.invoke('chat:appendMessage', request),
  triggerRun: (request: ChatTriggerRunRequest) => ipcRenderer.invoke('chat:triggerRun', request),
  retryMessage: (request: ChatRetryMessageRequest) =>
    ipcRenderer.invoke('chat:retryMessage', request),
  removeFailedTurn: (request: ChatRemoveFailedTurnRequest) =>
    ipcRenderer.invoke('chat:removeFailedTurn', request),
  deleteSession: (request: ChatDeleteSessionRequest) =>
    ipcRenderer.invoke('chat:deleteSession', request),
  deleteGroup: (request: ChatDeleteGroupRequest) => ipcRenderer.invoke('chat:deleteGroup', request),
  renameSession: (request: ChatRenameSessionRequest) =>
    ipcRenderer.invoke('chat:renameSession', request),
  compressSession: (request: ChatCompressSessionRequest) =>
    ipcRenderer.invoke('chat:compressSession', request),
  exportSession: (request: ChatExportSessionRequest) =>
    ipcRenderer.invoke('chat:exportSession', request),
  setGroupPinned: (request: ChatSetGroupPinnedRequest) =>
    ipcRenderer.invoke('chat:setGroupPinned', request),
  abortRun: (requestId: string) => ipcRenderer.invoke('chat:abortRun', requestId),
  getCharacterSessionStateCards: (characterId: string): Promise<CharacterSessionStateCardView[]> =>
    ipcRenderer.invoke('chat:getCharacterSessionStateCards', characterId),
  onRunEvent: (listener: (event: ChatRunEvent) => void) => {
    const wrappedListener = (_event: IpcRendererEvent, payload: ChatRunEvent): void => {
      listener(payload)
    }

    ipcRenderer.on(CHAT_RUN_EVENT_CHANNEL, wrappedListener)
    return () => {
      ipcRenderer.removeListener(CHAT_RUN_EVENT_CHANNEL, wrappedListener)
    }
  }
}

const characters = {
  getCharacterRegistry: (): Promise<CharacterRegistry> =>
    ipcRenderer.invoke('character:getRegistry'),
  syncNow: (): Promise<CharacterRegistry> => ipcRenderer.invoke('character:syncNow'),
  setCharacterVisibility: (characterId: string, visible: boolean): Promise<CharacterRegistry> =>
    ipcRenderer.invoke('character:setVisibility', characterId, visible),
  setCharacterPinned: (characterId: string, pinned: boolean): Promise<CharacterRegistry> =>
    ipcRenderer.invoke('character:setPinned', characterId, pinned),
  getCharacterSettings: (characterId: string) =>
    ipcRenderer.invoke('character:getSettings', characterId),
  setCharacterFishVoice: (characterId: string, referenceId: string) =>
    ipcRenderer.invoke('character:setFishVoice', characterId, referenceId),
  downloadCharacter: (characterId: string): Promise<CharacterRegistry> =>
    ipcRenderer.invoke('character:download', characterId),
  cancelCharacterDownload: (characterId: string): Promise<CharacterRegistry> =>
    ipcRenderer.invoke('character:cancelDownload', characterId),
  deleteCharacter: (characterId: string, deleteSessions: boolean): Promise<CharacterRegistry> =>
    ipcRenderer.invoke('character:delete', characterId, deleteSessions),
  /** @description 订阅主进程发布的角色注册表变更，并返回取消订阅函数。 */
  onRegistryChanged: (listener: (registry: CharacterRegistry) => void) => {
    const wrappedListener = (_event: IpcRendererEvent, registry: CharacterRegistry): void => {
      listener(registry)
    }
    ipcRenderer.on(CHARACTER_REGISTRY_CHANGED_CHANNEL, wrappedListener)
    return () => {
      ipcRenderer.removeListener(CHARACTER_REGISTRY_CHANGED_CHANNEL, wrappedListener)
    }
  },
  /** @description 订阅主进程发布的角色下载字节进度，并返回取消订阅函数。 */
  onDownloadProgress: (listener: (progress: CharacterDownloadProgress) => void) => {
    const wrappedListener = (_event: IpcRendererEvent, progress: CharacterDownloadProgress): void => {
      listener(progress)
    }
    ipcRenderer.on(CHARACTER_DOWNLOAD_PROGRESS_CHANNEL, wrappedListener)
    return () => {
      ipcRenderer.removeListener(CHARACTER_DOWNLOAD_PROGRESS_CHANNEL, wrappedListener)
    }
  }
}

const settings = {
  getUnifiedSettings: (): Promise<UnifiedSettings> =>
    ipcRenderer.invoke('settings:getUnifiedSettings'),
  getAppSettings: () => ipcRenderer.invoke('settings:getAppSettings'),
  saveAppSettings: (data: AppSettings) => ipcRenderer.invoke('settings:saveAppSettings', data),
  getProviders: () => ipcRenderer.invoke('settings:getProviders'),
  saveProviders: (data: ProviderStore) => ipcRenderer.invoke('settings:saveProviders', data),
  saveAgent: (data: AgentSettingsStore) => ipcRenderer.invoke('settings:saveAgent', data),
  saveFlows: (data: FlowSettingsStore) => ipcRenderer.invoke('settings:saveFlows', data),
  saveAppearance: (data: AppearanceSettings) => ipcRenderer.invoke('settings:saveAppearance', data),
  testProvider: (request: ProviderConnectionTestRequest) =>
    ipcRenderer.invoke('settings:testProvider', request),
  cancelProviderTest: (requestId: string) =>
    ipcRenderer.invoke('settings:cancelProviderTest', requestId)
}

const memory = {
  getSettings: () => ipcRenderer.invoke('memory:getSettings'),
  saveSettings: (data: MemorySettingsStore) => ipcRenderer.invoke('memory:saveSettings', data),
  getMarkdown: (characterId: string) => ipcRenderer.invoke('memory:getMarkdown', characterId),
  saveMarkdown: (characterId: string, content: string) =>
    ipcRenderer.invoke('memory:saveMarkdown', characterId, content),
  openDirectory: () => ipcRenderer.invoke('memory:openDirectory')
}

const logs = {
  track: (payload: RendererLogEventPayload) => ipcRenderer.invoke('log:track', payload),
  getViewerState: () => ipcRenderer.invoke('log:getViewerState'),
  readLogs: () => ipcRenderer.invoke('log:readLogs'),
  openFile: () => ipcRenderer.invoke('log:openFile'),
  clearLogs: () => ipcRenderer.invoke('log:clearLogs')
}

const storage = {
  getUsage: (refresh?: boolean): Promise<StorageUsageSnapshot> =>
    ipcRenderer.invoke('storage:getUsage', refresh),
  openLocation: (target: StorageLocationTarget): Promise<void> =>
    ipcRenderer.invoke('storage:openLocation', target)
}

const world = {
  getStatus: (): Promise<WorldSyncStatus> => ipcRenderer.invoke('world:getStatus'),
  checkForUpdates: (): Promise<WorldSyncStatus> => ipcRenderer.invoke('world:checkForUpdates'),
  download: (): Promise<WorldSyncResult> => ipcRenderer.invoke('world:download'),
  onDownloadProgress: (listener: (progress: WorldSyncProgress) => void) => {
    const wrappedListener = (_event: IpcRendererEvent, progress: WorldSyncProgress): void => {
      listener(progress)
    }
    ipcRenderer.on(WORLD_SYNC_PROGRESS_CHANNEL, wrappedListener)
    return () => {
      ipcRenderer.removeListener(WORLD_SYNC_PROGRESS_CHANNEL, wrappedListener)
    }
  }
}

const flows = {
  listFlows: (): Promise<FlowPackageSummary[]> => ipcRenderer.invoke('flows:listFlows'),
  /** @description 保存流程包：传入流程包 JSON 文本，主进程归一化校验后落盘。 */
  saveFlow: (raw: string): Promise<FlowPackage> => ipcRenderer.invoke('flows:saveFlow', raw),
  loadFlow: (id: string): Promise<FlowPackage> => ipcRenderer.invoke('flows:loadFlow', id),
  deleteFlow: (id: string): Promise<void> => ipcRenderer.invoke('flows:deleteFlow', id),
  /** @description 导出流程包：主进程弹保存对话框并写文件，用户取消时 canceled 为 true。 */
  exportFlow: (id: string): Promise<FlowExportResult> =>
    ipcRenderer.invoke('flows:exportFlow', id),
  /** @description 订阅流程存储变更推送（保存/删除/导入后携带最新摘要列表），返回取消订阅函数。 */
  onFlowsChanged: (listener: (flows: FlowPackageSummary[]) => void) => {
    const wrappedListener = (_event: IpcRendererEvent, flows: FlowPackageSummary[]): void => {
      listener(flows)
    }
    ipcRenderer.on(FLOW_STORES_CHANGED_CHANNEL, wrappedListener)
    return () => {
      ipcRenderer.removeListener(FLOW_STORES_CHANGED_CHANNEL, wrappedListener)
    }
  }
}

/** 编排窗口桥：打开请求、调试运行与调试事件；两窗口共用同一 preload，统一暴露。 */
const agentLab = {
  /** @description 订阅主窗口「编辑流程」请求；返回取消订阅函数。 */
  onOpenFlow: (listener: (request: FlowEditorOpenRequest) => void) => {
    const wrappedListener = (_event: IpcRendererEvent, request: FlowEditorOpenRequest): void => {
      listener(request)
    }

    ipcRenderer.on('agent-lab:open-flow', wrappedListener)
    return () => {
      ipcRenderer.removeListener('agent-lab:open-flow', wrappedListener)
    }
  },
  /** @description 用当前画布流程启动一次临时会话调试。 */
  debugStart: (request: FlowDebugStartRequest): Promise<FlowDebugResult> =>
    ipcRenderer.invoke('agent-lab:debugStart', request),
  /** @description 停止在途调试运行。 */
  debugStop: (requestId: string): Promise<boolean> =>
    ipcRenderer.invoke('agent-lab:debugStop', requestId),
  /** @description 列出调试运行可绑定的工具；模拟角色多于一个按群聊回合解析。 */
  getToolCatalog: (characterCount: number): Promise<FlowToolCatalogEntry[]> =>
    ipcRenderer.invoke('agent-lab:getToolCatalog', characterCount),
  /** @description 订阅调试运行事件。 */
  onDebugEvent: (listener: (event: FlowDebugEvent) => void) => {
    const wrappedListener = (_event: IpcRendererEvent, event: FlowDebugEvent): void => {
      listener(event)
    }

    ipcRenderer.on(AGENT_LAB_DEBUG_EVENT_CHANNEL, wrappedListener)
    return () => {
      ipcRenderer.removeListener(AGENT_LAB_DEBUG_EVENT_CHANNEL, wrappedListener)
    }
  }
}

const tools = {
  getGachaUrl: (request?: GachaUrlRequest) => ipcRenderer.invoke('tools:getGachaUrl', request)
}


const update = {
  /** @description 读取当前更新快照（应用版本与更新阶段）。 */
  getState: (): Promise<UpdaterSnapshot> => ipcRenderer.invoke('update:getState'),
  /** @description 手动触发一次更新检查。 */
  check: (): Promise<UpdaterSnapshot> => ipcRenderer.invoke('update:check'),
  /** @description 下载已发现的新版本安装包。 */
  download: (): Promise<UpdaterSnapshot> => ipcRenderer.invoke('update:download'),
  /** @description 取消进行中的更新下载。 */
  cancel: (): Promise<UpdaterSnapshot> => ipcRenderer.invoke('update:cancel'),
  /** @description 退出应用并安装已下载的更新，完成后重新启动。 */
  install: (): Promise<void> => ipcRenderer.invoke('update:install'),
  /** @description 订阅主进程推送的更新状态快照。 */
  onState: (listener: (snapshot: UpdaterSnapshot) => void) => {
    const wrappedListener = (_event: IpcRendererEvent, snapshot: UpdaterSnapshot): void => {
      listener(snapshot)
    }
    ipcRenderer.on(UPDATER_STATE_CHANNEL, wrappedListener)
    return () => {
      ipcRenderer.removeListener(UPDATER_STATE_CHANNEL, wrappedListener)
    }
  }
}

const tts = {
  /** @description 请求主进程根据当前 provider 与角色声音设置生成消息语音。 */
  synthesize: (request: TtsSynthesisRequest) => ipcRenderer.invoke('tts:synthesize', request),
  /** @description 请求主进程停止指定的正在生成语音。 */
  cancel: (requestId: string) => ipcRenderer.invoke('tts:cancel', requestId),
  /** @description 查询已安装角色的 index-tts 参考音色下载状态。 */
  getCharacterVoiceStatus: (characterId: string) =>
    ipcRenderer.invoke('tts:getCharacterVoiceStatus', characterId),
  /** @description 读取角色参考音色文件字节，供渲染层转 blob 播放。 */
  getCharacterVoiceData: (characterId: string) =>
    ipcRenderer.invoke('tts:getCharacterVoiceData', characterId),
  /** @description 检查角色在当前 provider 下是否具备语音合成前提（配置完整且音色可用）。 */
  checkVoiceReadiness: (characterId: string) =>
    ipcRenderer.invoke('tts:checkVoiceReadiness', characterId),
  /** @description 测试当前本地 TTS 引擎服务是否可访问。 */
  testLocalEngineConnection: () => ipcRenderer.invoke('tts:testLocalEngineConnection')
}

const exposedApis = {
  api,
  ai,
  characters,
  settings,
  flows,
  agentLab,
  memory,
  logs,
  storage,
  world,
  tools,
  tts,
  update
}

if (process.contextIsolated) {
  try {
    Object.entries(exposedApis).forEach(([name, value]) => {
      contextBridge.exposeInMainWorld(name, value)
    })
  } catch (error) {
    console.error(error)
  }
} else {
  Object.assign(window, exposedApis)
}
