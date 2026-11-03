export type TtsSynthesisRequest = {
  requestId: string
  messageId: string
  characterId: string
  text: string
}

export type TtsSynthesisResult = {
  audioUrl: string
  cacheHit: boolean
}

export type TtsCharacterVoiceStatus = {
  characterId: string
  isDownloaded: boolean
}

/**
 * @description 语音就绪检查结果：当前 provider 配置与角色音色资源是否满足合成前提。
 */
export type TtsVoiceReadiness = {
  // 检查是否通过。
  ok: boolean
  // 检查失败原因，可直接展示给用户；仅在 ok 为 false 时有值。
  reason?: string
}

export type TtsConnectionTestResult = {
  message: string
}
