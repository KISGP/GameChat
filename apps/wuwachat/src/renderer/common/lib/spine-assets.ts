import topBarAtlasUrl from '@renderer/assets/spine/PhoneSyetem_TopBar_Xin/PhoneSyetem_TopBar_Xin.atlas?url&no-inline'
import topBarSkelUrl from '@renderer/assets/spine/PhoneSyetem_TopBar_Xin/PhoneSyetem_TopBar_Xin.skel?url&no-inline'
import topBarPngUrl from '@renderer/assets/spine/PhoneSyetem_TopBar_Xin/PhoneSyetem_TopBar_Xin.png?url&no-inline'
import topPanelAtlasUrl from '@renderer/assets/spine/PhoneSyetem_TopPanel_Xin/PhoneSyetem_TopPanel_Xin.atlas?url&no-inline'
import topPanelSkelUrl from '@renderer/assets/spine/PhoneSyetem_TopPanel_Xin/PhoneSyetem_TopPanel_Xin.skel?url&no-inline'
import topPanelPngUrl from '@renderer/assets/spine/PhoneSyetem_TopPanel_Xin/PhoneSyetem_TopPanel_Xin.png?url&no-inline'
import xinYueHuAtlasUrl from '@renderer/assets/spine/PhoneSystem_XinYueHu/PhoneSystem_XinYueHu.atlas?url&no-inline'
import xinYueHuSkelUrl from '@renderer/assets/spine/PhoneSystem_XinYueHu/PhoneSystem_XinYueHu.skel?url&no-inline'
import xinYueHuPngUrl from '@renderer/assets/spine/PhoneSystem_XinYueHu/PhoneSystem_XinYueHu.png?url&no-inline'
import chatBg002AtlasUrl from '@renderer/assets/spine/UiItem_PhoneChatBg002/UiItem_PhoneChatBg002.atlas?url&no-inline'
import chatBg002SkelUrl from '@renderer/assets/spine/UiItem_PhoneChatBg002/UiItem_PhoneChatBg002.skel?url&no-inline'
import chatBg002PngUrl from '@renderer/assets/spine/UiItem_PhoneChatBg002/UiItem_PhoneChatBg002.png?url&no-inline'
import chatBg003AtlasUrl from '@renderer/assets/spine/UiItem_PhoneChatBg003/UiItem_PhoneChatBg003.atlas?url&no-inline'
import chatBg003SkelUrl from '@renderer/assets/spine/UiItem_PhoneChatBg003/UiItem_PhoneChatBg003.skel?url&no-inline'
import chatBg003PngUrl from '@renderer/assets/spine/UiItem_PhoneChatBg003/UiItem_PhoneChatBg003.png?url&no-inline'
import chatRightAtlasUrl from '@renderer/assets/spine/PhoneSystemChatRight/PhoneSystemChatRight.atlas?url&no-inline'
import chatRightSkelUrl from '@renderer/assets/spine/PhoneSystemChatRight/PhoneSystemChatRight.skel?url&no-inline'
import chatRightPngUrl from '@renderer/assets/spine/PhoneSystemChatRight/PhoneSystemChatRight.png?url&no-inline'

/**
 * @description 描述一套随应用分发的 Spine 动画三件套资源。
 */
export type SpineAssetEntry = {
  // atlas 文本的构建产物 URL
  atlasUrl: string
  // 骨架二进制的构建产物 URL
  skelUrl: string
  // atlas 首行声明的页面纹理名
  pageName: string
  // 页面纹理的构建产物 URL（文件名带 hash，与 atlas 内声明的原名不同）
  pngUrl: string
}

/**
 * @description 随应用分发的 Spine 资产清单，键为资产名（与游戏内资产名一致）。
 * @remarks 页面纹理 URL 与 atlas 内声明的原名不同，加载时须经 fileAlias 映射。
 */
const SPINE_ASSET_MAP = {
  PhoneSyetem_TopBar_Xin: {
    atlasUrl: topBarAtlasUrl,
    skelUrl: topBarSkelUrl,
    pageName: 'PhoneSyetem_TopBar_Xin.png',
    pngUrl: topBarPngUrl
  },
  PhoneSyetem_TopPanel_Xin: {
    atlasUrl: topPanelAtlasUrl,
    skelUrl: topPanelSkelUrl,
    pageName: 'PhoneSyetem_TopPanel_Xin.png',
    pngUrl: topPanelPngUrl
  },
  PhoneSystem_XinYueHu: {
    atlasUrl: xinYueHuAtlasUrl,
    skelUrl: xinYueHuSkelUrl,
    pageName: 'PhoneSystem_XinYueHu.png',
    pngUrl: xinYueHuPngUrl
  },
  UiItem_PhoneChatBg002: {
    atlasUrl: chatBg002AtlasUrl,
    skelUrl: chatBg002SkelUrl,
    pageName: 'UiItem_PhoneChatBg002.png',
    pngUrl: chatBg002PngUrl
  },
  UiItem_PhoneChatBg003: {
    atlasUrl: chatBg003AtlasUrl,
    skelUrl: chatBg003SkelUrl,
    pageName: 'UiItem_PhoneChatBg003.png',
    pngUrl: chatBg003PngUrl
  },
  PhoneSystemChatRight: {
    atlasUrl: chatRightAtlasUrl,
    skelUrl: chatRightSkelUrl,
    pageName: 'PhoneSystemChatRight.png',
    pngUrl: chatRightPngUrl
  }
} as const satisfies Record<string, SpineAssetEntry>

/**
 * @description 可用的 Spine 资产标识。
 */
export type SpineAssetId = keyof typeof SPINE_ASSET_MAP

/**
 * @description 随应用分发的 Spine 资产清单。
 */
export const SPINE_ASSETS: Readonly<Record<SpineAssetId, SpineAssetEntry>> = SPINE_ASSET_MAP
