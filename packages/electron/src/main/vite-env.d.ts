/// <reference types="vite/client" />

/**
 * @description 声明 Vite 资源导入（`?asset`）的模块类型，供主进程常量文件引用打包资源路径。
 */
declare module '*?asset' {
  /** @description 资源经打包后的最终路径。 */
  const src: string
  export default src
}
