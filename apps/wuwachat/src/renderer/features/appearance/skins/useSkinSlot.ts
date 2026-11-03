import { useAppearanceStore } from '../store/appearance'
import {
  getSkinById,
  resolveSkinSlot,
  type SkinCatalogEntry,
  type SkinSlotAssets,
  type SkinSlotKey,
  type SkinStyleKey
} from './catalog'

/**
 * @description 订阅当前主题皮肤下指定槽位应使用的素材。
 * @param slot 槽位键。
 * @returns 该槽位当前应渲染的素材；当前皮肤未提供时为基线皮肤的素材。
 */
export function useSkinSlot<K extends SkinSlotKey>(slot: K): SkinSlotAssets[K] {
  return useAppearanceStore((state) => resolveSkinSlot(state.appearance.skinId, slot))
}

/**
 * @description 订阅当前主题皮肤声明的 Spine 动态装饰。
 * @returns 当前皮肤的装饰声明；皮肤未声明任何装饰时为 undefined。
 */
export function useSkinDecorations(): SkinCatalogEntry['decorations'] {
  return useAppearanceStore((state) => getSkinById(state.appearance.skinId).decorations)
}

/**
 * @description 订阅当前主题皮肤下指定目标的样式覆写。
 * @param key 覆写目标元素键（槽位或结构件）。
 * @returns 追加到该元素基础类名之后的 className 串；皮肤未提供 styles 字段或未配置该键时为 undefined。
 */
export function useSkinStyle(key: SkinStyleKey): string | undefined {
  return useAppearanceStore((state) => getSkinById(state.appearance.skinId).styles?.[key])
}
