import { useEffect, useState } from 'react'
import type { ChatRunEvent } from '@gamechat/type'
import { useMemoryStore } from '@renderer/features/memory/store/memory'
import { useVoiceOutputStore } from '@renderer/features/chat/store/voice'
import { useCharacterRegistryStore } from '@renderer/store/character-registry'
import { useSessionStore } from '@renderer/store/session'
import { useStreamingStore } from '@renderer/store/streaming'
import { useProvidersStore } from '@renderer/store/providers'
import { useAppSettingsStore } from '@renderer/store/app-settings'
import { useAppearanceStore } from '@renderer/features/appearance'
import { getUnifiedSettings } from '@renderer/services/settings'
import { getGroups, getSessions, onRunEvent } from '@renderer/services/ai'
import { onRegistryChanged } from '@renderer/services/characters'
import { trackError } from '@renderer/app/telemetry'

/**
 * @description 在渲染进程启动时读取统一设置、恢复各个设置分区，并订阅运行事件与内存任务事件以保持状态同步。
 * @returns 设置启动状态；主界面应仅在状态为 `ready` 时显示，避免外观设置回退闪烁。
 */
export function useRendererStoreBootstrap(): 'loading' | 'ready' | 'error' {
  const [settingsBootstrapState, setSettingsBootstrapState] = useState<
    'loading' | 'ready' | 'error'
  >('loading')

  useEffect(() => {
    let isDisposed = false

    void getUnifiedSettings()
      .then((settings) => {
        if (isDisposed) {
          return
        }

        useAppSettingsStore.getState().hydrate(settings.app)
        useProvidersStore.getState().hydrateProviders(settings.providers)
        useMemoryStore.getState().hydrateSettings(settings.memory)
        useAppearanceStore.getState().hydrate(settings.appearance)
        setSettingsBootstrapState('ready')
      })
      .catch((error) => {
        trackError('bootstrap-settings-failed', 'Failed to bootstrap unified settings', error)
        if (!isDisposed) {
          setSettingsBootstrapState('error')
        }
      })

    const unsubscribeRegistryEvent = onRegistryChanged((registry) => {
      useCharacterRegistryStore.getState().setRegistry(registry)
    })

    void useCharacterRegistryStore
      .getState()
      .refreshRegistry()
      .catch((error) => {
        trackError('load-characters-failed', 'Failed to load character resources', error)
      })

    void getSessions()
      .then((snapshot) => {
        useSessionStore.getState().setSummaries(snapshot)
      })
      .catch((error) => {
        trackError('load-sessions-failed', 'Failed to load session summaries', error)
      })

    void getGroups()
      .then((groups) => {
        useSessionStore.getState().setGroups(groups)
      })
      .catch((error) => {
        trackError('load-groups-failed', 'Failed to load chat groups', error)
      })

    const unsubscribeRunEvent = onRunEvent((event: ChatRunEvent) => {
      if (event.type === 'session-removed') {
        useSessionStore.getState().removeSession(event.sessionId)
        return
      }
      useSessionStore.getState().mergeRunEventSession(event)
      useVoiceOutputStore.getState().handleRunEvent(event)

      const streaming = useStreamingStore.getState()
      if (event.type === 'character-stream') {
        streaming.appendChunk(event)
        return
      }
      if (
        event.type === 'run-finished' ||
        event.type === 'run-error' ||
        event.type === 'run-aborted'
      ) {
        streaming.clearForRequest(event.requestId)
        return
      }
      if (event.type === 'session-synced' || event.type === 'run-started') {
        streaming.pruneForSession(event.session)
      }
    })

    return () => {
      isDisposed = true
      unsubscribeRunEvent()
      unsubscribeRegistryEvent()
    }
  }, [])

  return settingsBootstrapState
}
