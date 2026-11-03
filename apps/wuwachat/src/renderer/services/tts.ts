import { TtsSynthesisRequest } from '@gamechat/type'
/**
 * @description 请求合成一段角色语音。
 * @param request 包含文本、角色和语音配置的合成请求。
 * @returns 语音合成结果的 Promise。
 */
export function synthesize(request: TtsSynthesisRequest): ReturnType<typeof window.tts.synthesize> {
  return window.tts.synthesize(request)
}
/**
 * @description 取消指定语音合成。
 * @param requestId 要取消的语音合成请求标识。
 * @returns 主进程处理取消请求后的 Promise。
 */
export function cancel(requestId: string): ReturnType<typeof window.tts.cancel> {
  return window.tts.cancel(requestId)
}
/**
 * @description 测试本地 TTS 引擎连通性。
 * @returns 本地 TTS 引擎测试结果的 Promise。
 */
export function testLocalTtsConnection(): ReturnType<typeof window.tts.testLocalEngineConnection> {
  return window.tts.testLocalEngineConnection()
}
/**
 * @description 查询角色本地音色下载状态。
 * @param characterId 要查询音色资源的角色标识。
 * @returns 角色音色下载状态的 Promise。
 */
export function getCharacterVoiceStatus(
  characterId: string
): ReturnType<typeof window.tts.getCharacterVoiceStatus> {
  return window.tts.getCharacterVoiceStatus(characterId)
}
/**
 * @description 读取角色参考音色文件字节。
 * @param characterId 要试听音色的角色标识。
 * @returns WAV 文件字节的 Promise。
 * @remarks 字节经 IPC 直传（结构化克隆），渲染层转 blob 后交播放器使用；
 *   波形包络计算需要原始字节做本地解码，IPC 直传不经协议与 fetch 层。
 */
export function getCharacterVoiceData(
  characterId: string
): ReturnType<typeof window.tts.getCharacterVoiceData> {
  return window.tts.getCharacterVoiceData(characterId)
}
/**
 * @description 检查角色在当前 provider 下是否具备语音合成前提。
 * @param characterId 要检查的角色标识。
 * @returns 语音就绪检查结果的 Promise。
 */
export function checkVoiceReadiness(
  characterId: string
): ReturnType<typeof window.tts.checkVoiceReadiness> {
  return window.tts.checkVoiceReadiness(characterId)
}
