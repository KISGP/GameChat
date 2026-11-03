/**
 * @description core 出站请求的 User-Agent 模块槽：全包唯一的品牌默认值与宿主注入点。
 * @remarks 与 setLogSink/setHttpAdapter 同款模块级注入模式；宿主在启动最早期设置一次，
 *   此后所有出站请求（角色远端、萌娘 API、下载器）经 getUserAgent 读取同一值。
 *   默认值是应用类型名 GameChat，包内不存在任何具体品牌名。
 */

/** 唯一默认值：core 作为独立库使用时的应用类型标识。 */
const DEFAULT_USER_AGENT = 'GameChat'

let userAgent = DEFAULT_USER_AGENT

/**
 * @description 设置出站请求的 User-Agent。
 * @param value 宿主品牌标识，通常为 `产品名/版本`。
 * @returns 无返回值。
 * @remarks 空白值被忽略并保持当前值；注入早于一切出站请求发生。
 */
export function setUserAgent(value: string): void {
  const trimmed = value.trim()
  if (!trimmed) {
    return
  }
  userAgent = trimmed
}

/**
 * @description 读取当前出站请求的 User-Agent。
 * @returns 宿主注入值；未注入时为默认的应用类型标识。
 */
export function getUserAgent(): string {
  return userAgent
}
