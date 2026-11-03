import { join } from 'path'
import { app } from 'electron'

/**
 * @description 返回应用资源根目录。
 * @returns 打包版资源目录或开发版应用目录。
 */
export function getAppPath(): string {
  return app.isPackaged ? process.resourcesPath : app.getAppPath()
}

/**
 * @description 返回应用内置打包资源根目录。
 * @returns 打包资源中的 resources 根目录。
 */
export function getBundledResourcesRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'resources')
    : join(app.getAppPath(), 'resources')
}

/**
 * @description 解析内置资源根下的一个资源路径。
 * @param relativePath 相对 resources 根的资源路径（如窗口/托盘图标）。
 * @returns 资源的绝对路径。
 * @remarks 应用在启动配置中以相对路径声明图标等资源，打包时 resources 需经 asarUnpack 保持可读。
 */
export function getBundledResourcePath(relativePath: string): string {
  return join(getBundledResourcesRoot(), relativePath)
}

/**
 * @description 返回应用内置聊天表情资源目录。
 * @returns 打包资源中的聊天表情根目录。
 */
export function getBundledEmoticonsRoot(): string {
  return join(getBundledResourcesRoot(), 'emoticons')
}

/**
 * @description 返回应用数据根目录，各域目录布局由各域自持的 paths.ts 定义。
 * @returns 应用数据根目录。
 */
export function getAppDataRoot(): string {
  return join(app.getPath('userData'), 'app-data')
}
