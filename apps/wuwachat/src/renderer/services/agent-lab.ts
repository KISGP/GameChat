import type { FlowEditorOpenRequest } from '@gamechat/type'

/**
 * @description 编排窗口入口：请求主进程打开或聚焦独立编排窗口。
 * @param request 可选的流程标识；省略时打开当前流程。
 * @returns 请求完成后的 Promise。
 */
export function openAgentLab(
  request?: FlowEditorOpenRequest
): ReturnType<typeof window.api.openAgentLab> {
  return window.api.openAgentLab(request)
}
