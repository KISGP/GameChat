import { create } from 'zustand'
import { AppearanceSettings } from '@gamechat/type'
import BG1 from '@renderer/assets/T_PhoneSystemPanelS.png'
import BG2 from '@renderer/assets/T_PhoneSystemIconBg02.png'
import BG3 from '@renderer/assets/T_PhoneSystemIconBg03.png'
import BG4 from '@renderer/assets/T_PhoneSystemIconBg04.png'
import BG1Pre from '@renderer/assets/T_PhoneSystemIconBg00Small.png'
import BG2Pre from '@renderer/assets/T_PhoneSystemIconBg02Small.png'
import BG3Pre from '@renderer/assets/T_PhoneSystemIconBg03Small.png'
import BG4Pre from '@renderer/assets/T_PhoneSystemIconBg04Small.png'
import { saveAppearance as persistAppearance } from '@renderer/services/settings'
import { trackError } from '@renderer/app/telemetry'
import { DEFAULT_SKIN_ID, resolveSkinId } from '../skins/catalog'
import { getOrnamentById } from '../ornaments/catalog'
import { getBubbleStyleById } from '../bubbles/catalog'

export type ChatBackground = {
  id: string
  name: string
  previewSrc: string
  fullSrc: string
  description: string
  obtained: string
}

export const CHAT_BACKGROUNDS: ChatBackground[] = [
  {
    id: 'default',
    name: '默认背景',
    previewSrc: BG1Pre,
    fullSrc: BG1,
    description: '飞讯默认聊天背景',
    obtained: '默认获得'
  },
  {
    id: 'sweet-coffee-time',
    name: '甜咖时光',
    previewSrc: BG2Pre,
    fullSrc: BG2,
    description: '研磨的时光中，唯有伙伴的笑语与咖啡的香气与你共享此刻的静谧。',
    obtained: '购买飞讯特惠礼包 · 甜咖的金印后解锁'
  },
  {
    id: 'i-miss-you-all-the-time',
    name: 'I miss you all the time',
    previewSrc: BG3Pre,
    fullSrc: BG3,
    description: 'I Really Want to Stay At Your House.',
    obtained: '在幻梦珊瑚商店购买后解锁'
  },
  {
    id: 'i-',
    name: '华灯初上',
    previewSrc: BG4Pre,
    fullSrc: BG4,
    description: '华灯照夜映朱颜,心狐衔梦入人间。',
    obtained: '购买礼包·心月琳琅集后解锁'
  }
]

const BACKGROUND_BY_ID = new Map(CHAT_BACKGROUNDS.map((background) => [background.id, background]))
const DEFAULT_BACKGROUND_ID = CHAT_BACKGROUNDS[0].id

type AppearanceStore = {
  appearance: Appearance
  isLoaded: boolean
  saveError: string | null
  hydrate: (appearance: AppearanceSettings) => void
  setBackgroundId: (backgroundId: string) => Promise<void>
  setSkinId: (skinId: string) => Promise<void>
  setOrnamentId: (ornamentId: string) => Promise<void>
  setBubbleId: (bubbleId: string) => Promise<void>
  retrySave: () => Promise<void>
}

/**
 * @description 当前生效的外观设置。
 */
type Appearance = {
  // 用户选中的聊天背景标识
  backgroundId: string
  // 用户选中的主题皮肤标识
  skinId: string
  // 用户装备的聊天面板摆件标识，空字符串表示未装备
  ornamentId: string
  // 用户选中的气泡样式标识，'default' 表示默认 CSS 气泡
  bubbleId: string
}

/**
 * @description 解析可用的摆件标识，未知值回退为未装备。
 * @param ornamentId 待解析的摆件标识，允许为空或未知值。
 * @returns 可安全使用的摆件标识。
 */
function resolveOrnamentId(ornamentId: string | null | undefined): string {
  if (!ornamentId || !getOrnamentById(ornamentId)) {
    return ''
  }
  return ornamentId
}

/**
 * @description 解析可用的气泡样式标识，未知值回退为默认 CSS 气泡。
 * @param bubbleId 待解析的气泡样式标识，允许为空或未知值。
 * @returns 可安全使用的气泡样式标识。
 */
function resolveBubbleId(bubbleId: string | null | undefined): string {
  if (!bubbleId || !getBubbleStyleById(bubbleId)) {
    return 'default'
  }
  return bubbleId
}

/**
 * @description 从背景列表中解析可用的背景 ID，不合法时回退为默认背景。
 * @param backgroundId 待解析的背景 ID，允许为空或未知值。
 * @returns 可安全使用的背景 ID。
 */
function resolveBackgroundId(backgroundId: string | null | undefined): string {
  if (!backgroundId || !BACKGROUND_BY_ID.has(backgroundId)) {
    return DEFAULT_BACKGROUND_ID
  }

  return backgroundId
}

/**
 * @description 保存界面外观设置，并将失败状态保留给界面显示与重试。
 * @param appearance 待持久化的外观设置。
 * @param set Zustand 的状态更新函数。
 * @returns 外观设置保存尝试结束后的 Promise。
 * @remarks 写入失败时会记录错误并更新 Store，不会向调用方重新抛出异常。
 */
async function saveAppearance(
  appearance: Appearance,
  set: (partial: Partial<AppearanceStore>) => void
): Promise<void> {
  try {
    await persistAppearance(appearance)
    set({ saveError: null })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    trackError('save-appearance-failed', 'Failed to save appearance settings', error)
    set({ saveError: message })
  }
}

/**
 * @description 根据背景 ID 获取完整背景元数据，不合法时回退为默认背景。
 * @param backgroundId 待查找的背景 ID。
 * @returns 匹配到的背景配置。
 */
export function getChatBackgroundById(backgroundId: string): ChatBackground {
  return BACKGROUND_BY_ID.get(backgroundId) ?? CHAT_BACKGROUNDS[0]
}

export const useAppearanceStore = create<AppearanceStore>((set, get) => ({
  appearance: {
    backgroundId: DEFAULT_BACKGROUND_ID,
    skinId: DEFAULT_SKIN_ID,
    ornamentId: '',
    bubbleId: 'default'
  },
  isLoaded: false,
  saveError: null,
  /**
   * @description 使用主进程返回的外观设置初始化 Store。
   * @param appearance 主进程返回的外观设置快照。
   * @returns 无返回值。
   */
  hydrate: (appearance) =>
    set({
      appearance: {
        backgroundId: resolveBackgroundId(appearance.backgroundId),
        skinId: resolveSkinId(appearance.skinId),
        ornamentId: resolveOrnamentId(appearance.ornamentId),
        bubbleId: resolveBubbleId(appearance.bubbleId)
      },
      isLoaded: true
    }),
  /**
   * @description 更新聊天背景并持久化外观设置。
   * @param backgroundId 用户选择的背景标识。
   * @returns 外观设置保存流程完成后的 Promise。
   * @remarks 无效背景标识会在写入前回退为默认背景；其余外观项保持当前值不变。
   */
  setBackgroundId: async (backgroundId) => {
    const appearance = {
      backgroundId: resolveBackgroundId(backgroundId),
      skinId: get().appearance.skinId,
      ornamentId: get().appearance.ornamentId,
      bubbleId: get().appearance.bubbleId
    }
    set({ appearance, saveError: null })
    await saveAppearance(appearance, set)
  },
  /**
   * @description 更新主题皮肤并持久化外观设置。
   * @param skinId 用户选择的皮肤标识。
   * @returns 外观设置保存流程完成后的 Promise。
   * @remarks 无效皮肤标识会在写入前回退为默认皮肤；其余外观项保持当前值不变。
   */
  setSkinId: async (skinId) => {
    const appearance = {
      backgroundId: get().appearance.backgroundId,
      skinId: resolveSkinId(skinId),
      ornamentId: get().appearance.ornamentId,
      bubbleId: get().appearance.bubbleId
    }
    set({ appearance, saveError: null })
    await saveAppearance(appearance, set)
  },
  /**
   * @description 更新聊天面板摆件并持久化外观设置。
   * @param ornamentId 用户装备的摆件标识，空字符串表示取消装备。
   * @returns 外观设置保存流程完成后的 Promise。
   * @remarks 未知摆件标识会在写入前回退为未装备；其余外观项保持当前值不变。
   */
  setOrnamentId: async (ornamentId) => {
    const appearance = {
      backgroundId: get().appearance.backgroundId,
      skinId: get().appearance.skinId,
      ornamentId: resolveOrnamentId(ornamentId),
      bubbleId: get().appearance.bubbleId
    }
    set({ appearance, saveError: null })
    await saveAppearance(appearance, set)
  },
  /**
   * @description 更新气泡样式并持久化外观设置。
   * @param bubbleId 用户选择的气泡样式标识。
   * @returns 外观设置保存流程完成后的 Promise。
   * @remarks 未知样式标识会在写入前回退为默认 CSS 气泡；其余外观项保持当前值不变。
   */
  setBubbleId: async (bubbleId) => {
    const appearance = {
      backgroundId: get().appearance.backgroundId,
      skinId: get().appearance.skinId,
      ornamentId: get().appearance.ornamentId,
      bubbleId: resolveBubbleId(bubbleId)
    }
    set({ appearance, saveError: null })
    await saveAppearance(appearance, set)
  },
  /**
   * @description 重试保存当前外观设置。
   * @returns 当前外观设置保存流程完成后的 Promise。
   */
  retrySave: async () => saveAppearance(get().appearance, set)
}))

/**
 * @description 从外观 Store 中选出当前生效的聊天背景配置。
 * @param state 聊天外观状态。
 * @returns 当前选中的背景配置。
 */
export function selectActiveBackground(state: AppearanceStore): ChatBackground {
  return getChatBackgroundById(state.appearance.backgroundId)
}
