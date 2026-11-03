import type { ChatCompressSessionRequest, ChatDeleteGroupRequest, ChatDeleteSessionRequest, ChatAppendMessageRequest, ChatCreateGroupRequest, ChatExportSessionRequest, ChatRenameSessionRequest, ChatRemoveFailedTurnRequest, ChatRetryMessageRequest, ChatSetGroupPinnedRequest, ChatTriggerRunRequest, CharacterSessionStateCardView } from '@gamechat/type'
import {
  abortRun,
  compressSession,
  deleteSession,
  deleteGroup,
  exportSession,
  getCharacterPrompt,
  getCharacterEmoticons,
  getUserEmoticons,
  getGroups,
  getCharacterSessionStateCards,
  getSessionDetail,
  getSessionSummaries,
  saveCharacterPrompt,
  appendMessage,
  createGroup,
  renameSession,
  removeFailedTurn,
  retryMessage,
  setGroupPinned,
  triggerRun,
  whenChatReady
} from '../chat/index'
import { handleLogged } from './logged-handler'

/**
 * @description 注册聊天相关 IPC：角色 prompt 读写、表情目录、会话与群聊查询及创建、
 *   消息追加/运行触发/失败重试/中断/会话与群聊删除/会话改名/群聊置顶/会话压缩/会话导出以及图片资源读取。
 */
export function registerChatIpc(): void {
  handleLogged(
    'chat:getCharacterPrompt',
    (_event, characterId: string) => getCharacterPrompt(characterId),
    (characterId) => ({ characterId })
  )
  handleLogged(
    'chat:saveCharacterPrompt',
    (_event, characterId: string, promptText: string) =>
      saveCharacterPrompt(characterId, promptText),
    (characterId, promptText) => ({
      characterId,
      promptLength: promptText.length
    })
  )
  handleLogged('chat:getSessions', async () => {
    await whenChatReady()
    return getSessionSummaries()
  })
  handleLogged(
    'chat:getSessionDetail',
    async (_event, sessionId: string) => {
      await whenChatReady()
      return getSessionDetail(sessionId)
    },
    (sessionId) => ({ sessionId })
  )
  handleLogged('chat:getGroups', async () => {
    await whenChatReady()
    return getGroups()
  })
  handleLogged(
    'chat:createGroup',
    async (_event, request: ChatCreateGroupRequest) => {
      await whenChatReady()
      return createGroup(request)
    },
    (request) => ({ participantIds: request.participantIds })
  )
  handleLogged(
    'chat:getUserEmoticons',
    () => getUserEmoticons(),
    () => ({ source: 'user' })
  )
  handleLogged(
    'chat:getCharacterEmoticons',
    (_event, characterId: string) => getCharacterEmoticons(characterId),
    (characterId) => ({ characterId })
  )
  handleLogged(
    'chat:appendMessage',
    async (_event, request: ChatAppendMessageRequest) => {
      await whenChatReady()
      return appendMessage(request)
    },
    (request) => ({
      requestId: request.requestId,
      holdId: request.holdId,
      sessionId: request.sessionId,
      target: request.target,
      modelId: request.modelId,
      messageLength: request.segment.type === 'text' ? request.segment.text.length : 0,
      emoticonId: request.segment.type === 'emoticon' ? request.segment.emoticonId : undefined
    })
  )
  handleLogged(
    'chat:triggerRun',
    async (_event, request: ChatTriggerRunRequest) => {
      await whenChatReady()
      return triggerRun(request)
    },
    (request) => ({
      requestId: request.requestId,
      holdId: request.holdId,
      sessionId: request.sessionId,
      target: request.target,
      modelId: request.modelId
    })
  )
  handleLogged(
    'chat:compressSession',
    async (_event, request: ChatCompressSessionRequest) => {
      await whenChatReady()
      return compressSession(request)
    },
    (request) => ({ sessionId: request.sessionId })
  )
  handleLogged(
    'chat:exportSession',
    async (_event, request: ChatExportSessionRequest) => {
      await whenChatReady()
      return exportSession(request)
    },
    (request) => ({ sessionId: request.sessionId })
  )
  handleLogged(
    'chat:retryMessage',
    async (_event, request: ChatRetryMessageRequest) => {
      await whenChatReady()
      return retryMessage(request)
    },
    (request) => ({
      requestId: request.requestId,
      sessionId: request.sessionId,
      messageId: request.messageId,
      modelId: request.modelId
    })
  )
  handleLogged(
    'chat:removeFailedTurn',
    async (_event, request: ChatRemoveFailedTurnRequest) => {
      await whenChatReady()
      return removeFailedTurn(request)
    },
    (request) => ({
      requestId: request.requestId,
      sessionId: request.sessionId,
      assistantMessageId: request.assistantMessageId
    })
  )
  handleLogged(
    'chat:deleteSession',
    async (_event, request: ChatDeleteSessionRequest) => {
      await whenChatReady()
      return deleteSession(request)
    },
    (request) => ({ sessionId: request.sessionId })
  )
  handleLogged(
    'chat:deleteGroup',
    async (_event, request: ChatDeleteGroupRequest) => {
      await whenChatReady()
      return deleteGroup(request)
    },
    (request) => ({ groupId: request.groupId })
  )
  handleLogged(
    'chat:setGroupPinned',
    async (_event, request: ChatSetGroupPinnedRequest) => {
      await whenChatReady()
      return setGroupPinned(request)
    },
    (request) => ({ groupId: request.groupId, pinned: request.pinned })
  )
  handleLogged(
    'chat:renameSession',
    async (_event, request: ChatRenameSessionRequest) => {
      await whenChatReady()
      return renameSession(request)
    },
    (request) => ({ sessionId: request.sessionId, titleLength: request.title.length })
  )
  handleLogged(
    'chat:abortRun',
    async (_event, requestId: string) => {
      await whenChatReady()
      return abortRun(requestId)
    },
    (requestId) => ({ requestId })
  )
  handleLogged(
    'chat:getCharacterSessionStateCards',
    async (_event, characterId: string): Promise<CharacterSessionStateCardView[]> => {
      await whenChatReady()
      return getCharacterSessionStateCards(characterId)
    },
    (characterId) => ({ characterId })
  )
}
