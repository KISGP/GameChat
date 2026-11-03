import { type AnimationPreference, type AppSettings, type TtsSettings, type GithubProxySource, type ChatImageProcessingSettings, type ChatSendMergeSettings, type ContextBudgetSettings, type ContextCompressionSettings, type TraceSettings, type UpdateCheckSettings } from '@gamechat/type'
import { createDefaultAppSettings, normalizeAppSettings } from '@gamechat/schema'
import { trackError, trackUiEvent } from '@renderer/app/telemetry'
import { saveAppSettings } from '@renderer/services/settings'
import { create } from 'zustand'

type AppSettingsStore = {
  settings: AppSettings
  isLoaded: boolean
  saveError: string | null
  hydrate: (settings: AppSettings) => void
  setAnimationPreference: (preference: AnimationPreference) => Promise<void>
  updateTraceSettings: (patch: Partial<TraceSettings>) => Promise<void>
  setMessageCollapseLineCount: (lineCount: number) => Promise<void>
  setSettingsSidebarExpanded: (expanded: boolean) => Promise<void>
  setCloseToTray: (enabled: boolean) => Promise<void>
  setUseSystemProxy: (enabled: boolean) => Promise<void>
  setGithubProxySources: (sources: GithubProxySource[]) => Promise<void>
  updateUpdateCheckSettings: (patch: Partial<UpdateCheckSettings>) => Promise<void>
  updateChatImageProcessing: (patch: {
    enabled?: boolean
    compression?: Partial<ChatImageProcessingSettings['compression']>
    resize?: Partial<ChatImageProcessingSettings['resize']>
  }) => Promise<void>
  updateChatSendMerge: (patch: Partial<ChatSendMergeSettings>) => Promise<void>
  updateContextBudget: (patch: Partial<ContextBudgetSettings>) => Promise<void>
  updateContextCompression: (patch: Partial<ContextCompressionSettings>) => Promise<void>
  setTtsEnabled: (enabled: boolean) => Promise<void>
  updateTtsSettings: (patch: Partial<TtsSettings>) => Promise<void>
  updateTtsProviderSettings: <P extends keyof TtsSettings['providers']>(
    provider: P,
    patch: Partial<TtsSettings['providers'][P]>
  ) => Promise<void>
  retrySave: () => Promise<void>
}

/**
 * @description 保存应用通用设置，并将失败状态保留给设置界面展示与重试。
 * @param settings 待保存的完整设置快照。
 * @param set Zustand 的状态更新函数。
 * @returns 设置保存尝试结束后的 Promise。
 * @remarks 写入失败时会记录错误并更新 Store，不会向调用方重新抛出异常。
 */
async function saveSettings(
  settings: AppSettings,
  set: (partial: Partial<AppSettingsStore>) => void
): Promise<void> {
  set({ saveError: null })
  try {
    await saveAppSettings(settings)
    set({ saveError: null })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    trackError('save-app-settings-failed', 'Failed to save app settings', error)
    set({ saveError: message })
  }
}

/** TTS 配置防抖保存的定时器句柄。 */
let ttsSaveTimer: number | null = null

/**
 * @description 对 TTS 配置变更防抖后保存，避免文本输入逐键触发磁盘写入。
 * @param settings 待保存的完整设置快照。
 * @param set Zustand 的状态更新函数。
 * @remarks 防抖窗口 300ms，与 providers store 的文本输入保存策略一致；最后一次变更后写入。
 */
function scheduleTtsSettingsSave(
  settings: AppSettings,
  set: (partial: Partial<AppSettingsStore>) => void
): void {
  if (ttsSaveTimer != null) {
    window.clearTimeout(ttsSaveTimer)
  }
  ttsSaveTimer = window.setTimeout(() => {
    ttsSaveTimer = null
    void saveSettings(settings, set)
  }, 300)
}

export const useAppSettingsStore = create<AppSettingsStore>((set, get) => ({
  settings: createDefaultAppSettings(),
  isLoaded: false,
  saveError: null,
  /**
   * @description 使用主进程返回的设置快照初始化 Store。
   * @param settings 主进程返回的应用设置快照。
   * @returns 无返回值。
   */
  hydrate: (settings) => set({ settings: normalizeAppSettings(settings), isLoaded: true }),
  /**
   * @description 更新动画偏好并持久化设置。
   * @param animationPreference 用户选择的动画策略。
   * @returns 设置保存流程完成后的 Promise。
   */
  setAnimationPreference: async (animationPreference) => {
    const settings = { ...get().settings, animationPreference }
    set({ settings })
    trackUiEvent('animation-preference-changed', 'User changed animation preference', {
      animationPreference
    })
    await saveSettings(settings, set)
  },
  /**
   * @description 更新追踪（Langfuse）配置并持久化设置。
   * @param patch 要合并的追踪配置字段。
   * @returns 设置保存流程完成后的 Promise。
   */
  updateTraceSettings: async (patch) => {
    const current = get().settings
    const settings = { ...current, trace: { ...current.trace, ...patch } }
    set({ settings })
    trackUiEvent('trace-settings-changed', 'User changed Langfuse settings', {
      enabled: settings.trace.enabled
    })
    await saveSettings(settings, set)
  },
  /**
   * @description 更新消息折叠行数并持久化设置。
   * @param messageCollapseLineCount 消息折叠前允许显示的行数。
   * @returns 设置保存流程完成后的 Promise。
   */
  setMessageCollapseLineCount: async (messageCollapseLineCount) => {
    const settings = { ...get().settings, messageCollapseLineCount }
    set({ settings })
    trackUiEvent(
      'message-collapse-line-count-changed',
      'User changed message collapse line count',
      {
        messageCollapseLineCount
      }
    )
    await saveSettings(settings, set)
  },
  /**
   * @description 更新设置页侧边栏展开状态并持久化设置。
   * @param settingsSidebarExpanded 侧边栏是否展开。
   * @returns 设置保存流程完成后的 Promise。
   */
  setSettingsSidebarExpanded: async (settingsSidebarExpanded) => {
    const settings = { ...get().settings, settingsSidebarExpanded }
    set({ settings })
    await saveSettings(settings, set)
  },
  /**
   * @description 切换「关闭时最小化到托盘」并持久化设置。
   * @param enabled 关闭窗口按钮是否最小化到系统托盘。
   * @returns 设置保存流程完成后的 Promise。
   */
  setCloseToTray: async (closeToTray) => {
    const settings = { ...get().settings, closeToTray }
    set({ settings })
    trackUiEvent('close-to-tray-changed', 'User changed close-to-tray setting', { closeToTray })
    await saveSettings(settings, set)
  },
  /**
   * @description 切换「使用系统代理」并持久化设置；下一次请求起生效。
   * @param enabled 出站请求是否跟随系统代理。
   * @returns 设置保存流程完成后的 Promise。
   */
  setUseSystemProxy: async (useSystemProxy) => {
    const settings = { ...get().settings, useSystemProxy }
    set({ settings })
    trackUiEvent('use-system-proxy-changed', 'User changed system proxy setting', {
      useSystemProxy
    })
    await saveSettings(settings, set)
  },
  /**
   * @description 替换 GitHub 来源链并持久化设置。
   * @param sources 替换后的完整来源列表。
   * @returns 设置保存流程完成后的 Promise。
   */
  setGithubProxySources: async (sources) => {
    const settings = { ...get().settings, githubProxy: { sources } }
    set({ settings })
    trackUiEvent('github-proxy-sources-changed', 'User changed GitHub source chain', {
      count: sources.length
    })
    await saveSettings(settings, set)
  },
  /**
   * @description 更新自动检查更新配置并持久化设置。
   * @param patch 要合并的更新检查配置字段。
   * @returns 设置保存流程完成后的 Promise。
   */
  updateUpdateCheckSettings: async (patch) => {
    const current = get().settings
    const settings = { ...current, update: { ...current.update, ...patch } }
    set({ settings })
    trackUiEvent('update-check-settings-changed', 'User changed update check settings', {
      autoCheck: settings.update.autoCheck
    })
    await saveSettings(settings, set)
  },
  /**
   * @description 更新聊天图片处理策略并持久化设置。
   * @param patch 要合并的图片处理配置字段。
   * @returns 设置保存流程完成后的 Promise。
   */
  updateChatImageProcessing: async (patch) => {
    const current = get().settings
    const settings = {
      ...current,
      chatImageProcessing: {
        ...current.chatImageProcessing,
        ...patch,
        compression: { ...current.chatImageProcessing.compression, ...patch.compression },
        resize: { ...current.chatImageProcessing.resize, ...patch.resize }
      }
    }
    set({ settings })
    trackUiEvent('chat-image-processing-changed', 'User changed chat image processing settings')
    await saveSettings(settings, set)
  },
  /**
   * @description 更新聊天发送合并策略并持久化设置。
   * @param patch 要合并的发送合并配置。
   * @returns 设置保存流程完成后的 Promise。
   */
  updateChatSendMerge: async (patch) => {
    const current = get().settings
    const settings = { ...current, chatSendMerge: { ...current.chatSendMerge, ...patch } }
    set({ settings })
    trackUiEvent('chat-send-merge-changed', 'User changed chat send merge settings', {
      enabled: settings.chatSendMerge.enabled,
      delaySeconds: settings.chatSendMerge.delaySeconds
    })
    await saveSettings(settings, set)
  },
  /**
   * @description 更新上下文预算比例并持久化设置。
   * @param patch 要合并的上下文预算配置字段。
   */
  updateContextBudget: async (patch) => {
    const current = get().settings
    const settings = { ...current, contextBudget: { ...current.contextBudget, ...patch } }
    set({ settings })
    trackUiEvent('context-budget-changed', 'User changed context budget settings', {
      budgetRatio: settings.contextBudget.budgetRatio
    })
    await saveSettings(settings, set)
  },
  /**
   * @description 更新上下文压缩设置并持久化。
   * @param patch 要合并的上下文压缩配置字段。
   */
  updateContextCompression: async (patch) => {
    const current = get().settings
    const settings = { ...current, contextCompression: { ...current.contextCompression, ...patch } }
    set({ settings })
    trackUiEvent('context-compression-changed', 'User changed context compression settings', {
      enabled: settings.contextCompression.enabled
    })
    await saveSettings(settings, set)
  },
  /**
   * @description 切换 TTS 总开关并持久化设置。
   * @param enabled 是否启用 TTS。
   * @returns 设置保存流程完成后的 Promise。
   */
  setTtsEnabled: async (enabled) => {
    const current = get().settings
    const settings = { ...current, tts: { ...current.tts, enabled } }
    set({ settings })
    trackUiEvent('tts-enabled-changed', 'User changed local TTS enabled state', { enabled })
    await saveSettings(settings, set)
  },
  /**
   * @description 更新 TTS 通用配置并持久化设置。
   * @param patch 要合并的 TTS 通用配置字段。
   * @returns 设置保存流程完成后的 Promise。
   */
  updateTtsSettings: async (patch) => {
    const current = get().settings
    const settings = { ...current, tts: { ...current.tts, ...patch } }
    set({ settings })
    trackUiEvent('tts-settings-changed', 'User changed TTS provider settings', {
      provider: settings.tts.provider
    })
    await saveSettings(settings, set)
  },
  /**
   * @description 更新指定 TTS 提供商的配置并防抖持久化设置。
   * @param provider 要更新的 TTS 提供商。
   * @param patch 要合并到该提供商配置中的字段。
   * @returns 设置更新流程完成后的 Promise。
   * @remarks 文本输入（API Key、服务地址）会连续触发本动作，写入经 300ms 防抖合并。
   */
  updateTtsProviderSettings: async (provider, patch) => {
    const current = get().settings
    const settings = {
      ...current,
      tts: {
        ...current.tts,
        providers: {
          ...current.tts.providers,
          [provider]: { ...current.tts.providers[provider], ...patch }
        }
      }
    }
    set({ settings })
    trackUiEvent('tts-provider-settings-changed', 'User changed TTS provider settings', {
      provider
    })
    scheduleTtsSettingsSave(settings, set)
  },
  /**
   * @description 重试保存当前应用设置。
   * @returns 当前应用设置保存流程完成后的 Promise。
   */
  retrySave: async () => saveSettings(get().settings, set)
}))
