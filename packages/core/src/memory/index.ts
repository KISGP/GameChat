/**
 * @description 记忆域统一出口：长期记忆服务与路径布局。
 */
export {
  createMemoryService,
  type MemoryService,
  type MemoryServiceDeps
} from './service'
export {
  getMemoryRoot,
  getCharacterMemoryFilePath,
  getMemoryVersionsRoot
} from './paths'
