import { memo, useCallback, useState, type ReactElement } from 'react'
import { Section } from '@renderer/common/components/Section'
import { Card } from '@renderer/common/components/card'
import { CharacterAccordionCard } from '@renderer/common/components/character-accordion-card'
import { SettingItem } from '@renderer/common/components/SettingItem'
import { Switch } from '@renderer/common/components/switch'
import { useAppSettingsStore } from '@renderer/store/app-settings'
import { useCharacterRegistryStore } from '@renderer/store/character-registry'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/common/components/select'
import { LocalCharacterEntry } from '@gamechat/type'
import { TtsSettings } from '@gamechat/type'
import FishGlobalSettings from './FishAudio/GlobalSettings'
import FishCharacterSettings from './FishAudio/CharacterVoiceSettings'
import { IndexTtsCharacterVoiceSettings, IndexTtsGlobalSettings } from './local/index-tts'
import { setCharacterFishVoice } from '@renderer/services/characters'

/**
 * @description 清空角色已配置的 Fish 音色，回落到默认音色。
 * @param characterId 目标角色 ID。
 * @returns 音色配置保存完成后的 Promise；失败由调用方捕获展示。
 * @remarks 作为稳定引用传入列表项：模块级函数不随渲染重建，保证列表项 memo 生效。
 */
function clearCharacterFishVoice(characterId: string): Promise<unknown> {
  return setCharacterFishVoice(characterId, '')
}

type CharacterVoiceItemProps = {
  character: LocalCharacterEntry
  expanded: boolean
  ttsProvider: TtsSettings['provider']
  onOpenChange: (characterId: string, open: boolean) => void
}

function CharacterVoiceItemImpl({
  character,
  expanded,
  ttsProvider,
  onOpenChange
}: CharacterVoiceItemProps): ReactElement {
  return (
    <CharacterAccordionCard
      name={character.name}
      avatar={character.avatar}
      cardBg={character.cardBg}
      description={
        ttsProvider === 'fish'
          ? character.settings.tts.fish?.referenceId
            ? '已配置音色'
            : '默认音色'
          : undefined
      }
      open={expanded}
      onOpenChange={(nextOpen) => onOpenChange(character.id, nextOpen)}
    >
      {ttsProvider === 'fish' ? (
        <FishCharacterSettings
          key={`${character.id}:${character.settings.tts.fish?.referenceId || ''}`}
          character={character}
          ttsFishPreset={character.ttsFishPreset}
          characterSettings={character.settings.tts}
          onChange={setCharacterFishVoice}
          onReset={clearCharacterFishVoice}
        />
      ) : (
        <IndexTtsCharacterVoiceSettings characterId={character.id} active={expanded} />
      )}
    </CharacterAccordionCard>
  )
}

// 仅 expanded 与角色数据变化时重渲染：回调 prop 为稳定引用，父级无关状态更新不波及列表
const CharacterVoiceItem = memo(CharacterVoiceItemImpl)

/**
 * @description 渲染语音开关、独立的全局 TTS 服务配置和角色声音配置。
 * @returns TTS 设置页内容。
 */
export function TtsTab(): ReactElement {
  const characters = useCharacterRegistryStore((state) => state.registry.local)
  const ttsSettings = useAppSettingsStore((state) => state.settings.tts)
  const setTtsEnabled = useAppSettingsStore((state) => state.setTtsEnabled)
  const updateTtsSettings = useAppSettingsStore((state) => state.updateTtsSettings)
  const updateTtsProviderSettings = useAppSettingsStore((state) => state.updateTtsProviderSettings)
  const [expandedCharacterId, setExpandedCharacterId] = useState<string | null>(null)

  /**
   * @description 切换角色声音卡片折叠状态，并确保页面同时只展开一个角色。
   * @param characterId 需要切换的角色标识。
   * @param open 折叠组件期望的目标状态。
   */
  const handleToggleVoice = useCallback((characterId: string, open: boolean): void => {
    setExpandedCharacterId(open ? characterId : null)
  }, [])

  return (
    <div className="h-full overflow-y-auto px-4 pb-6">
      <Section title="语音播放">
        <SettingItem
          title="启用语音"
          expandedItems={[
            <p key="description" className="text-muted-foreground">
              已完成的角色消息会显示语音播放按钮。
            </p>
          ]}
        >
          <Switch
            checked={ttsSettings.enabled}
            onCheckedChange={(enabled) => void setTtsEnabled(enabled)}
            aria-label="启用语音"
          />
        </SettingItem>
      </Section>
      <GlobalTtsSettings
        provider={ttsSettings.provider}
        providers={ttsSettings.providers}
        onProviderChange={(provider) => void updateTtsSettings({ provider })}
        onProviderSettingsChange={updateTtsProviderSettings}
      />
      <Section title="角色配置">
        <div className="space-y-2">
          {characters.map((character) => (
            <CharacterVoiceItem
              key={character.id}
              character={character}
              expanded={expandedCharacterId === character.id}
              ttsProvider={ttsSettings.provider}
              onOpenChange={handleToggleVoice}
            />
          ))}
          {!characters.length && (
            <p className="px-2 py-4 text-xs text-white/45">暂无可配置的本地角色。</p>
          )}
        </div>
      </Section>
    </div>
  )
}

function GlobalTtsSettings({
  provider,
  providers,
  onProviderChange,
  onProviderSettingsChange
}: {
  provider: 'local' | 'fish'
  providers: TtsSettings['providers']
  onProviderChange: (provider: 'local' | 'fish') => void
  onProviderSettingsChange: <P extends keyof TtsSettings['providers']>(
    provider: P,
    patch: Partial<TtsSettings['providers'][P]>
  ) => Promise<void>
}): ReactElement {
  return (
    <Section title="TTS 配置">
      <Card className="space-y-4 p-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-white/55">Provider</span>
          <Select
            value={provider}
            onValueChange={(value) => onProviderChange(value === 'fish' ? 'fish' : 'local')}
          >
            <SelectTrigger className="h-10 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="local">本地推理</SelectItem>
              <SelectItem value="fish">Fish Audio</SelectItem>
            </SelectContent>
          </Select>
        </label>
        {provider === 'fish' ? (
          <FishGlobalSettings
            settings={providers.fish}
            onChange={(patch) => onProviderSettingsChange('fish', patch)}
          />
        ) : (
          <IndexTtsGlobalSettings
            settings={{
              engine: providers.local.engine,
              baseUrl: providers.local.engineConfigs.indexTts.baseUrl
            }}
            onEngineChange={(engine) => onProviderSettingsChange('local', { engine })}
            onChange={(patch) =>
              onProviderSettingsChange('local', {
                engineConfigs: {
                  ...providers.local.engineConfigs,
                  indexTts: { ...providers.local.engineConfigs.indexTts, ...patch }
                }
              })
            }
          />
        )}
      </Card>
    </Section>
  )
}
