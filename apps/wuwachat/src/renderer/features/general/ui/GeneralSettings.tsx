import type { ReactElement } from 'react'
import { type ChatImagePreset, type AnimationPreference } from '@gamechat/type'
import { MAX_MESSAGE_COLLAPSE_LINE_COUNT, MIN_MESSAGE_COLLAPSE_LINE_COUNT, CHAT_IMAGE_QUALITY_MIN, CHAT_IMAGE_QUALITY_MAX, CHAT_IMAGE_PRESETS } from '@gamechat/schema'
import { Switch } from '@renderer/common/components/switch'
import { Section } from '@renderer/common/components/Section'
import { SettingItem } from '@renderer/common/components/SettingItem'
import { Button } from '@renderer/common/components/button'
import { useAppSettingsStore } from '@renderer/store/app-settings'
import { UpdateSettings } from './UpdateSettings'
import { GithubSourcesSettings } from './GithubSourcesSettings'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/common/components/select'

const ANIMATION_OPTIONS: { value: AnimationPreference; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'enabled', label: '开启' },
  { value: 'disabled', label: '关闭' }
]

/**
 * @description 渲染应用通用设置，包括界面动画、消息显示和 GitHub 来源顺序。
 * @param props 组件 props。
 * @returns 通用设置页内容。
 */
export function GeneralTab({
  onOpenQuickStart
}: {
  /** 请求在设置层之上打开首启引导向导的回调。 */
  onOpenQuickStart: () => void
}): ReactElement {
  const animationPreference = useAppSettingsStore((state) => state.settings.animationPreference)
  const setAnimationPreference = useAppSettingsStore((state) => state.setAnimationPreference)
  const messageCollapseLineCount = useAppSettingsStore(
    (state) => state.settings.messageCollapseLineCount
  )
  const setMessageCollapseLineCount = useAppSettingsStore(
    (state) => state.setMessageCollapseLineCount
  )
  const closeToTray = useAppSettingsStore((state) => state.settings.closeToTray)
  const setCloseToTray = useAppSettingsStore((state) => state.setCloseToTray)
  const useSystemProxy = useAppSettingsStore((state) => state.settings.useSystemProxy)
  const setUseSystemProxy = useAppSettingsStore((state) => state.setUseSystemProxy)
  const chatImageProcessing = useAppSettingsStore((state) => state.settings.chatImageProcessing)
  const updateChatImageProcessing = useAppSettingsStore((state) => state.updateChatImageProcessing)
  const chatSendMerge = useAppSettingsStore((state) => state.settings.chatSendMerge)
  const updateChatSendMerge = useAppSettingsStore((state) => state.updateChatSendMerge)
  const ttsEnabled = useAppSettingsStore((state) => state.settings.tts.enabled)
  const ttsAutoSpeak = useAppSettingsStore((state) => state.settings.tts.autoSpeak)
  const updateTtsSettings = useAppSettingsStore((state) => state.updateTtsSettings)

  return (
    <div className="h-full overflow-y-auto px-4">
      <Section title="界面">
        <SettingItem
          title="界面动画"
          expandedItems={[
            <p key="description" className="text-muted-foreground">
              关闭后，界面会直接切换到目标状态。系统的减少动态效果偏好始终优先。
            </p>
          ]}
        >
          <div
            role="radiogroup"
            aria-label="界面动画"
            className="flex overflow-hidden rounded border border-white/15"
          >
            {ANIMATION_OPTIONS.map((option) => {
              const isSelected = option.value === animationPreference
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => void setAnimationPreference(option.value)}
                  className={`min-w-20 border-r border-white/15 px-3 py-2 text-sm transition-colors last:border-r-0 ${isSelected ? 'bg-[#e8c690] text-[#1b1b1b]' : 'bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'}`}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        </SettingItem>
        <SettingItem
          title="自动折叠行数"
          expandedItems={[
            <p key="description" className="text-muted-foreground">
              消息超过设定行数时会折叠，并可按需展开。
            </p>
          ]}
        >
          <input
            type="number"
            min={MIN_MESSAGE_COLLAPSE_LINE_COUNT}
            max={MAX_MESSAGE_COLLAPSE_LINE_COUNT}
            value={messageCollapseLineCount}
            onChange={(event) => {
              const value = event.currentTarget.valueAsNumber
              if (!Number.isNaN(value))
                void setMessageCollapseLineCount(
                  Math.min(
                    MAX_MESSAGE_COLLAPSE_LINE_COUNT,
                    Math.max(MIN_MESSAGE_COLLAPSE_LINE_COUNT, value)
                  )
                )
            }}
            className="w-20 border border-white/15 bg-black/35 px-3 py-2 text-center text-sm text-white transition-colors outline-none focus:border-[#e8c690]"
            aria-label="自动折叠行数"
          />
        </SettingItem>
        <SettingItem
          title="关闭时最小化到托盘"
          expandedItems={[
            <p key="description" className="text-muted-foreground">
              开启后点击窗口关闭按钮会隐藏到系统托盘，应用在后台驻留；从托盘图标可重新打开或退出。
            </p>
          ]}
        >
          <Switch
            checked={closeToTray}
            onCheckedChange={(enabled) => void setCloseToTray(enabled)}
            aria-label="关闭时最小化到托盘"
          />
        </SettingItem>
        <SettingItem
          title="打开引导页"
          expandedItems={[
            <p key="description" className="text-muted-foreground">
              重新打开首次启动的角色选择与模型配置引导，不会影响已有配置。
            </p>
          ]}
        >
          <Button variant="quiet" onClick={onOpenQuickStart}>
            打开
          </Button>
        </SettingItem>
      </Section>
      <Section title="聊天">
        <SettingItem
          title="合并连续发送"
          expandedItems={[
            <p key="description" className="text-muted-foreground">
              在短时间内连续发送的消息会显示为独立气泡，并合并为一次模型请求。
            </p>,
            <label key="delay" className="flex items-center justify-between">
              <span className="text-md text-white/55">等待秒数</span>
              <input
                type="number"
                defaultValue={chatSendMerge.delaySeconds}
                disabled={!chatSendMerge.enabled}
                onBlur={(event) => {
                  const value = Number(event.currentTarget.value)
                  if (Number.isFinite(value)) {
                    const delaySeconds = value
                    event.currentTarget.value = String(delaySeconds)
                    void updateChatSendMerge({ delaySeconds })
                  } else {
                    event.currentTarget.value = String(chatSendMerge.delaySeconds)
                  }
                }}
                className="w-20 border border-white/15 bg-black/35 px-3 py-2 text-center text-sm text-white outline-none focus:border-[#e8c690] disabled:opacity-50"
              />
            </label>
          ]}
        >
          <Switch
            checked={chatSendMerge.enabled}
            onCheckedChange={(enabled) => void updateChatSendMerge({ enabled })}
            aria-label="合并连续发送"
          />
        </SettingItem>
        <SettingItem
          title="请求时处理图片"
          expandedItems={[
            <p key="description" className="text-muted-foreground">
              关闭时按原图发送；质量 100 表示不压缩，“保持原尺寸”表示不缩放，长边 1024 是 token
              与画质的平衡档。
            </p>,
            <label key="quality" className="flex items-center justify-between">
              <span className="text-md text-white/55">压缩质量</span>
              <input
                type="number"
                min={CHAT_IMAGE_QUALITY_MIN}
                max={CHAT_IMAGE_QUALITY_MAX}
                defaultValue={chatImageProcessing.compression.quality}
                disabled={!chatImageProcessing.enabled}
                onBlur={(event) => {
                  const value = Number(event.currentTarget.value)
                  if (Number.isFinite(value)) {
                    const quality = Math.min(
                      CHAT_IMAGE_QUALITY_MAX,
                      Math.max(CHAT_IMAGE_QUALITY_MIN, Math.round(value))
                    )
                    event.currentTarget.value = String(quality)
                    void updateChatImageProcessing({
                      compression: { ...chatImageProcessing.compression, quality }
                    })
                  } else {
                    event.currentTarget.value = String(chatImageProcessing.compression.quality)
                  }
                }}
                className="w-20 border border-white/15 bg-black/35 px-3 py-2 text-center text-sm text-white outline-none focus:border-[#e8c690] disabled:opacity-50"
              />
            </label>,
            <label key="preset" className="flex items-center justify-between">
              <span className="text-md text-white/55">预设尺寸</span>
              <Select
                value={String(chatImageProcessing.resize.preset)}
                disabled={!chatImageProcessing.enabled}
                onValueChange={(value) => {
                  const preset: ChatImagePreset =
                    value === 'original' ? 'original' : (Number(value) as ChatImagePreset)
                  void updateChatImageProcessing({
                    resize: { ...chatImageProcessing.resize, preset }
                  })
                }}
              >
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHAT_IMAGE_PRESETS.map((preset) => (
                    <SelectItem key={String(preset)} value={String(preset)}>
                      {preset === 'original' ? '保持原尺寸' : `长边 ${preset}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          ]}
        >
          <Switch
            checked={chatImageProcessing.enabled}
            onCheckedChange={(enabled) => void updateChatImageProcessing({ enabled })}
            aria-label="请求时处理图片"
          />
        </SettingItem>
        <SettingItem
          title="自动语音输出"
          expandedItems={[
            <p key="description" className="text-muted-foreground">
              开启后，新产生的角色回复自动转为语音气泡，不显示文字，可在气泡上转文字。发送前会检查角色语音就绪状态，未就绪时不能发送。需先在语音设置中启用语音。单次合成上限
              500 字符，超长回复将合成失败并显示错误。
            </p>
          ]}
        >
          <Switch
            checked={ttsAutoSpeak}
            disabled={!ttsEnabled}
            onCheckedChange={(autoSpeak) => void updateTtsSettings({ autoSpeak })}
            aria-label="自动语音输出"
          />
        </SettingItem>
      </Section>
      <Section title="高级">
        <SettingItem
          title="使用系统代理"
          expandedItems={[
            <p key="description" className="text-muted-foreground">
              开启后应用的全部联网请求（模型、资料与角色同步、语音、连通性测试等）跟随系统代理设置；
              关闭后一律直连。默认直连，变更对下一次请求立即生效。
            </p>
          ]}
        >
          <Switch
            checked={useSystemProxy}
            onCheckedChange={(enabled) => void setUseSystemProxy(enabled)}
            aria-label="使用系统代理"
          />
        </SettingItem>
        <GithubSourcesSettings />
      </Section>
      <UpdateSettings />
    </div>
  )
}
