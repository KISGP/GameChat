/**
 * @description 设置契约统一出口：全部可持久化设置分区的类型单源。
 * @remarks 仅类型定义；归一函数与默认值常量在 @gamechat/schema 的 settings.ts 维护。
 */
import type { AgentPolicyToolPackageId } from './contract-ids'
import type { FlowSettingsStore } from './flow'

// ---------- Agent 设置分区 ----------

export type AgentSettingsStore = {
  enabledToolPackageIds: AgentPolicyToolPackageId[]
}

// ---------- 应用通用设置分区 ----------

/**
 * @description 聊天图片缩放预设的取值域。
 * @remarks 具体预设清单与排列顺序由 @gamechat/schema 的 CHAT_IMAGE_PRESETS 维护。
 */
export type ChatImagePreset = 'original' | 768 | 1024 | 1536 | 2048

export type AnimationPreference = 'system' | 'enabled' | 'disabled'
export type TtsProvider = 'local' | 'fish'
export type LocalTtsEngine = 'index-tts'

/**
 * @description GitHub 资源请求的一个来源。
 * @remarks baseUrl 为 gh-proxy 前缀方案地址（`https://<host>/<原始GitHub地址>`）；
 *   为 null 时表示 GitHub 直连，直连来源不可删除。
 */
export type GithubProxySource = {
  id: string
  label: string
  baseUrl: string | null
}

export type GithubProxySettings = {
  /** @description 按用户排序的来源链，请求时依序尝试直到成功。 */
  sources: GithubProxySource[]
}

export type ChatImageProcessingSettings = {
  enabled: boolean
  compression: { quality: number }
  resize: { preset: ChatImagePreset }
}

export type ChatSendMergeSettings = {
  enabled: boolean
  delaySeconds: number
}

/** 上下文预算设置：约束发给模型的输入上下文占模型窗口的比例上限。 */
export type ContextBudgetSettings = {
  /** 输入上下文可占模型窗口的比例；超出预算的历史与工具轨迹按预算截断。 */
  budgetRatio: number
}

/** 上下文压缩设置：控制历史的自动滚动摘要整理。 */
export type ContextCompressionSettings = {
  /** 自动静默压缩开关；关闭后仅会话命令手动触发压缩。 */
  enabled: boolean
  /** 后台整理模型条目标识；空串表示沿用会话最近一次使用的模型。 */
  modelId: string
}

export type LocalTtsProviderSettings = {
  engine: LocalTtsEngine
  engineConfigs: {
    indexTts: {
      baseUrl: string
    }
  }
}

export type FishTtsProviderSettings = {
  apiKey: string
  model: string
}

export type TraceSettings = {
  enabled: boolean
  baseUrl: string
  publicKey: string
  secretKey: string
}

export type TtsProviderSettings = {
  local: LocalTtsProviderSettings
  fish: FishTtsProviderSettings
}

export type TtsSettings = {
  enabled: boolean
  /** 开启后新完成的角色回复自动合成语音，并以语音气泡替代文字气泡。 */
  autoSpeak: boolean
  provider: TtsProvider
  providers: TtsProviderSettings
}

export type UpdateCheckSettings = {
  /** 启动后延迟自动检查应用新版本；关闭后仍可在设置页手动检查。 */
  autoCheck: boolean
  /** 用户在更新弹窗中忽略过的版本号；跨启动保留，避免重复弹出同一版本。 */
  dismissedVersion: string | null
}

export type AppSettings = {
  animationPreference: AnimationPreference
  trace: TraceSettings
  messageCollapseLineCount: number
  settingsSidebarExpanded: boolean
  /** 点击窗口关闭按钮时是否最小化到系统托盘；关闭该开关时点关闭按钮直接退出应用。 */
  closeToTray: boolean
  /**
   * 是否使用系统代理：开启后全部出站请求走 Chromium 网络栈（自动跟随系统代理与 PAC），
   * 关闭后全部直连。默认关闭（直连）；本地回环地址不受影响。
   */
  useSystemProxy: boolean
  githubProxy: GithubProxySettings
  update: UpdateCheckSettings
  chatImageProcessing: ChatImageProcessingSettings
  chatSendMerge: ChatSendMergeSettings
  contextBudget: ContextBudgetSettings
  contextCompression: ContextCompressionSettings
  tts: TtsSettings
}

// ---------- 角色设置分区 ----------

/**
 * @description 角色级 Fish Audio 音色覆盖配置。
 */
export type CharacterTtsSettings = {
  fish?: {
    referenceId: string
  }
}

/**
 * @description 保存在角色目录中的用户可编辑配置。
 */
export type CharacterSettings = {
  visible: boolean
  // 聊天页侧栏置顶标记；置顶角色浮在角色栏顶部。
  pinned: boolean
  tts: CharacterTtsSettings
}

// ---------- 记忆设置分区 ----------

export type MemorySettingsStore = {
  /** 记忆总开关；关闭时不抽取、不检索、设置页不展示条目。 */
  enabled: boolean
}

// ---------- 模型与供应商分区 ----------

export type ApiFormat = 'anthropic' | 'chat-completions'

export type ReasoningEffort = 'auto' | 'low' | 'medium' | 'high'

export type GenerationParams = {
  temperature: number
  reasoningEffort: ReasoningEffort
}

/** 生成参数字段标识，取值为 GenerationParams 的字段名。 */
export type GenerationParamField = keyof GenerationParams

/**
 * 模型级参数覆盖：字段缺省表示继承供应商默认值。
 * temperature 取 null 表示显式不向 API 发送该参数（供拒绝自定义温度的模型使用），与缺省的继承语义相区别。
 */
export type ModelParamOverrides = {
  temperature?: number | null
  reasoningEffort?: ReasoningEffort
}

export type ProviderModel = {
  id: string
  model: string
  supportsImages: boolean
  /** 模型一次请求可容纳的总上下文容量；未配置时缺省，不参与模型调用。 */
  contextWindow?: number
  /** 模型单次回复的最大输出 token 数；仅 Anthropic 接入格式下发，未配置时由模型客户端按模型自行取默认。 */
  maxTokens?: number
  paramOverrides?: ModelParamOverrides
}

export type ModelCatalog = {
  models: string[]
  fetchedAt: string
  apiFormat: ApiFormat
  baseUrl: string
  apiKeyFingerprint: string
}

export type ModelProvider = {
  id: string
  name: string
  apiFormat: ApiFormat
  baseUrl: string
  apiKey: string
  defaultParams: GenerationParams
  models: ProviderModel[]
  modelCatalog?: ModelCatalog
}

export type ProviderStore = {
  providers: ModelProvider[]
}

/** 运行时模型配置：供应商连接信息与模型条目参数合并后的最终生效视图。 */
export type ResolvedModelConfig = {
  providerId: string
  modelId: string
  apiFormat: ApiFormat
  baseUrl: string
  apiKey: string
  model: string
  supportsImages: boolean
  /**
   * 生效生成温度；null 表示不向 API 发送该参数。
   * @remarks 仅 chat-completions 格式可能为 null（模型级显式省略）；Anthropic 格式的客户端一律不发送温度。
   */
  temperature: number | null
  /** 模型上下文窗口容量；来源条目未配置时缺省。 */
  contextWindow?: number
  /** 模型单次回复最大输出 token 数；来源条目未配置时缺省，仅 Anthropic 分支下发。 */
  maxTokens?: number
  reasoningEffort: ReasoningEffort
}

export type ProviderConnectionTestRequest = {
  requestId: string
  provider: ModelProvider
}

export type ProviderConnectionTestResult = {
  ok: boolean
  message: string
  models?: string[]
  latencyMs?: number
  modelCatalog?: ModelCatalog
}

// ---------- 统一设置聚合 ----------

export type AppearanceSettings = {
  backgroundId: string
  skinId: string
  // 聊天面板摆件标识，空字符串表示未选中任何摆件
  ornamentId: string
  // 用户消息气泡样式标识，'default' 表示默认 CSS 气泡
  bubbleId: string
}

export type UnifiedSettings = {
  app: AppSettings
  providers: ProviderStore
  memory: MemorySettingsStore
  agent: AgentSettingsStore
  appearance: AppearanceSettings
  flows: FlowSettingsStore
}
