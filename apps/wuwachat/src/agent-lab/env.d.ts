/**
 * @description 编排窗口渲染层的样式导入声明。
 * @remarks Window 全局（flows/agentLab）的类型在 @gamechat/electron 的 preload 类型声明中单源维护，
 *   两个窗口共用同一份 preload 桥，不在此重复声明。
 */

/** 样式表导入声明：xyflow 的画布样式以副作用 import 引入。 */
declare module '*.css'

export {}
