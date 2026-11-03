import type { GachaUrlRequest } from '@gamechat/type'
import { getGachaUrl } from '../tools/index'
import { handleLogged } from './logged-handler'

/**
 * @description 注册工具页相关 IPC，供 renderer 获取抽卡记录链接。
 */
export function registerToolsIpc(): void {
  handleLogged(
    'tools:getGachaUrl',
    (_event, request?: GachaUrlRequest) => getGachaUrl(request),
    (request) => ({
      hasManualPath: Boolean(request?.gamePath?.trim())
    })
  )
}
