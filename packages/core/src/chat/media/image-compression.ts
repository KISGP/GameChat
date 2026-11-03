import sharp from 'sharp'
import type { ChatImageProcessingSettings } from '@gamechat/type'
import { logger } from '../../infra/log'

/**
 * @description 按设置处理单张聊天图片，返回发给模型的数据 URL；任何失败或无收益时透传原图。
 * @param dataUrl 原始图片 Data URL。
 * @param settings 图片处理设置。
 * @returns 处理后的或原始的图片 Data URL。
 */
export async function processChatImage(
  dataUrl: string,
  settings: ChatImageProcessingSettings
): Promise<string> {
  if (
    !settings.enabled ||
    (settings.compression.quality === 100 && settings.resize.preset === 'original')
  ) {
    return dataUrl
  }

  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/u.exec(dataUrl)
  if (!match) {
    void logger.warn(
      'ai',
      'chat-image-processing-skipped',
      'Unsupported chat image data URL format'
    )
    return dataUrl
  }

  const mimeType = match[1]
  const input = Buffer.from(match[2], 'base64')
  try {
    let pipeline = sharp(input)
    if (settings.resize.preset !== 'original') {
      const metadata = await pipeline.metadata()
      const width = metadata.width || 0
      const height = metadata.height || 0
      if (Math.max(width, height) > settings.resize.preset) {
        pipeline = pipeline.resize({
          width: settings.resize.preset,
          height: settings.resize.preset,
          fit: 'inside',
          withoutEnlargement: true
        })
      }
    }

    if (settings.compression.quality < 100) {
      if (mimeType === 'image/png') {
        pipeline = pipeline.png({ palette: true, quality: settings.compression.quality })
      } else if (mimeType === 'image/jpeg') {
        pipeline = pipeline.jpeg({ quality: settings.compression.quality, mozjpeg: true })
      } else {
        pipeline = pipeline.webp({ quality: settings.compression.quality })
      }
    }

    const output = await pipeline.toBuffer()
    if (output.byteLength >= input.byteLength) {
      return dataUrl
    }
    return `data:${mimeType};base64,${output.toString('base64')}`
  } catch (error) {
    void logger.warn(
      'ai',
      'chat-image-processing-failed',
      'Failed to process chat image; using original',
      {
        mimeType,
        error: error instanceof Error ? error.message : String(error)
      }
    )
    return dataUrl
  }
}
