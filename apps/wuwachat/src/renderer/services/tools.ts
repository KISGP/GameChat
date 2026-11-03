import { GachaUrlRequest } from '@gamechat/type'
/**
 * @description 扫描并解析游戏抽卡链接。
 * @param request 可选的扫描范围和解析配置。
 * @returns 解析后的抽卡链接结果 Promise。
 */
export function getGachaUrl(
  request?: GachaUrlRequest
): ReturnType<typeof window.tools.getGachaUrl> {
  return window.tools.getGachaUrl(request)
}
