import { ChatCompressSessionRequest, ChatDeleteSessionRequest, ChatDeleteGroupRequest, ChatExportSessionRequest, ChatRenameSessionRequest, ChatSetGroupPinnedRequest, ChatRunEvent, ChatAppendMessageRequest, ChatCreateGroupRequest, ChatRetryMessageRequest, ChatRemoveFailedTurnRequest, ChatTriggerRunRequest } from '@gamechat/type'

/**
 * @description 读取角色的当前 Prompt 文档。
 * @param characterId 要读取 Prompt 的角色标识。
 * @returns 主进程返回的 Prompt 内容 Promise。
 */
export function getCharacterPrompt(
  characterId: string
): ReturnType<typeof window.ai.getCharacterPrompt> {
  return window.ai.getCharacterPrompt(characterId)
}

/**
 * @description 保存角色的 Prompt 文档。
 * @param characterId 要更新 Prompt 的角色标识。
 * @param prompt 要保存的完整 Prompt 内容。
 * @returns 主进程确认保存后的 Promise。
 */
export function saveCharacterPrompt(
  characterId: string,
  prompt: string
): ReturnType<typeof window.ai.saveCharacterPrompt> {
  return window.ai.saveCharacterPrompt(characterId, prompt)
}

/**
 * @description 读取当前会话列表摘要。
 * @returns 按主进程当前状态返回的会话摘要列表 Promise。
 */
export function getSessions(): ReturnType<typeof window.ai.getSessions> {
  return window.ai.getSessions()
}

/**
 * @description 换入并读取指定会话的全量快照。
 * @param sessionId 会话标识。
 * @returns 会话全量快照 Promise；会话不存在或文档无效时结果为 null。
 */
export function getSessionDetail(sessionId: string): ReturnType<typeof window.ai.getSessionDetail> {
  return window.ai.getSessionDetail(sessionId)
}

/**
 * @description 创建成员固定的独立群聊。
 * @param request 群聊成员列表。
 * @returns 新建群聊。
 */
export function createGroup(
  request: ChatCreateGroupRequest
): ReturnType<typeof window.ai.createGroup> {
  return window.ai.createGroup(request)
}

/**
 * @description 读取独立群聊对象列表。
 * @returns 主进程返回的群聊列表 Promise。
 */
export function getGroups(): ReturnType<typeof window.ai.getGroups> {
  return window.ai.getGroups()
}

/**
 * @description 发送一条聊天消息并启动运行。
 * @param request 包含会话、角色和消息内容的运行请求。
 * @returns 主进程创建聊天运行后的 Promise。
 */
export function appendMessage(
  request: ChatAppendMessageRequest
): ReturnType<typeof window.ai.appendMessage> {
  return window.ai.appendMessage(request)
}

/**
 * @description 触发一次等待窗口对应的聊天运行。
 * @param request 触发请求。
 * @returns 主进程接受的运行信息。
 */
export function triggerRun(
  request: ChatTriggerRunRequest
): ReturnType<typeof window.ai.triggerRun> {
  return window.ai.triggerRun(request)
}

/**
 * @description 重试会话末尾的失败回复：主进程删除失败气泡并以原用户消息重启运行。
 * @param request 重试请求，包含会话 ID、失败 assistant 消息 ID 与模型条目标识。
 * @returns 主进程接受的运行信息。
 */
export function retryMessage(
  request: ChatRetryMessageRequest
): ReturnType<typeof window.ai.retryMessage> {
  return window.ai.retryMessage(request)
}

/**
 * @description 移除一轮失败的对话消息（失败 assistant 消息与其输入用户消息），供「重新编辑」重新发送前清场。
 * @param request 清理请求，包含会话 ID 与失败的 assistant 消息 ID。
 * @returns 清理后的会话快照与摘要。
 */
export function removeFailedTurn(
  request: ChatRemoveFailedTurnRequest
): ReturnType<typeof window.ai.removeFailedTurn> {
  return window.ai.removeFailedTurn(request)
}

/**
 * @description 删除指定会话的内存快照与磁盘数据。
 * @param request 删除请求，包含会话 ID。
 * @returns 被删除的会话 ID。
 */
export function deleteSession(
  request: ChatDeleteSessionRequest
): ReturnType<typeof window.ai.deleteSession> {
  return window.ai.deleteSession(request)
}

/**
 * @description 删除指定群聊及其全部会话数据。
 * @param request 删除请求，包含群聊 ID。
 * @returns 被删除的群聊 ID。
 */
export function deleteGroup(
  request: ChatDeleteGroupRequest
): ReturnType<typeof window.ai.deleteGroup> {
  return window.ai.deleteGroup(request)
}

/**
 * @description 设置会话的自定义标题。
 * @param request 改名请求，包含会话 ID 与新标题。
 * @returns 更新后的会话快照。
 */
export function renameSession(
  request: ChatRenameSessionRequest
): ReturnType<typeof window.ai.renameSession> {
  return window.ai.renameSession(request)
}

/**
 * @description 手动触发一次会话历史压缩。
 * @param request 压缩请求，包含会话 ID。
 * @returns 主进程返回的压缩结果。
 */
export function compressSession(
  request: ChatCompressSessionRequest
): ReturnType<typeof window.ai.compressSession> {
  return window.ai.compressSession(request)
}

/**
 * @description 将整个会话导出为 Markdown 文件。
 * @param request 导出请求，包含会话 ID。
 * @returns 主进程返回的导出结果；用户取消保存对话框时为 canceled。
 */
export function exportSession(
  request: ChatExportSessionRequest
): ReturnType<typeof window.ai.exportSession> {
  return window.ai.exportSession(request)
}

/**
 * @description 设置群聊的侧栏置顶标记。
 * @param request 置顶请求，包含群聊 ID 与目标标记。
 * @returns 更新后的群聊快照。
 */
export function setGroupPinned(
  request: ChatSetGroupPinnedRequest
): ReturnType<typeof window.ai.setGroupPinned> {
  return window.ai.setGroupPinned(request)
}

/**
 * @description 中止指定的聊天运行。
 * @param requestId 要中止的聊天运行标识。
 * @returns 主进程处理取消请求后的 Promise。
 */
export function abortRun(requestId: string): ReturnType<typeof window.ai.abortRun> {
  return window.ai.abortRun(requestId)
}

/**
 * @description 订阅聊天运行事件。
 * @param listener 接收主进程聊天运行事件的回调。
 * @returns 用于取消订阅的清理函数。
 * @remarks 调用方应在组件或页面卸载时执行返回的清理函数。
 */
export function onRunEvent(
  listener: (event: ChatRunEvent) => void
): ReturnType<typeof window.ai.onRunEvent> {
  return window.ai.onRunEvent(listener)
}

/**
 * @description 读取角色参与的全部会话中该角色的状态卡视图。
 * @param characterId 角色标识。
 * @returns 按会话排列的状态卡视图 Promise。
 */
export function getCharacterSessionStateCards(
  characterId: string
): ReturnType<typeof window.ai.getCharacterSessionStateCards> {
  return window.ai.getCharacterSessionStateCards(characterId)
}
