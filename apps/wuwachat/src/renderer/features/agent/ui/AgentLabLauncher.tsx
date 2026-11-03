import type { ReactElement } from 'react'
import { toast } from 'sonner'
import { SettingItem } from '@renderer/common/components/SettingItem'
import { Button } from '@renderer/common/components/button'
import { getIpcErrorMessage } from '@renderer/common/lib/error-message'
import { openAgentLab } from '@renderer/services/agent-lab'

/**
 * @description 流程画布入口：在独立窗口打开编排画布。
 * @returns 编排启动器设置项。
 * @remarks 编排画布本体运行在独立窗口与独立 preload 中，与主应用渲染层互不依赖。
 */
export function AgentLabLauncher(): ReactElement {
  return (
    <SettingItem
      title="打开编排画布"
      expandedItems={[
        <p key="agent-lab-description" className="text-muted-foreground">
          在独立窗口的无限画布上编辑流程包：摆放步骤节点、连线并设置条件，保存后在聊天中即时生效。
        </p>
      ]}
    >
      <Button
        variant="brand"
        size="sm"
        onClick={() =>
          void openAgentLab().catch((cause) => toast.error(getIpcErrorMessage(cause)))
        }
      >
        打开
      </Button>
    </SettingItem>
  )
}
