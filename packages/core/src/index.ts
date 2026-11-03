/**
 * @description core 根出口：跨域消费方一律经本门面导入，域内布局不对外承诺。
 * @remarks 各域自带 index.ts 门面，根出口只做转发，不新增逻辑；
 *   具体域目录见仓库 AGENTS.md 的「core 域版图」。
 */
export * from './adapters'
export * from './infra'
export * from './chat'
export * from './tools'
export * from './characters'
export * from './memory'
export { UnifiedSettingsStore, type SettingsEngineDeps } from './settings/store'
export {
  normalizeUnifiedSettings,
  normalizeAgentSettingsStore,
  createDefaultUnifiedSettings
} from './settings/normalize'
export { WorldSearchService, type WorldSearchResult } from './world/search'
export {
  createWorldSyncService,
  getWorldRoot,
  getWorldIndexPath,
  type WorldSyncService,
  type WorldSyncDeps,
  type WorldSyncStatus,
  type WorldSyncResult,
  type WorldManifest
} from './world/sync'
export {
  loadWorldIndexFile,
  type WorldIndexFile,
  type WorldIndexScene,
  type WorldIndexTerm
} from './world/world-index'
export {
  createFlowPackageStore,
  type FlowPackageStore,
  type FlowPackageStoreDeps
} from './flows/store'
