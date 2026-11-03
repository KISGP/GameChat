/**
 * @description 角色域统一出口：媒体协议路径解析、路径布局、类型、本地角色服务、远端链与同步编排。
 */
export {
  resolveCharacterMediaPath,
  resolveChatAttachmentMediaPath
} from './media'
export {
  getCharactersRoot,
  getCharacterDirectoryPath,
  getCharacterInfoPath,
  getCharacterPromptPath,
  getCharacterEmoticonsRoot,
  getCharacterSettingsPath,
  TTS_VOICE_FILE_NAME
} from './paths'
export {
  normalizeLocalCharacterInfo,
  type CharacterLocalizedText,
  type CharacterTtsChannels,
  type CharacterVoiceLine,
  type LocalCharacterInfo,
  type LocalCharacterRecord,
  type RemoteCharacterRecord,
  type QueueRuntimeState
} from './types'
export { normalizeCharacterVersion, pickDisplayText } from './mappers'
export { validateEmoticonDefinitions, normalizeEmoticonFile, resolveEmoticonPath } from './emoticons'
export { buildRegistry } from './registry'
export {
  createCharacterService,
  type CharacterService,
  type CharacterServiceDeps,
  type CharacterEntry,
  type CharacterCreateInput
} from './service'
export {
  createCharacterStorage,
  createDefaultCharacterSettings,
  type CharacterStorage,
  type CharacterStorageDeps
} from './local/storage'
export {
  fetchRemoteIndex,
  fetchRemoteBuffer,
  getRemoteCharacterResourceUrl,
  type RemoteClientDeps,
  type RemoteIndexDocument
} from './remote/client'
export {
  createRemoteIndexCache,
  type RemoteIndexCache,
  type RemoteCacheDeps,
  type RemoteCharacterCacheDocument
} from './remote/cache'
export { parseCharacterIndex } from './remote/parser'
export {
  createCharacterSyncService,
  type CharacterSyncService,
  type CharacterSyncDeps,
  type CharacterSyncLocalDeps
} from './sync/service'
export {
  createLocalCharacterInfo,
  writeCharacterFiles,
  type RemoteCharacterBundle
} from './sync/writer'
