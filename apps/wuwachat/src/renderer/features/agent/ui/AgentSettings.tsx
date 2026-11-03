import { useEffect, useState, type ReactElement } from 'react'
import { toast } from 'sonner'
import { type AgentSettingsStore } from '@gamechat/type'
import { createDefaultAgentSettingsStore } from '@gamechat/schema'
import type { AgentPolicyToolPackageId } from '@gamechat/type'
import { SettingItem } from '@renderer/common/components/SettingItem'
import { Switch } from '@renderer/common/components/switch'
import { getIpcErrorMessage } from '@renderer/common/lib/error-message'
import { getUnifiedSettings, saveAgentSettings } from '@renderer/services/settings'

/**
 * @description 渲染聊天 Agent 的工具策略设置。
 * @returns Agent 设置页面。
 */
export function AgentTab(): ReactElement {
  const [settings, setSettings] = useState<AgentSettingsStore>(createDefaultAgentSettingsStore)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (loaded) {
      return
    }
    void getUnifiedSettings()
      .then((unified) => {
        setSettings(unified.agent)
        setLoaded(true)
      })
      .catch((cause) => {
        toast.error(getIpcErrorMessage(cause))
        setLoaded(true)
      })
  }, [loaded])

  /**
   * @description 切换一个工具包是否会暴露给聊天模型。
   * @param toolPackageId 需要更新的工具包标识。
   * @param enabled 是否启用该工具包。
   */
  async function updateToolPackage(
    toolPackageId: AgentPolicyToolPackageId,
    enabled: boolean
  ): Promise<void> {
    const enabledToolPackageIds = enabled
      ? [...new Set([...settings.enabledToolPackageIds, toolPackageId])]
      : settings.enabledToolPackageIds.filter((id) => id !== toolPackageId)
    await saveSettings({ ...settings, enabledToolPackageIds })
  }

  /**
   * @description 保存完整的 Agent 设置快照并在失败时保留错误信息。
   * @param next 待保存的 Agent 设置。
   */
  async function saveSettings(next: AgentSettingsStore): Promise<void> {
    setSettings(next)
    try {
      setSettings(await saveAgentSettings(next))
    } catch (cause) {
      toast.error(`保存失败：${getIpcErrorMessage(cause)}`)
    }
  }

  return (
    <div className="mx-auto h-full space-y-2 overflow-y-auto px-4 pb-4">
      <SettingItem
        title="世界观"
        expandedItems={[
          <p key="description" className="text-muted-foreground">
            允许模型检索本地背景剧情与名词解释。
          </p>
        ]}
      >
        <Switch
          id="agent-world"
          checked={settings.enabledToolPackageIds.includes('world')}
          disabled={!loaded}
          onCheckedChange={(checked) => void updateToolPackage('world', checked)}
        />
      </SettingItem>
      <SettingItem
        title="时间"
        expandedItems={[
          <p key="description" className="text-muted-foreground">
            允许模型查询当前日期和时间。
          </p>
        ]}
      >
        <Switch
          id="agent-datetime"
          checked={settings.enabledToolPackageIds.includes('datetime')}
          disabled={!loaded}
          onCheckedChange={(checked) => void updateToolPackage('datetime', checked)}
        />
      </SettingItem>
      <SettingItem
        title="萌娘百科"
        expandedItems={[
          <p key="moegirlpedia-description" className="text-white/55 select-text">
            允许模型查询<a href="https://zh.moegirl.org.cn/" className='hover:underline'>萌娘百科</a>上的资料。
          </p>
        ]}
      >
        <Switch
          id="agent-moegirlpedia"
          checked={settings.enabledToolPackageIds.includes('moegirlpedia')}
          disabled={!loaded}
          onCheckedChange={(checked) => void updateToolPackage('moegirlpedia', checked)}
        />
      </SettingItem>
    </div>
  )
}
