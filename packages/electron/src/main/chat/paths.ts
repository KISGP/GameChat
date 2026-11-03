/**
 * @description 聊天记录根目录路径：启动引导、存储分析与媒体协议共用的零参读取面。
 * @remarks 会话、群聊、状态卡与附件的细粒度路径构造由 core 聊天域内部维护；
 *   本模块只暴露不依赖聊天宿主的应用数据根基准。
 */
import { join } from 'path'
import { getAppDataRoot } from '../utils/path'

/**
 * @description 返回聊天记录根目录。
 * @returns 聊天记录根目录。
 */
export function getSessionsPath(): string {
  return join(getAppDataRoot(), 'chat-history')
}

/**
 * @description 返回聊天记录根目录；每个拥有者和会话分别使用独立子目录。
 * @returns 聊天记录目录路径。
 */
export function getChatHistoryRoot(): string {
  return getSessionsPath()
}
