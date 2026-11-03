import type { SpineAssetId } from '@renderer/common/lib/spine-assets'
import Skin000Preview from '@renderer/assets/T_PhoneSystemIconSkin00Small.png'
import Skin000LargePreview from '@renderer/assets/Skin000Pre.png'
import Skin000TitleBar from '@renderer/assets/Skin000/T_PhoneSkinBgTitle000.png'
import Skin000RailBackground from '@renderer/assets/Skin000/T_PhoneSkinBgL000.png'
import Skin000PanelBaseEmpty from '@renderer/assets/Skin000/T_PhoneSkinBgEmpty000.png'
import Skin000PanelBaseConversation from '@renderer/assets/Skin000/T_PhoneSkinBgR000.png'
import Skin000PanelCharFrame from '@renderer/assets/T_PhoneSystemModel03.png'
import Skin000PanelCharFrameOverlay from '@renderer/assets/T_PhoneSystemModel03Line.png'
import Skin000CardNml from '@renderer/assets/Skin000/T_PhoneSkinTogANml000.png'
import Skin000CardHold from '@renderer/assets/Skin000/T_PhoneSkinTogAHold000.png'
import Skin000CardPress from '@renderer/assets/Skin000/T_PhoneSkinTogAPress000.png'
import Skin000CardSel from '@renderer/assets/Skin000/T_PhoneSkinTogASel000.png'
import Skin000ConversationNml from '@renderer/assets/Skin000/T_PhoneSkinTogBNml000.png'
import Skin000ConversationHold from '@renderer/assets/Skin000/T_PhoneSkinTogBHold000.png'
import Skin000ConversationPress from '@renderer/assets/Skin000/T_PhoneSkinTogBPress000.png'
import Skin000ConversationSel from '@renderer/assets/Skin000/T_PhoneSkinTogBSel000.png'

import Skin001TitleBar from '@renderer/assets/Skin001/T_PhoneSkin001_Desc02.png'
import Skin001RailBackground from '@renderer/assets/Skin001/T_PhoneSkin001_Desc01.png'
import Skin001Preview from '@renderer/assets/T_PhoneSystemIconSkin01Small.png'
import Skin001LargePreview from '@renderer/assets/Skin001Pre.png'
import Skin001PanelBaseEmpty from '@renderer/assets/Skin001/T_PhoneSkinBgEmpty001.png'
import Skin001PanelBaseConversation from '@renderer/assets/Skin001/T_PhoneSkin001_Desc07.png'
import Skin001PanelCharFrame from '@renderer/assets/Skin001/T_PhoneSkin001_Desc05.png'
import Skin001CardNml from '@renderer/assets/Skin001/T_PhoneSkinTogANml001.png'
import Skin001CardHold from '@renderer/assets/Skin001/T_PhoneSkinTogAHold001.png'
import Skin001CardPress from '@renderer/assets/Skin001/T_PhoneSkinTogAPress001.png'
import Skin001CardSel from '@renderer/assets/Skin001/T_PhoneSkinTogASel001.png'
import Skin001ConversationNml from '@renderer/assets/Skin001/T_PhoneSkinTogBNml001.png'
import Skin001ConversationHold from '@renderer/assets/Skin001/T_PhoneSkinTogBHold001.png'
import Skin001ConversationPress from '@renderer/assets/Skin001/T_PhoneSkinTogBPress001.png'
import Skin001ConversationSel from '@renderer/assets/Skin001/T_PhoneSkinTogBSel001.png'

/**
 * @description 皮肤交互状态键，与素材四态一一对应。
 * @remarks 对应关系为 normal←Nml、hover←Hold、pressed←Press、selected←Sel；本套美术以 Hold 表达鼠标悬浮态。
 */
export const SKIN_INTERACTION_STATES = ['normal', 'hover', 'pressed', 'selected'] as const

/**
 * @description 皮肤交互状态的键名。
 */
export type SkinInteractionState = (typeof SKIN_INTERACTION_STATES)[number]

/**
 * @description 面板底图的状态键，对应是否已选中会话。
 * @remarks empty 表示未选中任何会话的空态，conversation 表示会话进行中。
 */
export const SKIN_PANEL_BASE_STATES = ['empty', 'conversation'] as const

/**
 * @description 面板底图的状态键名。
 */
export type SkinPanelBaseState = (typeof SKIN_PANEL_BASE_STATES)[number]

/**
 * @description 皮肤需要提供的槽位素材集合。
 * @remarks 槽位是开放集合：新增接管部位时扩展键，并让各皮肤条目补齐对应素材。槽位值为空字符串表示该皮肤明确不渲染此层，由消费组件判空跳过渲染；键缺失时回退基线皮肤。
 */
export type SkinSlotAssets = {
  // 标题栏背景图
  titleBar: string
  // 左侧会话栏背景图
  railBackground: string
  // 聊天面板底图两态（未选会话空态 / 会话进行中）
  panelBaseStates: Record<SkinPanelBaseState, string>
  // 聊天面板角色立绘框
  panelCharFrame: string
  // 聊天面板立绘框上层贴图
  panelCharFrameOverlay: string
  // 会话卡片四态背景（角色卡与群聊卡共用）
  cardStates: Record<SkinInteractionState, string>
  // 会话入口四态背景（卡片展开列表中的会话条目）
  conversationStates: Record<SkinInteractionState, string>
}

/**
 * @description 皮肤槽位键。
 */
export type SkinSlotKey = keyof SkinSlotAssets

/**
 * @description 可选样式覆写的目标元素键：槽位键之外补充非槽位的结构件。
 */
export type SkinStyleKey =
  | SkinSlotKey
  | 'cardWrapper'
  | 'headerLogo'
  | 'headerLogoDot'
  | 'headerTitle'
  | 'panelTitle'
  | 'panelDescription'

/**
 * @description 皮肤注册表条目。
 */
export type SkinCatalogEntry = {
  // 皮肤标识，持久化于 AppearanceSettings.skinId
  id: string
  // 界面设置中展示的皮肤名
  name: string
  // 界面设置中展示的皮肤描述
  description: string
  // 界面设置中展示的获取方式文案
  obtained: string
  // 界面设置缩略卡使用的素材
  previewSrc: string
  // 界面设置右侧大图预览使用的素材
  largePreviewSrc: string
  // 皮肤提供的槽位素材；缺失槽位在解析时回退基线皮肤
  slots: Partial<SkinSlotAssets>
  // 可选的样式覆写：键为覆写目标元素键，值为追加到该元素基础类名之后的 className 串；缺省字段或缺键表示无覆写
  styles?: Partial<Record<SkinStyleKey, string>>
  // 可选的 Spine 动态装饰；仅当前皮肤自身声明了装饰时渲染，不做基线回退
  decorations?: SkinDecorations
}

/**
 * @description 皮肤的 Spine 动态装饰声明。
 */
/**
 * @description 单个 Spine 装饰挂载的自描述条目：资产、动画与渲染几何。
 */
export type SkinSpineMount = {
  // 播放的 spine 资产标识
  assetId: SpineAssetId
  // 依次轮换循环的动画名清单：多个时各播一遍后从头循环，单个时无限循环
  animations: readonly string[]
  // 挂载定位与尺寸（tailwind 类，含定位锚点与层级）
  className: string
  // 点击时轮流播放的互动动画清单；提供时挂载接收指针交互
  tapAnimations?: readonly string[]
  // 模型显示缩放倍率，相对授权视口 contain 尺寸
  scale?: number
}

/**
 * @description 皮肤的 Spine 动态装饰声明：按渲染面分组的挂载清单。
 * @remarks 装饰不做基线回退——皮肤未声明某面的清单时该面不渲染任何挂载。
 */
export type SkinDecorations = {
  // 应用顶栏挂载清单
  headerSpines?: readonly SkinSpineMount[]
  // 聊天面板挂载清单
  panelSpines?: readonly SkinSpineMount[]
  // 用户装备摆件的挂载几何；缺省时使用 DEFAULT_ORNAMENT_MOUNT 基线值
  ornamentMount?: { className: string; scale?: number }
}

/**
 * @description 摆件挂载几何的基线值，供未声明 ornamentMount 的皮肤使用。
 */
export const DEFAULT_ORNAMENT_MOUNT = {
  className: 'absolute -right-10 -bottom-17 z-50 h-60 w-60',
  scale: 1.1
} as const

/**
 * @description 基线皮肤 Skin000，槽位素材的完整来源。
 * @remarks 其余皮肤缺失的槽位在解析时回退到该条目的同槽位素材。
 */
const SKIN000: SkinCatalogEntry & { slots: SkinSlotAssets } = {
  id: 'skin000',
  name: '默认主题',
  description: '飞讯默认主题',
  obtained: '默认获得',
  previewSrc: Skin000Preview,
  largePreviewSrc: Skin000LargePreview,
  slots: {
    titleBar: Skin000TitleBar,
    railBackground: Skin000RailBackground,
    panelBaseStates: {
      empty: Skin000PanelBaseEmpty,
      conversation: Skin000PanelBaseConversation
    },
    panelCharFrame: Skin000PanelCharFrame,
    panelCharFrameOverlay: Skin000PanelCharFrameOverlay,
    cardStates: {
      normal: Skin000CardNml,
      hover: Skin000CardHold,
      pressed: Skin000CardPress,
      selected: Skin000CardSel
    },
    conversationStates: {
      normal: Skin000ConversationNml,
      hover: Skin000ConversationHold,
      pressed: Skin000ConversationPress,
      selected: Skin000ConversationSel
    }
  },
  styles: {
    panelCharFrame: 'top-1 left-1 scale-97',
    panelCharFrameOverlay : 'absolute top-20 left-1 z-10 scale-96 object-contain',
    headerLogo: 'top-5 left-12 size-8',
    headerLogoDot: 'top-7.5 left-26',
    headerTitle: 'top-5.5 left-38 text-neutral-300/80',
    panelTitle: 'text-black/90',
    panelDescription: 'text-black/70'
  }
}

/**
 * @description 皮肤 Skin001。
 * @remarks 未提供面板底图槽位，渲染时回退基线皮肤。
 */
const SKIN001: SkinCatalogEntry = {
  id: 'skin001',
  name: '朝月清辉',
  description: '长乐未央,共此良辰。',
  obtained: '购买礼包·心月琳琅集后解锁',
  previewSrc: Skin001Preview,
  largePreviewSrc: Skin001LargePreview,
  slots: {
    panelBaseStates: {
      empty: Skin001PanelBaseEmpty,
      conversation: Skin001PanelBaseConversation
    },
    panelCharFrame: Skin001PanelCharFrame,
    // 置空表示该皮肤不提供立绘框上层贴图；空串不会触发基线皮肤回退
    panelCharFrameOverlay: '',
    titleBar: Skin001TitleBar,
    railBackground: Skin001RailBackground,
    cardStates: {
      normal: Skin001CardNml,
      hover: Skin001CardHold,
      pressed: Skin001CardPress,
      selected: Skin001CardSel
    },
    conversationStates: {
      normal: Skin001ConversationNml,
      hover: Skin001ConversationHold,
      pressed: Skin001ConversationPress,
      selected: Skin001ConversationSel
    }
  },
  styles: {
    panelCharFrame: 'top-0 left-0 shadow-2xl',
    cardWrapper: 'rounded-bl-4xl',
    headerLogo: 'top-6 left-16 size-8',
    headerLogoDot: 'top-9.5 left-30',
    headerTitle: 'top-7 left-38 text-neutral-300/80'
  },
  decorations: {
    headerSpines: [
      {
        assetId: 'PhoneSyetem_TopPanel_Xin',
        animations: ['idle_L'],
        className: 'absolute top-0 -left-14 z-50 h-24 w-1/2'
      },
      {
        assetId: 'PhoneSyetem_TopPanel_Xin',
        animations: ['idle_R'],
        className: 'absolute top-0 left-2 z-50 h-26 w-1/2'
      }
    ],
    panelSpines: [
      {
        assetId: 'PhoneSyetem_TopBar_Xin',
        animations: ['idle'],
        className: 'absolute -top-19 right-44 z-20 h-46'
      }
    ],
    ornamentMount: { className: 'absolute -right-10 -bottom-17 z-50 h-60 w-60', scale: 1.1 }
  }
}

/**
 * @description 可选皮肤注册表，顺序即界面设置中的展示顺序。
 */
export const SKINS: readonly SkinCatalogEntry[] = [SKIN000, SKIN001]

/**
 * @description 默认皮肤标识，持久化值非法或缺失时回退。
 */
export const DEFAULT_SKIN_ID = SKIN000.id

/**
 * @description 解析可用的皮肤标识，非法或缺失时回退默认皮肤。
 * @param skinId 待解析的皮肤标识，允许为空或未知值。
 * @returns 可安全使用的皮肤标识。
 */
export function resolveSkinId(skinId: string | null | undefined): string {
  if (!skinId || !SKINS.some((skin) => skin.id === skinId)) {
    return DEFAULT_SKIN_ID
  }

  return skinId
}

/**
 * @description 按标识获取皮肤条目，未知标识回退基线皮肤。
 * @param skinId 皮肤标识。
 * @returns 匹配到的皮肤条目。
 */
export function getSkinById(skinId: string): SkinCatalogEntry {
  return SKINS.find((skin) => skin.id === skinId) ?? SKIN000
}

/**
 * @description 解析指定皮肤下某槽位应使用的素材。
 * @param skinId 皮肤标识，未知时使用基线皮肤。
 * @param slot 槽位键。
 * @returns 该槽位的素材；皮肤未提供该槽位时回退基线皮肤的同槽位素材。
 */
export function resolveSkinSlot<K extends SkinSlotKey>(skinId: string, slot: K): SkinSlotAssets[K] {
  const skin = SKINS.find((entry) => entry.id === skinId) ?? SKIN000
  return skin.slots[slot] ?? SKIN000.slots[slot]
}
