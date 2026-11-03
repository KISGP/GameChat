import { copyFile, mkdir, writeFile } from 'fs/promises'
import path from 'path'
import type { ConversationSession } from '@gamechat/type'
import { CHAT_IMAGE_MIME_EXTENSIONS } from '@gamechat/schema'
import { getChatHost } from '../host'
import { getChatAttachmentPath } from '../paths'

/** 导出结果：用户取消，或成功落盘的文件路径与消息数。 */
export type MarkdownExportResult =
  | { canceled: true }
  | { canceled: false; filePath: string; messageCount: number }

/**
 * @description 将整个会话导出为 Markdown 文件，图片附件复制到同名资源目录并以相对路径引用。
 * @param options 会话快照与成员展示名映射。
 * @returns 导出结果；用户在保存对话框取消时返回 canceled。
 * @throws 写盘失败时抛错，由调用方翻译为界面提示。
 * @remarks 消息一经提交即永久保留，导出始终包含全部原文，与滚动摘要无关。
 */
export async function exportSessionMarkdown(options: {
  session: ConversationSession
  characterNames: ReadonlyMap<string, string>
}): Promise<MarkdownExportResult> {
  const defaultName = sanitizeFileName(`${options.session.title || '会话'}.md`)
  const dialogResult = await getChatHost().showSaveDialog({
    title: '导出会话为 Markdown',
    defaultPath: defaultName,
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  })
  const filePath = dialogResult.canceled ? null : (dialogResult.filePath ?? null)
  if (!filePath) {
    return { canceled: true }
  }

  const assetsDirName = `${path.basename(filePath, path.extname(filePath))}.assets`
  const { text: markdown, messageCount } = buildSessionMarkdown(
    options.session,
    options.characterNames,
    assetsDirName
  )
  await writeFile(filePath, markdown, 'utf8')
  await copyExportAssets({
    session: options.session,
    assetsDirName,
    filePath
  })
  return { canceled: false, filePath, messageCount }
}

/**
 * @description 构造整会话的 Markdown 文本。
 * @param session 会话快照。
 * @param characterNames 成员 ID 到展示名的映射。
 * @param assetsDirName 图片资源目录名，用于生成相对引用路径。
 * @returns Markdown 文本与实际导出的消息总数。
 */
function buildSessionMarkdown(
  session: ConversationSession,
  characterNames: ReadonlyMap<string, string>,
  assetsDirName: string
): { text: string; messageCount: number } {
  const lines: string[] = [`# ${session.title || '会话'}`, '']
  let messageCount = 0
  for (const message of session.messages) {
    // 失败提示只在列表内以徽章呈现，不进入模型上下文，导出同样跳过。
    if (message.status === 'error') {
      continue
    }
    messageCount += 1
    const speaker =
      message.role === 'user'
        ? '用户'
        : characterNames.get(message.senderId) || message.senderId || '角色'
    const time = new Date(message.createdAt).toLocaleString('zh-CN', { hour12: false })
    lines.push(`**${speaker}** · ${time}`, '')
    if (message.content.trim()) {
      lines.push(message.content.trim(), '')
    }
    if (message.emoticonId) {
      lines.push(
        `（表情：${formatEmoticonText(message.emoticonId, message.emoticonDescription)}）`,
        ''
      )
    }
    for (const attachment of message.attachments || []) {
      const extension = CHAT_IMAGE_MIME_EXTENSIONS[attachment.mimeType]
      lines.push(
        `![${attachment.fileName}](./${assetsDirName}/${attachment.resourceId}${extension})`,
        ''
      )
    }
  }
  lines.push(
    '---',
    '',
    `> 由 GameChat 导出 · 共 ${messageCount} 条消息 · 图片位于同名 .assets 目录。`,
    ''
  )
  return { text: lines.join('\n'), messageCount }
}

/**
 * @description 把会话附件复制到导出文件同级的资源目录。
 * @param options 会话快照、资源目录名与导出文件路径。
 */
async function copyExportAssets(options: {
  session: ConversationSession
  assetsDirName: string
  filePath: string
}): Promise<void> {
  const attachments = options.session.messages.flatMap((message) => message.attachments || [])
  if (attachments.length === 0) {
    return
  }
  const assetsDir = path.join(path.dirname(options.filePath), options.assetsDirName)
  await mkdir(assetsDir, { recursive: true })
  await Promise.all(
    attachments.map(async (attachment) => {
      const source = getChatAttachmentPath(
        options.session.ownerId,
        options.session.id,
        attachment.resourceId,
        CHAT_IMAGE_MIME_EXTENSIONS[attachment.mimeType]
      )
      const target = path.join(
        assetsDir,
        attachment.resourceId + CHAT_IMAGE_MIME_EXTENSIONS[attachment.mimeType]
      )
      await copyFile(source, target)
    })
  )
}

/**
 * @description 将表情标记渲染为可读文本。
 * @param emoticonId 表情标识。
 * @param description 表情描述；缺省时只保留标识。
 * @returns `表情标识（描述）` 形态的文本。
 */
function formatEmoticonText(emoticonId: string, description?: string): string {
  return description ? `${emoticonId}（${description}）` : emoticonId
}

/**
 * @description 清理文件名中的非法字符。
 * @param name 原始文件名。
 * @returns 替换非法字符后的安全文件名。
 */
function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_')
}
