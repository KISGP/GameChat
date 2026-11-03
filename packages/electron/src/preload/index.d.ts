import type { ChatCompressSessionRequest, ChatCompressSessionResult, ChatDeleteSessionRequest, ChatDeleteSessionResult, ChatDeleteGroupRequest, ChatDeleteGroupResult, ChatExportSessionRequest, ChatExportSessionResult, ChatRenameSessionRequest, ChatRenameSessionResult, ChatRemoveFailedTurnRequest, ChatRemoveFailedTurnResult, ChatSetGroupPinnedRequest, ChatRetryMessageRequest, ChatRunAccepted, CharacterDownloadProgress, CharacterRegistry, ChatRunEvent, ChatAppendMessageRequest, ChatCreateGroupRequest, ChatGroup, ChatTriggerRunRequest, ChatAppendMessageResult, CharacterPromptDocument, ConversationSession, CharacterSessionStateCardView, ConversationSessionSummary } from '@gamechat/type'
import type { ChatEmoticonImage } from '@gamechat/schema'
import { CharacterSettings } from '@gamechat/type'
import type { LogEntry, LogViewerState, RendererLogEventPayload } from '@gamechat/type'
import { MemorySettingsStore } from '@gamechat/type'
import { AgentSettingsStore } from '@gamechat/type'
import { ProviderConnectionTestRequest, ProviderConnectionTestResult, ProviderStore } from '@gamechat/type'
import { AppSettings } from '@gamechat/type'
import { AppearanceSettings, UnifiedSettings } from '@gamechat/type'
import type { StorageLocationTarget, StorageUsageSnapshot } from '@gamechat/type'
import type { WorldSyncProgress, WorldSyncResult, WorldSyncStatus } from '@gamechat/type'
import type { GachaUrlRequest, GachaUrlResult } from '@gamechat/type'
import type { FlowExportResult, FlowPackage, FlowPackageSummary, FlowSettingsStore, FlowEditorOpenRequest, FlowDebugStartRequest, FlowDebugResult, FlowDebugEvent, FlowToolCatalogEntry } from '@gamechat/type'
import type { TtsCharacterVoiceStatus, TtsConnectionTestResult, TtsSynthesisRequest, TtsSynthesisResult, TtsVoiceReadiness } from '@gamechat/type'
import type { UpdaterSnapshot } from '@gamechat/type'

declare global {
  interface Window {
    api: {
      minimize: () => void
      maximize: () => void
      openAgentLab: (request?: FlowEditorOpenRequest) => Promise<void>
    }
    ai: {
      getCharacterPrompt: (characterId: string) => Promise<CharacterPromptDocument>
      saveCharacterPrompt: (
        characterId: string,
        promptText: string
      ) => Promise<CharacterPromptDocument>
      getSessions: () => Promise<ConversationSessionSummary[]>
      getSessionDetail: (sessionId: string) => Promise<ConversationSession | null>
      getGroups: () => Promise<ChatGroup[]>
      createGroup: (request: ChatCreateGroupRequest) => Promise<ChatGroup>
      getUserEmoticons: () => Promise<ChatEmoticonImage[]>
      getCharacterEmoticons: (characterId: string) => Promise<ChatEmoticonImage[]>
      appendMessage: (request: ChatAppendMessageRequest) => Promise<ChatAppendMessageResult>
      triggerRun: (request: ChatTriggerRunRequest) => Promise<ChatRunAccepted>
      retryMessage: (request: ChatRetryMessageRequest) => Promise<ChatRunAccepted>
      removeFailedTurn: (
        request: ChatRemoveFailedTurnRequest
      ) => Promise<ChatRemoveFailedTurnResult>
      deleteSession: (request: ChatDeleteSessionRequest) => Promise<ChatDeleteSessionResult>
      deleteGroup: (request: ChatDeleteGroupRequest) => Promise<ChatDeleteGroupResult>
      renameSession: (request: ChatRenameSessionRequest) => Promise<ChatRenameSessionResult>
      compressSession: (request: ChatCompressSessionRequest) => Promise<ChatCompressSessionResult>
      exportSession: (request: ChatExportSessionRequest) => Promise<ChatExportSessionResult>
      setGroupPinned: (request: ChatSetGroupPinnedRequest) => Promise<ChatGroup>
      abortRun: (requestId: string) => Promise<boolean>
      getCharacterSessionStateCards: (
        characterId: string
      ) => Promise<CharacterSessionStateCardView[]>
      onRunEvent: (listener: (event: ChatRunEvent) => void) => () => void
    }
    characters: {
      getCharacterRegistry: () => Promise<CharacterRegistry>
      syncNow: () => Promise<CharacterRegistry>
      setCharacterVisibility: (characterId: string, visible: boolean) => Promise<CharacterRegistry>
      setCharacterPinned: (characterId: string, pinned: boolean) => Promise<CharacterRegistry>
      getCharacterSettings: (characterId: string) => Promise<CharacterSettings>
      setCharacterFishVoice: (
        characterId: string,
        referenceId: string
      ) => Promise<CharacterSettings>
      downloadCharacter: (characterId: string) => Promise<CharacterRegistry>
      cancelCharacterDownload: (characterId: string) => Promise<CharacterRegistry>
      deleteCharacter: (characterId: string, deleteSessions: boolean) => Promise<CharacterRegistry>
      onRegistryChanged: (listener: (registry: CharacterRegistry) => void) => () => void
      onDownloadProgress: (listener: (progress: CharacterDownloadProgress) => void) => () => void
    }
    settings: {
      getUnifiedSettings: () => Promise<UnifiedSettings>
      getAppSettings: () => Promise<AppSettings>
      saveAppSettings: (settings: AppSettings) => Promise<AppSettings>
      getProviders: () => Promise<ProviderStore>
      saveProviders: (store: ProviderStore) => Promise<ProviderStore>
      saveAgent: (settings: AgentSettingsStore) => Promise<AgentSettingsStore>
      saveFlows: (settings: FlowSettingsStore) => Promise<FlowSettingsStore>
      saveAppearance: (appearance: AppearanceSettings) => Promise<AppearanceSettings>
      testProvider: (
        request: ProviderConnectionTestRequest
      ) => Promise<ProviderConnectionTestResult>
      cancelProviderTest: (requestId: string) => Promise<boolean>
    }
    flows: {
      listFlows: () => Promise<FlowPackageSummary[]>
      saveFlow: (raw: string) => Promise<FlowPackage>
      loadFlow: (id: string) => Promise<FlowPackage>
      deleteFlow: (id: string) => Promise<void>
      exportFlow: (id: string) => Promise<FlowExportResult>
      /** 订阅流程存储变更推送（保存/删除/导入后携带最新摘要列表）；返回取消订阅函数。 */
      onFlowsChanged: (listener: (flows: FlowPackageSummary[]) => void) => () => void
    }
    agentLab: {
      onOpenFlow: (listener: (request: FlowEditorOpenRequest) => void) => () => void
      debugStart: (request: FlowDebugStartRequest) => Promise<FlowDebugResult>
      debugStop: (requestId: string) => Promise<boolean>
      getToolCatalog: (characterCount: number) => Promise<FlowToolCatalogEntry[]>
      onDebugEvent: (listener: (event: FlowDebugEvent) => void) => () => void
    }
    memory: {
      getSettings: () => Promise<MemorySettingsStore>
      saveSettings: (store: MemorySettingsStore) => Promise<MemorySettingsStore>
      getMarkdown: (characterId: string) => Promise<string>
      saveMarkdown: (characterId: string, content: string) => Promise<string>
      openDirectory: () => Promise<void>
    }
    logs: {
      track: (payload: RendererLogEventPayload) => Promise<void>
      getViewerState: () => Promise<LogViewerState>
      readLogs: () => Promise<LogEntry[]>
      openFile: () => Promise<void>
      clearLogs: () => Promise<void>
    }
    storage: {
      getUsage: (refresh?: boolean) => Promise<StorageUsageSnapshot>
      openLocation: (target: StorageLocationTarget) => Promise<void>
    }
    world: {
      getStatus: () => Promise<WorldSyncStatus>
      checkForUpdates: () => Promise<WorldSyncStatus>
      download: () => Promise<WorldSyncResult>
      onDownloadProgress: (listener: (progress: WorldSyncProgress) => void) => () => void
    }
    tools: {
      getGachaUrl: (request?: GachaUrlRequest) => Promise<GachaUrlResult>
    }
    tts: {
      synthesize: (request: TtsSynthesisRequest) => Promise<TtsSynthesisResult>
      cancel: (requestId: string) => Promise<boolean>
      getCharacterVoiceStatus: (characterId: string) => Promise<TtsCharacterVoiceStatus>
      getCharacterVoiceData: (characterId: string) => Promise<Uint8Array>
      checkVoiceReadiness: (characterId: string) => Promise<TtsVoiceReadiness>
      testLocalEngineConnection: () => Promise<TtsConnectionTestResult>
    }
    update: {
      getState: () => Promise<UpdaterSnapshot>
      check: () => Promise<UpdaterSnapshot>
      download: () => Promise<UpdaterSnapshot>
      cancel: () => Promise<UpdaterSnapshot>
      install: () => Promise<void>
      onState: (listener: (snapshot: UpdaterSnapshot) => void) => () => void
    }
  }
}

export {}
