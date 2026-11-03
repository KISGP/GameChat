import type { ChatRunEvent } from '@gamechat/type'
import { getChatHost } from '../host'

/**
 * @description 把聊天运行事件推送给宿主呈现层。
 * @remarks 该发布器只承担呈现层实时事件（会话同步、运行终态与角色状态）；流式 token 不经事件通道，
 *   运行轨迹由宿主注入的追踪适配负责。
 */
export class RunEventPublisher {
  /**
   * @description 向宿主推送一条聊天运行事件。
   * @param event 待推送的运行事件。
   */
  publish(event: ChatRunEvent): void {
    getChatHost().emitChatEvent(event)
  }
}
