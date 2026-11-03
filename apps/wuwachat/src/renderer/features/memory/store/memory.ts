import { type MemorySettingsStore } from '@gamechat/type'
import { createDefaultMemorySettingsStore } from '@gamechat/schema'
import { trackUiEvent } from '@renderer/app/telemetry'
import { create } from 'zustand'
import { saveSettings as persistMemorySettingsApi } from '@renderer/services/memory'

type MemoryStore = {
  settings: MemorySettingsStore
  hydrateSettings: (settings: MemorySettingsStore) => void
  saveSettings: (settings: MemorySettingsStore) => Promise<void>
}

/**
 * @description 保存长期记忆设置，并同步渲染进程状态。
 * @param settings 待保存的设置。
 * @param set Zustand 状态更新函数。
 * @returns 主进程持久化并同步 Store 完成后的 Promise。
 */
async function persistMemorySettings(
  settings: MemorySettingsStore,
  set: (partial: Partial<MemoryStore>) => void
): Promise<void> {
  trackUiEvent('memory-settings-save', 'Saved long-term memory settings', {
    enabled: settings.enabled
  })
  await persistMemorySettingsApi(settings)
  set({ settings })
}

export const useMemoryStore = create<MemoryStore>((set) => ({
  settings: createDefaultMemorySettingsStore(),
  /**
   * @description 使用主进程返回的长期记忆设置初始化 Store。
   * @param settings 要写入的完整长期记忆设置。
   * @returns 无返回值。
   */
  hydrateSettings: (settings) => set({ settings }),
  /**
   * @description 持久化长期记忆设置并在成功后同步 Store。
   * @param settings 要保存的完整长期记忆设置。
   * @returns 持久化完成后的 Promise。
   */
  saveSettings: (settings) => persistMemorySettings(settings, set)
}))
