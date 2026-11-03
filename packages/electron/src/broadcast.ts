import type { WebContents } from 'electron'
import { BrowserWindow } from 'electron'

/**
 * @description 向所有未销毁的窗口广播一条 main→renderer 消息。
 * @param channel IPC 推送通道名称。
 * @param payload 随消息发送的载荷。
 * @remarks 这是 main 进程主动推送的统一入口，集中携带 isDestroyed 防护。
 */
export function broadcastToAllWindows(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload)
    }
  }
}

/**
 * @description 向单个 webContents 发送一条 main→renderer 消息。
 * @param sender 目标 webContents，通常来自 IPC event.sender。
 * @param channel IPC 推送通道名称。
 * @param payload 随消息发送的载荷。
 * @remarks 目标已销毁时静默跳过，避免向失效窗口发送导致崩溃。
 */
export function sendToWebContents(sender: WebContents, channel: string, payload: unknown): void {
  if (!sender.isDestroyed()) {
    sender.send(channel, payload)
  }
}
