/**
 * @description 设置默认值、规范化工厂与选项清单：全部可持久化设置分区的可执行词汇。
 * @remarks 引用的类型定义在 @gamechat/type；本文件不含类型声明，避免与类型合同交叉。
 */
import type {
  AgentPolicyToolPackageId,
  AgentSettingsStore,
  AnimationPreference,
  ApiFormat,
  AppSettings,
  ChatImagePreset,
  ChatImageProcessingSettings,
  ChatSendMergeSettings,
  ContextBudgetSettings,
  ContextCompressionSettings,
  GenerationParamField,
  GenerationParams,
  GithubProxySettings,
  GithubProxySource,
  MemorySettingsStore,
  ModelCatalog,
  ModelParamOverrides,
  ModelProvider,
  ProviderModel,
  ProviderStore,
  ReasoningEffort,
  TraceSettings,
  TtsSettings,
  UpdateCheckSettings,
} from "@gamechat/type";

// ---------- Agent 设置分区 ----------

/**
 * @description 默认启用的策略工具包标识清单。
 */
export const DEFAULT_ENABLED_TOOL_PACKAGE_IDS: AgentPolicyToolPackageId[] = [
  "world",
  "datetime",
];

/**
 * @description 创建聊天 Agent 的默认工具策略设置。
 * @returns 默认启用 World 背景资料和时间工具的设置。
 */
export function createDefaultAgentSettingsStore(): AgentSettingsStore {
  return {
    enabledToolPackageIds: [...DEFAULT_ENABLED_TOOL_PACKAGE_IDS],
  };
}

// ---------- 应用通用设置分区 ----------

/**
 * @description 消息折叠行数的下限。
 */
export const MIN_MESSAGE_COLLAPSE_LINE_COUNT = 1;

/**
 * @description 消息折叠行数的上限。
 */
export const MAX_MESSAGE_COLLAPSE_LINE_COUNT = 20;

/**
 * @description 消息折叠行数的默认值。
 */
export const DEFAULT_MESSAGE_COLLAPSE_LINE_COUNT = 5;

/**
 * @description Fish Audio 语音合成的默认模型标识。
 */
export const DEFAULT_FISH_TTS_MODEL = "s2.1-pro-free";

/**
 * @description 本地 index-tts 引擎的默认服务地址。
 */
export const DEFAULT_INDEX_TTS_BASE_URL = "http://127.0.0.1:7860";

/**
 * @description 聊天图片压缩质量的下限。
 */
export const CHAT_IMAGE_QUALITY_MIN = 60;

/**
 * @description 聊天图片压缩质量的上限。
 */
export const CHAT_IMAGE_QUALITY_MAX = 100;

/**
 * @description 聊天图片压缩质量的默认值。
 */
export const CHAT_IMAGE_QUALITY_DEFAULT = 85;

/**
 * @description 聊天图片缩放预设清单，按原图优先、长边分辨率递增排列。
 */
export const CHAT_IMAGE_PRESETS: readonly ChatImagePreset[] = [
  "original",
  768,
  1024,
  1536,
  2048,
];

/**
 * @description 内置「GitHub 直连」来源的固定 ID。
 */
export const GITHUB_DIRECT_SOURCE_ID = "direct";

/**
 * @description 内置 GitHub 来源，默认顺序为三个代理在前、直连垫底。
 */
export const BUILTIN_GITHUB_PROXY_SOURCES: readonly GithubProxySource[] = [
  { id: GITHUB_DIRECT_SOURCE_ID, label: "GitHub 直连", baseUrl: null },
  { id: "source-1", label: "gh-proxy.org", baseUrl: "https://gh-proxy.org" },
  {
    id: "source-2",
    label: "v4.gh-proxy.org",
    baseUrl: "https://v4.gh-proxy.org",
  },
  {
    id: "source-3",
    label: "v6.gh-proxy.org",
    baseUrl: "https://v6.gh-proxy.org",
  },
];

/**
 * @description 连续消息合并发送的默认延迟秒数。
 */
export const CHAT_SEND_MERGE_DELAY_SECONDS_DEFAULT = 5;

/**
 * @description 上下文预算比例的下限。
 */
export const CONTEXT_BUDGET_RATIO_MIN = 0.5;

/**
 * @description 上下文预算比例的上限。
 */
export const CONTEXT_BUDGET_RATIO_MAX = 0.95;

/**
 * @description 上下文预算比例的默认值。
 */
export const CONTEXT_BUDGET_RATIO_DEFAULT = 0.8;

/**
 * @description Langfuse 云端追踪服务的默认地址。
 */
export const DEFAULT_TRACE_BASE_URL = "https://cloud.langfuse.com";

/**
 * @description 将未知值规范化为去除首尾空白的字符串，并在无效时使用默认值。
 * @param value 待规范化的值。
 * @param fallback 值无效时使用的默认字符串。
 * @returns 可安全写入设置的字符串。
 */
function normalizeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

/**
 * @description 规范化 index-tts 服务地址，只接受 HTTP(S) 绝对地址。
 * @param value 待规范化的服务地址。
 * @returns 可供本地引擎使用的服务地址。
 */
function normalizeIndexTtsBaseUrl(value: unknown): string {
  const candidate = normalizeString(value, DEFAULT_INDEX_TTS_BASE_URL);
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return DEFAULT_INDEX_TTS_BASE_URL;
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_INDEX_TTS_BASE_URL;
  }
}

/**
 * @description 规范化追踪服务地址，只接受 HTTP(S) 绝对地址。
 * @param value 待规范化的服务地址。
 * @returns 可供 Langfuse SDK 使用的服务地址。
 */
function normalizeTraceBaseUrl(value: unknown): string {
  const candidate = normalizeString(value, DEFAULT_TRACE_BASE_URL);
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return DEFAULT_TRACE_BASE_URL;
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_TRACE_BASE_URL;
  }
}

/**
 * @description 规范化 GitHub 来源链：逐条校验来源形状、按 ID 去重，并保证直连来源恰好存在一个。
 * @param raw 待规范化的原始值。
 * @returns 规范化后的来源链；原始值不是数组时返回内置默认链。
 * @remarks 直连来源缺失时追加到链尾，重复时保留第一个；自定义地址去除尾斜杠，
 *   非法地址的来源整条丢弃。
 */
function normalizeGithubProxySources(raw: unknown): GithubProxySource[] {
  const rawList = Array.isArray(raw) ? raw : null;
  if (!rawList) {
    return [...BUILTIN_GITHUB_PROXY_SOURCES];
  }
  const sources: GithubProxySource[] = [];
  const seenIds = new Set<string>();
  for (const item of rawList) {
    const record =
      typeof item === "object" && item !== null
        ? (item as Record<string, unknown>)
        : null;
    const id = typeof record?.id === "string" ? record.id.trim() : "";
    if (!id || seenIds.has(id)) {
      continue;
    }
    let baseUrl: string | null = null;
    if (record?.baseUrl !== null && record?.baseUrl !== undefined) {
      if (typeof record.baseUrl !== "string" || !record.baseUrl.trim()) {
        continue;
      }
      try {
        const parsed = new URL(record.baseUrl.trim());
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          continue;
        }
        baseUrl = parsed.toString().replace(/\/+$/, "");
      } catch {
        continue;
      }
    }
    const fallbackLabel = baseUrl ? new URL(baseUrl).hostname : "GitHub 直连";
    const label =
      typeof record?.label === "string" && record.label.trim()
        ? record.label.trim()
        : fallbackLabel;
    seenIds.add(id);
    sources.push({ id, label, baseUrl });
  }
  if (!sources.some((source) => source.id === GITHUB_DIRECT_SOURCE_ID)) {
    const direct = BUILTIN_GITHUB_PROXY_SOURCES.find(
      (source) => source.id === GITHUB_DIRECT_SOURCE_ID,
    );
    if (direct) {
      sources.push({ ...direct });
    }
  }
  return sources;
}

/**
 * @description 创建应用通用设置的默认值。
 * @returns 默认的应用通用设置。
 */
export function createDefaultAppSettings(): AppSettings {
  return {
    animationPreference: "system",
    trace: {
      enabled: false,
      baseUrl: DEFAULT_TRACE_BASE_URL,
      publicKey: "",
      secretKey: "",
    },
    messageCollapseLineCount: DEFAULT_MESSAGE_COLLAPSE_LINE_COUNT,
    settingsSidebarExpanded: true,
    closeToTray: true,
    useSystemProxy: false,
    githubProxy: {
      sources: [...BUILTIN_GITHUB_PROXY_SOURCES],
    },
    update: {
      autoCheck: true,
      dismissedVersion: null,
    },
    chatImageProcessing: {
      enabled: true,
      compression: { quality: CHAT_IMAGE_QUALITY_DEFAULT },
      resize: { preset: "original" },
    },
    chatSendMerge: {
      enabled: false,
      delaySeconds: CHAT_SEND_MERGE_DELAY_SECONDS_DEFAULT,
    },
    contextBudget: { budgetRatio: CONTEXT_BUDGET_RATIO_DEFAULT },
    contextCompression: {
      enabled: true,
      modelId: "",
    },
    tts: {
      enabled: false,
      autoSpeak: false,
      provider: "local",
      providers: {
        local: {
          engine: "index-tts",
          engineConfigs: {
            indexTts: { baseUrl: DEFAULT_INDEX_TTS_BASE_URL },
          },
        },
        fish: { apiKey: "", model: DEFAULT_FISH_TTS_MODEL },
      },
    },
  };
}

/**
 * @description 规范化从持久化存储读取的应用通用设置。
 * @param value 待规范化的原始设置值。
 * @returns 可安全供应用使用的通用设置。
 */
export function normalizeAppSettings(value: unknown): AppSettings {
  const defaults = createDefaultAppSettings();

  if (!value || typeof value !== "object") {
    return defaults;
  }

  const raw = value as Partial<AppSettings>;
  const animationPreference: AnimationPreference =
    raw.animationPreference === "enabled" ||
    raw.animationPreference === "disabled"
      ? raw.animationPreference
      : "system";
  const rawTrace = raw.trace as Partial<TraceSettings> | undefined;
  const messageCollapseLineCount =
    typeof raw.messageCollapseLineCount === "number" &&
    Number.isInteger(raw.messageCollapseLineCount)
      ? Math.min(
          MAX_MESSAGE_COLLAPSE_LINE_COUNT,
          Math.max(
            MIN_MESSAGE_COLLAPSE_LINE_COUNT,
            raw.messageCollapseLineCount,
          ),
        )
      : DEFAULT_MESSAGE_COLLAPSE_LINE_COUNT;
  const settingsSidebarExpanded = raw.settingsSidebarExpanded !== false;
  const closeToTray = raw.closeToTray !== false;
  const useSystemProxy = raw.useSystemProxy === true;
  const rawTts = raw.tts as Partial<TtsSettings> | undefined;
  const rawGithubProxy = raw.githubProxy as
    | Partial<GithubProxySettings>
    | undefined;
  const rawUpdate = raw.update as Partial<UpdateCheckSettings> | undefined;
  const rawImageProcessing = raw.chatImageProcessing as
    | Partial<ChatImageProcessingSettings>
    | undefined;
  const rawSendMerge = raw.chatSendMerge as
    | Partial<ChatSendMergeSettings>
    | undefined;
  const rawContextBudget = raw.contextBudget as
    | Partial<ContextBudgetSettings>
    | undefined;
  const rawContextCompression = raw.contextCompression as
    | Partial<ContextCompressionSettings>
    | undefined;
  const rawCompression = rawImageProcessing?.compression;
  const rawResize = rawImageProcessing?.resize;
  const quality =
    typeof rawCompression?.quality === "number" &&
    Number.isFinite(rawCompression.quality)
      ? Math.round(
          Math.min(
            CHAT_IMAGE_QUALITY_MAX,
            Math.max(CHAT_IMAGE_QUALITY_MIN, rawCompression.quality),
          ),
        )
      : CHAT_IMAGE_QUALITY_DEFAULT;
  const preset = CHAT_IMAGE_PRESETS.includes(
    rawResize?.preset as ChatImagePreset,
  )
    ? (rawResize?.preset as ChatImagePreset)
    : "original";
  const rawProviders = rawTts?.providers;
  const rawLocal = rawProviders?.local;
  const rawFish = rawProviders?.fish;

  return {
    animationPreference,
    trace: {
      enabled: rawTrace?.enabled === true,
      baseUrl: normalizeTraceBaseUrl(rawTrace?.baseUrl),
      publicKey:
        typeof rawTrace?.publicKey === "string"
          ? rawTrace.publicKey.trim()
          : "",
      secretKey:
        typeof rawTrace?.secretKey === "string"
          ? rawTrace.secretKey.trim()
          : "",
    },
    messageCollapseLineCount,
    settingsSidebarExpanded,
    closeToTray,
    useSystemProxy,
    githubProxy: {
      sources: normalizeGithubProxySources(rawGithubProxy?.sources),
    },
    update: {
      autoCheck: rawUpdate?.autoCheck !== false,
      dismissedVersion:
        typeof rawUpdate?.dismissedVersion === "string" &&
        rawUpdate.dismissedVersion.trim()
          ? rawUpdate.dismissedVersion.trim()
          : null,
    },
    chatImageProcessing: {
      enabled: rawImageProcessing?.enabled !== false,
      compression: { quality },
      resize: { preset },
    },
    chatSendMerge: {
      enabled: rawSendMerge?.enabled === true,
      delaySeconds:
        typeof rawSendMerge?.delaySeconds === "number" &&
        Number.isFinite(rawSendMerge.delaySeconds)
          ? rawSendMerge.delaySeconds
          : CHAT_SEND_MERGE_DELAY_SECONDS_DEFAULT,
    },
    contextBudget: {
      budgetRatio:
        typeof rawContextBudget?.budgetRatio === "number" &&
        Number.isFinite(rawContextBudget.budgetRatio)
          ? Math.min(
              CONTEXT_BUDGET_RATIO_MAX,
              Math.max(CONTEXT_BUDGET_RATIO_MIN, rawContextBudget.budgetRatio),
            )
          : CONTEXT_BUDGET_RATIO_DEFAULT,
    },
    contextCompression: {
      enabled: rawContextCompression?.enabled !== false,
      modelId:
        typeof rawContextCompression?.modelId === "string"
          ? rawContextCompression.modelId.trim()
          : "",
    },
    tts: {
      enabled: rawTts?.enabled === true,
      autoSpeak: rawTts?.autoSpeak === true,
      provider: rawTts?.provider === "fish" ? "fish" : "local",
      providers: {
        local: {
          engine: "index-tts",
          engineConfigs: {
            indexTts: {
              baseUrl: normalizeIndexTtsBaseUrl(
                rawLocal?.engineConfigs?.indexTts?.baseUrl,
              ),
            },
          },
        },
        fish: {
          apiKey: typeof rawFish?.apiKey === "string" ? rawFish.apiKey.trim() : "",
          model: normalizeString(rawFish?.model, DEFAULT_FISH_TTS_MODEL),
        },
      },
    },
  };
}

// ---------- 记忆设置分区 ----------

/**
 * @description 创建角色长期记忆的默认设置。
 * @returns 默认开启记忆的设置快照。
 */
export function createDefaultMemorySettingsStore(): MemorySettingsStore {
  return {
    enabled: true,
  };
}

/**
 * @description 规范化持久化的长期记忆设置。
 * @param value 未受信任的持久化设置。
 * @returns 可安全供运行时使用的记忆设置。
 */
export function normalizeMemorySettingsStore(
  value: unknown,
): MemorySettingsStore {
  const defaults = createDefaultMemorySettingsStore();
  if (!value || typeof value !== "object") {
    return defaults;
  }

  const raw = value as Partial<MemorySettingsStore>;
  const enabled =
    typeof raw.enabled === "boolean" ? raw.enabled : defaults.enabled;
  return { enabled };
}

// ---------- 模型与供应商分区 ----------

/**
 * @description 全部支持的接入格式。
 */
const API_FORMATS: ApiFormat[] = ["anthropic", "chat-completions"];

/**
 * @description 各接入格式的界面展示名。
 */
export const API_FORMAT_LABELS: Record<ApiFormat, string> = {
  anthropic: "Anthropic Messages",
  "chat-completions": "Chat Completions",
};

/**
 * @description 接入格式下拉选项清单，供设置界面渲染。
 */
export const API_FORMAT_OPTIONS: ReadonlyArray<{
  value: ApiFormat;
  label: string;
}> = [
  { value: "anthropic", label: "Anthropic Messages (/v1/messages)" },
  { value: "chat-completions", label: "Chat Completions (/chat/completions)" },
];

/**
 * @description 新建供应商的默认接入格式。
 */
const DEFAULT_API_FORMAT: ApiFormat = "chat-completions";

/**
 * @description 全部合法的思考等级取值。
 */
const REASONING_EFFORTS: ReasoningEffort[] = ["auto", "low", "medium", "high"];

/**
 * @description 思考等级下拉选项清单，供设置界面渲染。
 */
export const REASONING_EFFORT_OPTIONS: ReadonlyArray<{
  value: ReasoningEffort;
  label: string;
}> = [
  { value: "auto", label: "自动" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];

/**
 * @description 新建供应商与参数覆盖缺失字段的默认生成参数。
 */
const DEFAULT_GENERATION_PARAMS: GenerationParams = {
  temperature: 0.7,
  reasoningEffort: "auto",
};

/**
 * @description 各生成参数字段对接入格式的适用清单；仅清单内格式下字段有实际效果。
 */
const MODEL_PARAM_FIELD_FORMATS: ReadonlyArray<{
  field: GenerationParamField;
  apiFormats: readonly ApiFormat[];
}> = [
  { field: "temperature", apiFormats: ["chat-completions"] },
  { field: "reasoningEffort", apiFormats: ["chat-completions"] },
];

/**
 * @description 列出指定接入格式下有实际效果的生成参数字段。
 * @param apiFormat 接入格式。
 * @returns 生效字段标识清单，按清单声明顺序排列。
 */
export function getApplicableGenerationParamFields(
  apiFormat: ApiFormat,
): GenerationParamField[] {
  return MODEL_PARAM_FIELD_FORMATS.filter((entry) =>
    entry.apiFormats.includes(apiFormat),
  ).map((entry) => entry.field);
}

/**
 * @description 新建供应商的默认显示名。
 */
const DEFAULT_PROVIDER_NAME = "新供应商";

/**
 * @description 规范化一份生成参数，缺失或非法字段回退到默认值。
 * @param value 未受信任的生成参数片段。
 * @returns 字段完整、类型正确的生成参数。
 */
function normalizeGenerationParams(
  value: Partial<GenerationParams> | undefined,
): GenerationParams {
  return {
    temperature: Number.isFinite(value?.temperature)
      ? Number(value?.temperature)
      : DEFAULT_GENERATION_PARAMS.temperature,
    reasoningEffort: REASONING_EFFORTS.includes(
      value?.reasoningEffort as ReasoningEffort,
    )
      ? (value?.reasoningEffort as ReasoningEffort)
      : DEFAULT_GENERATION_PARAMS.reasoningEffort,
  };
}

/**
 * @description 创建一份空白供应商配置：连接信息全部留空，生成参数取默认值。
 * @param id 供应商标识。
 * @param apiFormat 接入格式，默认 Chat Completions。
 * @returns 可直接编辑的空白供应商配置。
 */
export function createProvider(
  id: string,
  apiFormat: ApiFormat = DEFAULT_API_FORMAT,
): ModelProvider {
  return {
    id,
    name: DEFAULT_PROVIDER_NAME,
    apiFormat,
    baseUrl: "",
    apiKey: "",
    defaultParams: { ...DEFAULT_GENERATION_PARAMS },
    models: [],
  };
}

/**
 * @description 创建一个新的模型条目，生成全局唯一的条目标识。
 * @param model 模型 ID 字符串。
 * @param extras 覆盖默认值的其余条目字段。
 * @returns 完整的模型条目。
 * @remarks 标识采用随机 UUID：时间戳方案在同一毫秒内重复构造时会生成重复标识，
 *   进而被供应商规范化去重静默丢弃。
 */
export function createModelEntry(
  model: string,
  extras?: Partial<Omit<ProviderModel, "id" | "model">>,
): ProviderModel {
  return {
    id: `model-${crypto.randomUUID()}`,
    model,
    supportsImages: false,
    ...extras,
  };
}

/**
 * @description 校验持久化的模型目录结构；目录只携带凭据指纹，不接受凭据本身。
 * @param value 来自设置存储的未受信任目录值。
 * @param apiFormat 目录必须匹配的接入格式。
 * @returns 规范化后的目录；值不完整或 apiFormat 不匹配时返回 undefined。
 */
function normalizeModelCatalog(
  value: unknown,
  apiFormat: ApiFormat,
): ModelCatalog | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const raw = value as Partial<ModelCatalog>;
  if (
    raw.apiFormat !== apiFormat ||
    typeof raw.baseUrl !== "string" ||
    typeof raw.fetchedAt !== "string" ||
    typeof raw.apiKeyFingerprint !== "string" ||
    !Array.isArray(raw.models)
  ) {
    return undefined;
  }

  return {
    apiFormat,
    baseUrl: raw.baseUrl,
    fetchedAt: raw.fetchedAt,
    apiKeyFingerprint: raw.apiKeyFingerprint,
    models: [
      ...new Set(
        raw.models.filter(
          (model): model is string => typeof model === "string",
        ),
      ),
    ],
  };
}

/**
 * @description 规范化一份模型条目，缺失或非法字段回退到默认值。
 * @param value 未受信任的模型条目片段。
 * @param fallbackId 条目缺少合法 ID 时使用的标识。
 * @param apiFormat 所属供应商的接入格式，决定参数覆盖中需要忽略的字段。
 * @returns 字段完整、类型正确的模型条目。
 * @remarks Anthropic 格式不启用思考等级，参数覆盖中的 reasoningEffort 一律剔除；
 *   temperature 覆盖接受数值或 null（显式不发送），其余取值剔除后按继承处理。
 */
export function normalizeProviderModel(
  value: Partial<ProviderModel> | null | undefined,
  fallbackId: string,
  apiFormat: ApiFormat,
): ProviderModel {
  const raw = value || {};
  const rawOverrides =
    raw.paramOverrides && typeof raw.paramOverrides === "object"
      ? raw.paramOverrides
      : undefined;
  const normalizedEffort = REASONING_EFFORTS.includes(
    rawOverrides?.reasoningEffort as ReasoningEffort,
  )
    ? (rawOverrides?.reasoningEffort as ReasoningEffort)
    : undefined;
  const rawOverrideTemperature = rawOverrides?.temperature;
  const normalizedTemperature =
    rawOverrideTemperature === null
      ? null
      : Number.isFinite(rawOverrideTemperature)
        ? Number(rawOverrideTemperature)
        : undefined;
  const rawContextWindow = raw.contextWindow;
  const contextWindow =
    typeof rawContextWindow === "number" &&
    Number.isSafeInteger(rawContextWindow) &&
    rawContextWindow > 0
      ? rawContextWindow
      : undefined;
  const rawMaxTokens = raw.maxTokens;
  const maxTokens =
    typeof rawMaxTokens === "number" &&
    Number.isSafeInteger(rawMaxTokens) &&
    rawMaxTokens > 0
      ? rawMaxTokens
      : undefined;
  const paramOverrides: ModelParamOverrides | undefined =
    rawOverrides || normalizedEffort
      ? {
          ...(normalizedTemperature !== undefined
            ? { temperature: normalizedTemperature }
            : {}),
          ...(apiFormat === "chat-completions" && normalizedEffort
            ? { reasoningEffort: normalizedEffort }
            : {}),
        }
      : undefined;

  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id : fallbackId,
    model: typeof raw.model === "string" ? raw.model : "",
    supportsImages: raw.supportsImages === true,
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(paramOverrides && Object.keys(paramOverrides).length > 0
      ? { paramOverrides }
      : {}),
  };
}

/**
 * @description 规范化一份持久化的供应商配置，缺失或非法字段回退到空白默认值。
 * @param value 未受信任的供应商配置片段。
 * @param fallbackId 供应商缺少合法 ID 时使用的标识。
 * @returns 字段完整、类型正确的供应商配置。
 * @remarks 连接信息不做任何预填回退；Anthropic 格式的默认思考等级强制归位为 auto。
 */
export function normalizeProvider(
  value: Partial<ModelProvider> | null | undefined,
  fallbackId: string,
): ModelProvider {
  const raw = value || {};
  const apiFormat = API_FORMATS.includes(raw.apiFormat as ApiFormat)
    ? (raw.apiFormat as ApiFormat)
    : DEFAULT_API_FORMAT;
  const defaultParams = normalizeGenerationParams(raw.defaultParams);
  const models = Array.isArray(raw.models)
    ? raw.models.map((item, index) =>
        normalizeProviderModel(
          item,
          `${fallbackId}-model-${index + 1}`,
          apiFormat,
        ),
      )
    : [];
  const modelCatalog = normalizeModelCatalog(raw.modelCatalog, apiFormat);

  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id : fallbackId,
    name:
      typeof raw.name === "string" && raw.name.trim()
        ? raw.name
        : DEFAULT_PROVIDER_NAME,
    apiFormat,
    baseUrl: typeof raw.baseUrl === "string" ? raw.baseUrl : "",
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey : "",
    defaultParams:
      apiFormat === "anthropic"
        ? { ...defaultParams, reasoningEffort: "auto" }
        : defaultParams,
    models,
    ...(modelCatalog ? { modelCatalog } : {}),
  };
}

/**
 * @description 规范化持久化的供应商集合，并对供应商与模型条目的 ID 做全局去重。
 * @param value 未受信任的供应商集合。
 * @returns 至少结构合法、ID 唯一的供应商集合；空集合是合法终态。
 * @remarks 模型条目 ID 跨供应商去重，保证聊天请求的单字段 modelId 能唯一定位一个条目。
 */
export function normalizeProviderStore(value: unknown): ProviderStore {
  if (!value || typeof value !== "object") {
    return { providers: [] };
  }

  const raw = value as Partial<ProviderStore>;
  const providers = Array.isArray(raw.providers)
    ? raw.providers.map((item, index) =>
        normalizeProvider(item, `provider-${index + 1}`),
      )
    : [];

  const seenProviderIds = new Set<string>();
  const uniqueProviders: ModelProvider[] = [];
  const seenModelIds = new Set<string>();
  for (const provider of providers) {
    if (seenProviderIds.has(provider.id)) {
      continue;
    }
    seenProviderIds.add(provider.id);
    uniqueProviders.push({
      ...provider,
      models: provider.models.filter((model) => {
        if (seenModelIds.has(model.id)) {
          return false;
        }
        seenModelIds.add(model.id);
        return true;
      }),
    });
  }

  return { providers: uniqueProviders };
}
