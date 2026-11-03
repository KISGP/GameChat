import type { SpineAssetId } from '@renderer/common/lib/spine-assets'
import Pet00Preview from '@renderer/assets/T_PhoneSystemIconPet00Small.png'
import Pet01Preview from '@renderer/assets/T_PhoneSystemIconPet01Small.png'

/**
 * @description 描述一个可装备到聊天面板的 Spine 摆件。
 */
export type Ornament = {
  // 摆件标识，与 spine 资产标识一致，同时作为外观设置中的持久化值
  id: SpineAssetId
  // 摆件名称
  name: string
  // 界面设置缩略图与大图预览使用的素材
  previewSrc: string
  // 摆件描述文案
  description: string
  // 获取方式文案
  obtained: string
  // 依次轮换循环的动画名清单：多个时各播一遍后从头循环，单个时无限循环
  animations: readonly string[]
  // 点击时轮流播放的互动动画清单
  tapAnimations: readonly string[]
}

/**
 * @description 「无摆件」选项在界面设置中使用的预览素材。
 */
export const ORNAMENT_NONE_PREVIEW = Pet00Preview

/**
 * @description 可装备的摆件清单。
 */
export const ORNAMENTS: readonly Ornament[] = [
  {
    id: 'PhoneSystem_XinYueHu',
    name: '「心」的挂念',
    previewSrc: Pet01Preview,
    description: '注意，这并不是心狐粘糕。',
    obtained: '购买礼包·心月琳琅集后解锁',
    animations: ['idle_01', 'idle_02'],
    tapAnimations: ['touch_01', 'touch_02']
  }
]

const ORNAMENT_BY_ID = new Map(ORNAMENTS.map((ornament) => [ornament.id, ornament]))

/**
 * @description 根据摆件标识获取摆件定义。
 * @param ornamentId 待查找的摆件标识。
 * @returns 匹配的摆件定义；标识未知时返回 null。
 */
export function getOrnamentById(ornamentId: string): Ornament | null {
  return ORNAMENT_BY_ID.get(ornamentId as SpineAssetId) ?? null
}
