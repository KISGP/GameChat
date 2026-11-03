import { CharacterSummary } from '@gamechat/type'
import { useMemo, useState, type ReactElement } from 'react'
import { RotateCcw } from 'lucide-react'
import { Input } from '@renderer/common/components/input'
import { Button } from '@renderer/common/components/button'
import { resolveFishCharacterReferenceId } from '@gamechat/schema'
import { CharacterTtsSettings } from '@gamechat/type'
import { trackError } from '@renderer/app/telemetry'

export default function FishCharacterSettings({
  character,
  ttsFishPreset,
  characterSettings,
  onChange,
  onReset
}: {
  character: CharacterSummary
  /** 角色信息携带的 Fish Audio 仓库预设音色 ID。 */
  ttsFishPreset?: string
  characterSettings: CharacterTtsSettings
  onChange: (characterId: string, referenceId: string) => Promise<unknown>
  onReset: (characterId: string) => Promise<unknown>
}): ReactElement {
  const configuredReferenceId = characterSettings.fish?.referenceId || ''
  const defaultReferenceId = useMemo(
    () => resolveFishCharacterReferenceId({}, ttsFishPreset),
    [ttsFishPreset]
  )
  const effectiveReferenceId = useMemo(
    () => resolveFishCharacterReferenceId(characterSettings, ttsFishPreset),
    [characterSettings, ttsFishPreset]
  )
  const [draft, setDraft] = useState(configuredReferenceId || effectiveReferenceId)
  const hasOverride = Boolean(configuredReferenceId)
  const canReset = hasOverride || draft !== defaultReferenceId
  return (
    <label>
      <span className="relative">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={() => {
            void onChange(character.id, draft).catch((error) => {
              trackError(
                'save-fish-voice-failed',
                'Failed to save character Fish Audio voice',
                error
              )
            })
          }}
          placeholder="输入 Fish Audio reference_id"
          aria-describedby="fish-character-voice-help"
          className="w-xs pr-10"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setDraft(defaultReferenceId)
            void onReset(character.id).catch((error) => {
              trackError(
                'reset-fish-voice-failed',
                'Failed to reset character Fish Audio voice',
                error
              )
            })
          }}
          disabled={!canReset}
          aria-label="恢复默认音色"
          className="absolute inset-y-0 right-2 my-auto text-white/45 hover:text-white/80"
        >
          <RotateCcw className="size-3.5" />
        </Button>
      </span>
    </label>
  )
}
