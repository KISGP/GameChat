import type { CSSProperties } from 'react'
import xinyuehuPreview from '@renderer/assets/T_IconA_PhoneDialogueR_004_UI.png'
import daweiPreview from '@renderer/assets/T_IconA_PhoneDialogueR_003_UI.png'
import bozaiPreview from '@renderer/assets/T_IconA_PhoneDialogueR_002_UI.png'
import defaultPreview from '@renderer/assets/T_IconA_PhoneDialogueR_000_UI.png'
import frameGold from '@renderer/assets/bubble-frame-gold.png'
import frameDark from '@renderer/assets/bubble-frame-dark.png'
import frameDawei from '@renderer/assets/bubble-frame-dawei.png'
import lightDawei from '@renderer/assets/bubble-dawei-light.png'
import cloudDawei from '@renderer/assets/bubble-dawei-cloud.png'
import frameBozai from '@renderer/assets/bubble-frame-bozai.png'

/** 心月狐金框气泡的持久化标识。 */
export const XINYUEHU_BUBBLE_ID = 'xinyuehu'

/** 大卫·马丁内斯气泡的持久化标识。 */
export const DAWEI_BUBBLE_ID = 'dawei'

/** 波仔气泡的持久化标识。 */
export const BOZAI_BUBBLE_ID = 'bozai'

/** 心月狐气泡双层底框的九宫格切片（SP_IconTalkBgR04*.json 声明：左95 右95 上47 下47）。 */
export const FRAME_SLICE = { left: 95, right: 95, top: 47, bottom: 47 }

/** 心月狐气泡双层底框的统一显示缩放；0.25 下包边厚度（左右 23.75 / 上下 11.75px）恰好占据文字盒的 padding 区。 */
export const BUBBLE_FRAME_SCALE = 0.25

/** 心月狐气泡底层金框资产。 */
export const BUBBLE_FRAME_GOLD_SRC = frameGold

/** 心月狐气泡上层深色磨砂框资产。 */
export const BUBBLE_FRAME_DARK_SRC = frameDark

/**
 * @description 生成心月狐气泡一层九宫格底框的定位与边框图样式。
 * @param src 底框图片资源地址。
 * @param scale 边框显示缩放，1 为纹理原生切片尺寸。
 * @returns 可直接施加到绝对定位元素上的样式。
 * @remarks 统一气泡几何模型：包边带画在文字盒内部、占据 padding 区，中心填充区盖住内容区，
 *          气泡总尺寸与文字盒一致（零额外距离）。
 */
export function frameLayerStyle(src: string, scale: number): CSSProperties {
  const width = `${FRAME_SLICE.top * scale}px ${FRAME_SLICE.right * scale}px ${FRAME_SLICE.bottom * scale}px ${FRAME_SLICE.left * scale}px`
  return {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    borderStyle: 'solid',
    borderWidth: width,
    borderImageWidth: width,
    borderImageSource: `url(${src})`,
    borderImageSlice: `${FRAME_SLICE.top} ${FRAME_SLICE.right} ${FRAME_SLICE.bottom} ${FRAME_SLICE.left} fill`,
    borderImageRepeat: 'stretch',
    pointerEvents: 'none'
  }
}

/** 大卫·马丁内斯气泡底板的九宫格切片（SP_IconTalkBgR03A 面板实际边界：左40 右62 上20 下44）。 */
export const DAWEI_FRAME_SLICE = { left: 40, right: 62, top: 20, bottom: 44 }

/**
 * @description 大卫·马丁内斯气泡底板的显示缩放。
 * @remarks 仅约束横向；纵向缩放由绘制方在盒高装不下上下切片之和时钳制，保证右下切角始终完整。
 */
export const DAWEI_FRAME_SCALE = 0.65

/** 大卫·马丁内斯气泡底板资产。 */
export const DAWEI_FRAME_SRC = frameDawei

/** 大卫·马丁内斯气泡星空平铺层资产。 */
export const DAWEI_LIGHT_SRC = lightDawei

/** 大卫·马丁内斯气泡云带资产。 */
export const DAWEI_CLOUD_SRC = cloudDawei

/** 星空平铺层的显示透明度。 */
export const DAWEI_LIGHT_OPACITY = 0.35

/** 云带贴图的原生像素宽度（已裁除透明边距）；显示宽度为原生宽 × DAWEI_FRAME_SCALE，与底板切角保持同尺。 */
export const DAWEI_CLOUD_NATIVE_WIDTH = 446

/** 云带相对盒右下角的偏移（右/下为正）；贴图可见边界与底板同形，0 即严丝合缝贴角。 */
export const DAWEI_CLOUD_OFFSET = { x: 0, y: 0 }

/** 波仔气泡面板的九宫格切片（SP_IconTalkBgR02A 面板实际边界：左64 右73 上57 下13）。 */
export const BOZAI_FRAME_SLICE = { left: 64, right: 73, top: 57, bottom: 13 }

/**
 * @description 波仔气泡面板的显示缩放。
 * @remarks 仅约束横向；纵向缩放由绘制方在盒高装不下上下切片之和时钳制，保证切角始终完整。
 */
export const BOZAI_FRAME_SCALE = 0.65

/** 波仔气泡面板资产。 */
export const BOZAI_FRAME_SRC = frameBozai

/** 波仔气泡面板上的文字颜色。 */
export const BOZAI_TEXT_COLOR = '#5b4632'

/**
 * @description 描述一个用户消息气泡样式。
 */
export type BubbleStyle = {
  // 样式标识，作为外观设置中的持久化值
  id: string
  // 样式名称
  name: string
  // 界面设置选择卡使用的预览素材
  previewSrc: string
  // 样式描述文案
  description: string
  // 获取方式文案
  obtained: string
}

/**
 * @description 可选的气泡样式清单，首项为默认 CSS 气泡。
 */
export const BUBBLE_STYLES: readonly BubbleStyle[] = [
  {
    id: 'default',
    name: '默认气泡',
    previewSrc: defaultPreview,
    description: '飞讯默认聊天气泡。',
    obtained: '默认获得'
  },
  {
    id: XINYUEHU_BUBBLE_ID,
    name: '烤粘糕',
    previewSrc: xinyuehuPreview,
    description: '梦州的岁主大人最喜爱的味道。',
    obtained: '购买礼包·心月琳琅集后解锁'
  },
  {
    id: DAWEI_BUBBLE_ID,
    name: '大卫·马丁内斯',
    previewSrc: daweiPreview,
    description: '不过，或许所谓传奇便是如此：世间有千万人，就有千万个传奇的影子。',
    obtained: '在幻梦珊瑚商店购买后解锁'
  },
  {
    id: BOZAI_BUBBLE_ID,
    name: '波仔啵啵',
    previewSrc: bozaiPreview,
    description: '客人,又见面了。这次要尝尝店内的新款咖啡吗?',
    obtained: '购买飞讯特惠礼包·甜咖的金印后解锁'
  }
]

const BUBBLE_STYLE_BY_ID = new Map(BUBBLE_STYLES.map((style) => [style.id, style]))

/**
 * @description 根据样式标识获取气泡样式定义。
 * @param bubbleId 待查找的样式标识。
 * @returns 匹配的样式定义；标识未知时返回 null。
 */
export function getBubbleStyleById(bubbleId: string): BubbleStyle | null {
  return BUBBLE_STYLE_BY_ID.get(bubbleId) ?? null
}
