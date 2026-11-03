import { useAppSettingsStore } from '@renderer/store/app-settings'
import { checkVoiceReadiness } from '@renderer/services/tts'

/**
 * @description 计算开启语音输出时发送消息的就绪拦截原因。
 * @param characterIds 本次发送可能发声的全部角色标识。
 * @returns 拦截原因；语音输出未开启或全部角色就绪时返回 null。
 * @remarks 只覆盖主进程可本地判定的前提（总开关、provider 配置、音色资源）；引擎离线等在线故障由合成失败态兜底。
 */
export async function getVoiceOutputBlockReason(characterIds: string[]): Promise<string | null> {
  const { enabled, autoSpeak } = useAppSettingsStore.getState().settings.tts
  if (!enabled || !autoSpeak || characterIds.length === 0) {
    return null
  }
  const results = await Promise.all(
    characterIds.map((characterId) => checkVoiceReadiness(characterId))
  )
  const failed = results.find((result) => !result.ok)
  if (failed) {
    return failed.reason ?? '当前角色语音未就绪。'
  }
  return null
}
