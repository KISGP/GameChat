import { useEffect, type ReactElement } from 'react'
import { Section } from '@renderer/common/components/Section'
import { SettingItem } from '@renderer/common/components/SettingItem'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/common/components/select'
import { AgentLabLauncher } from '@renderer/features/agent/ui/AgentLabLauncher'
import { useFlowsStore } from '@renderer/features/flows/store/flows'
import { onFlowsChanged } from '@renderer/services/flows'

/**
 * @description 渲染当前流程选择。
 * @returns 流程选择分区。
 * @remarks 流程的导入、导出、复制、删除与编辑全部在流程画布完成，设置页只负责选择。
 */
export function FlowsTab(): ReactElement {
  const flows = useFlowsStore((store) => store.flows)
  const currentFlowId = useFlowsStore((store) => store.currentFlowId)
  const loaded = useFlowsStore((store) => store.loaded)
  const setCurrentFlow = useFlowsStore((store) => store.setCurrentFlow)
  const loadFlows = useFlowsStore((store) => store.loadFlows)

  // 每次挂载重新拉取；挂载期间订阅存储变更推送，流程画布保存/删除/导入后实时刷新。
  useEffect(() => {
    void loadFlows()
    return onFlowsChanged((flows) => {
      useFlowsStore.setState({ flows, loaded: true })
    })
  }, [loadFlows])

  return (
    <div className="mx-auto h-full space-y-2 overflow-y-auto px-4 pb-4">
      <Section title="回复流程">
        <SettingItem
          title="当前回复流程"
          expandedItems={[
            <p key="current-flow-description" className="text-muted-foreground">
              单聊与群聊共用同一份流程：流程内按参与者人数分支，单聊由引擎自动选择唯一参与者，
              群聊按选人步骤决定发言者；切换后在下一次回复生效。
            </p>
          ]}
        >
          <Select
            value={currentFlowId}
            disabled={!loaded}
            onValueChange={(value) => void setCurrentFlow(value)}
          >
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {flows.map((flow) => (
                <SelectItem key={flow.id} value={flow.id}>
                  {flow.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingItem>
      </Section>
      <Section title="流程画布">
        <AgentLabLauncher />
      </Section>
    </div>
  )
}
