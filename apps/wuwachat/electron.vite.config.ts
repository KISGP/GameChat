import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

/** 必须打进产物的工作区包：@gamechat 系是 TS 源码形态（main 指向 src），运行时无法 require。 */
const BUNDLE_PACKAGES = [
  '@gamechat/core',
  '@gamechat/electron',
  '@gamechat/schema',
  '@gamechat/type'
] as const

/**
 * 必须保持运行时 require 的开发态依赖：Langfuse 与 OpenTelemetry SDK 位于 devDependencies，
 * 打包版不含这些包，打进产物会直接拖垮启动，因此构建期必须外置。
 */
const TRACE_EXTERNAL_PACKAGES = [
  '@langfuse/core',
  '@langfuse/langchain',
  '@langfuse/otel',
  '@langfuse/tracing',
  '@opentelemetry/sdk-node'
] as const

/** 以配置文件所在目录为基准解析绝对路径。 */
const fromRoot = (relativePath: string): string =>
  fileURLToPath(new URL(relativePath, import.meta.url))

/**
 * @description 相对与绝对路径始终随构建打包；@gamechat 系工作区包打包；
 *   其余裸导入（electron、node 内建、LangChain 系、sharp 等）外置，运行时经提升的 node_modules 解析。
 * @param id 模块说明符。
 * @returns 外置时返回 true。
 */
function externalize(id: string): boolean {
  if (id.startsWith('.') || id.startsWith('/') || /^[A-Za-z]:/.test(id)) {
    return false
  }
  return !BUNDLE_PACKAGES.some((pkg) => id === pkg || id.startsWith(`${pkg}/`))
}

/**
 * @description 按构建形态装配 electron-vite 配置。
 * @returns electron-vite 配置对象。
 * @remarks Agent 调度台的 preload 与 renderer 独立入口随主构建一并装配，打包版经打包态
 *   loadFile 分支加载同目录的 agent-lab 页面。
 */
export default defineConfig(() => {
  const preloadInput: Record<string, string> = {
    index: fromRoot('./src/preload/index.ts')
  }
  const rendererInput: Record<string, string> = {
    index: fromRoot('./src/renderer/index.html'),
    'agent-lab': fromRoot('./src/agent-lab/index.html')
  }
  const sharedAlias = {
    '@gamechat/electron/shared': fromRoot('../../packages/electron/src/shared'),
    '@gamechat/electron/preload': fromRoot('../../packages/electron/src/preload/index.ts'),
    '@gamechat/core': fromRoot('../../packages/core/src'),
    '@gamechat/schema': fromRoot('../../packages/schema/src/index.ts'),
    '@gamechat/type': fromRoot('../../packages/type/src/index.ts')
  }
  return {
    main: {
      resolve: { alias: sharedAlias },
      build: {
        externalizeDeps: {
          exclude: [...BUNDLE_PACKAGES],
          include: [...TRACE_EXTERNAL_PACKAGES]
        },
        rollupOptions: {
          input: { index: fromRoot('./src/main/index.ts') },
          external: externalize
        }
      }
    },
    preload: {
      resolve: { alias: sharedAlias },
      build: {
        externalizeDeps: {
          exclude: [...BUNDLE_PACKAGES],
          include: [...TRACE_EXTERNAL_PACKAGES]
        },
        rollupOptions: {
          input: preloadInput,
          output: { entryFileNames: '[name].js' }
        }
      }
    },
    renderer: {
      // 渲染层根取应用 src：renderer/ 与 agent-lab/ 两个入口平级同根；
      // 生产产物因此落在 out/renderer/renderer/index.html 与 out/renderer/agent-lab/index.html。
      root: fromRoot('./src'),
      resolve: {
        alias: {
          ...sharedAlias,
          '@renderer': fromRoot('./src/renderer')
        }
      },
      plugins: [react(), tailwindcss()],
      build: {
        rollupOptions: {
          input: rendererInput
        }
      }
    }
  }
})
