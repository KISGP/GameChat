/**
 * @description 注册流程包 IPC：列出、保存、读取、删除与导出通用流程。
 * @remarks 导入由渲染层读文件文本后传 JSON 字符串，主进程归一化校验后落盘；
 *   导出在主进程弹保存对话框后写文件，与聊天会话导出同构。
 */
import { dialog } from 'electron'
import { writeFile } from 'fs/promises'
import type { FlowExportResult } from '@gamechat/type'
import { deleteFlow, listFlows, loadFlow, saveFlow } from '../flows/index'
import { handleLogged } from './logged-handler'

/**
 * @description 注册流程包域 IPC handler。
 */
export function registerFlowsIpc(): void {
  handleLogged('flows:listFlows', (_event) => listFlows())
  handleLogged(
    'flows:saveFlow',
    (_event, raw: string) => saveFlow(JSON.parse(raw)),
    (raw: string) => ({ byteLength: raw.length })
  )
  handleLogged('flows:loadFlow', (_event, id: string) => loadFlow(id))
  handleLogged('flows:deleteFlow', (_event, id: string) => deleteFlow(id))
  handleLogged(
    'flows:exportFlow',
    async (_event, id: string): Promise<FlowExportResult> => {
      const pkg = await loadFlow(id)
      const result = await dialog.showSaveDialog({
        defaultPath: `${pkg.id}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePath) {
        return { canceled: true, path: null }
      }
      await writeFile(result.filePath, JSON.stringify(pkg, null, 2), 'utf8')
      return { canceled: false, path: result.filePath }
    },
    (id: string) => ({ id })
  )
}
