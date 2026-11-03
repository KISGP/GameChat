import { AppError } from '../errors/AppError'
import {
  getCharacterTtsVoiceData,
  getCharacterTtsVoiceStatus,
  getTtsService,
  isTtsSynthesisRequest
} from '../tts/index'
import type { TtsSynthesisRequest } from '@gamechat/type'
import { handleLogged } from './logged-handler'

/**
 * @description 注册本地 TTS 合成与取消 IPC，限制渲染进程只能提交文本和请求标识。
 */
export function registerTtsIpc(): void {
  handleLogged(
    'tts:synthesize',
    (_event, request: unknown) => {
      if (!isTtsSynthesisRequest(request)) {
        throw new AppError('TTS_RUNTIME_ERROR', 'Invalid TTS synthesis request', {
          safeMessage: '语音请求无效，请重试。'
        })
      }

      return getTtsService().synthesize(request)
    },
    (request: unknown) => {
      const typedRequest = request as Partial<TtsSynthesisRequest>
      return {
        requestId: typedRequest.requestId,
        messageId: typedRequest.messageId,
        characterId: typedRequest.characterId,
        textLength: typedRequest.text?.length
      }
    }
  )
  handleLogged(
    'tts:cancel',
    (_event, requestId: string) => getTtsService().cancel(requestId),
    (requestId) => ({ requestId })
  )
  handleLogged('tts:getCharacterVoiceStatus', (_event, characterId: string) =>
    getCharacterTtsVoiceStatus(characterId)
  )
  handleLogged('tts:getCharacterVoiceData', (_event, characterId: string) =>
    getCharacterTtsVoiceData(characterId)
  )
  handleLogged(
    'tts:checkVoiceReadiness',
    (_event, characterId: string) => getTtsService().checkVoiceReadiness(characterId),
    (characterId) => ({ characterId })
  )
  handleLogged('tts:testLocalEngineConnection', () => getTtsService().testLocalEngineConnection())
}
