import { getAppDataRoot } from '../utils/path'
import {
  getWorldIndexPath as getWorldIndexPathFromCore,
  getWorldRoot as getWorldRootFromCore
} from '@gamechat/core'

/**
 * @description 返回 World 资料根目录。
 * @returns World 资料的应用数据目录。
 * @remarks 目录布局与 core 同步引擎共用同一实现，本函数只固定应用数据根目录。
 */
export function getWorldRoot(): string {
  return getWorldRootFromCore(getAppDataRoot())
}

/**
 * @description 返回 World 全库派生索引文件路径。
 * @returns world.json 的绝对路径。
 */
export function getWorldIndexPath(): string {
  return getWorldIndexPathFromCore(getAppDataRoot())
}
