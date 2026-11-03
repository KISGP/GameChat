import { join } from 'path'

export const PRELOAD_PATH = join(__dirname, '../preload/index.js')
// 渲染层构建根为应用 src，主窗口入口相对根位于 renderer/ 子目录，产物路径因此为 out/renderer/renderer/index.html。
export const RENDERER_HTML = join(__dirname, '../renderer/renderer/index.html')
