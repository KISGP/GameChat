# 聊天运行时契约

聊天运行时与流程编排的完整约束。流程包类型单源在 L0 `type/src/flow.ts`，归一化在 `schema/src/flow.ts`。

## 四层边界

聊天运行时按四层组织，职责边界是硬约束，禁止越层或新建平行实现：

- Layer 0 `chat/model/model-factory.ts`：模型工厂，不含领域知识。
- Layer 1 `chat/engine/agent-loop.ts`：路由与工具执行步骤；路由阶段不带角色人格。
- Layer 2 `chat/flow/engine.ts`：完整流程解释器，一次运行从选人到终答全部由流程图推进；回合生命周期归引擎——第一个需要回合的步骤前自动装配（`chat/engine/turn-lifecycle.ts`），终答完成后自动提交；生成段共享步骤在 `chat/engine/steps.ts`，单聊/群聊/调试共用一份，禁止分叉。
- Layer 3 `chat/run/runtime.ts`：门面，唯一持有运行注册、流程读取、事件消费与对外事件翻译。

## 会话与事件

- 流程引擎不依赖 LangGraph 运行时：步骤经回合状态的 `emit` 出口发流式增量、工具轨迹、节点进出与流程变量，runtime 把内部事件翻译为对外事件，调试器复用同一出口。
- 阶段守卫（`chat/flow/engine.ts`）：群聊选人为空仍执行生成、流程结束仍有打开回合、终答没有草稿、单参与者未提交回合、提示词步骤未配置模板，全部失败；不提供隐式父图或兜底终答。
- 流程包由宿主注入：`ChatContextProvider.getFlow` 返回非 null 流程包，缺失或损坏抛错；流程种类与参与者数量不匹配直接失败。
- 数据模型是 `participants[] + ownerId`；「是否群聊」一律 `participants.length > 1` 派生，会话 `running` 同为派生；落盘的落定状态只有 `idle | error`。
- 对外事件共八种：`run-started`、`character-stream`、`session-synced`、`session-removed`、`run-finished`、`run-error`、`run-aborted`、`character-state`，契约在 `@gamechat/type` 的 `chat.ts`；流式 token 经 `run/turn-consumer.ts` 翻译为 `character-stream` 增量直发渲染层，主进程不节流、不写会话状态，渲染层按帧合并并在流式气泡内现场切分。
- 落盘策略：流式期间不写盘；落盘点为用户消息 append、回合提交、运行收尾写落定状态与删消息等结构变更，assistant 占位与流式草稿不落盘；run 收尾固定顺序为先从运行注册注销，再写落定状态、发终态事件，中断不写落定状态。
- 数据格式变更默认不做迁移器与兼容层：读取时校验，不满足即跳过并记日志。
- 历史渲染单 builder：`renderHistoryMessages` 是唯一入口；N=1 保持合并与多模态，N>1 每气泡一条消息、assistant 前缀 `[名字]：` 由 builder 补；进群聊前缀的角色名过 `assertSafeParticipantName`。
- assistant 消息切分是纯函数，唯一实现在 `@gamechat/schema`（`assistant-message-splitter.ts`）；渲染层直用，禁止任何侧再建副本。
- 角色媒体以 `gamechat-media` 协议 URL 表达，注册表与广播不携带图片字节，模型输入与重试取图走 IPC Data URL；语音音频以 `gamechat-tts` 协议表达，应用 CSP 的 `media-src` 白名单必须包含该 scheme。
- 记忆没有图节点：memory 工具从会话快照实时派生，按 `participants` 过滤。聊天体验内聚的工具包（chat-history、datetime、chat-images、chat-emoticons、state-card、world、memory、moegirlpedia）随 core 内置。

## 流程包与编排

- 流程包是完整运行图，单群共用一份：当前流程在设置中选择（`currentFlowId`），人数差异由 `participant_count` 判断节点分支表达，选人步骤只放群聊分支。
- 步骤类型：`selectSpeaker`、`condition`、`llm`、`route`、`executeTools`、`finalAnswer`、`intent`、`display`、`environmentInput`；展示名、说明、配置字段与归一化口径单源在 `@gamechat/schema` 的 `FLOW_STEP_DEFINITIONS`，新增步骤只改定义、`FlowStepType` 联合与引擎 dispatch。
- 分支只由判断节点表达：`condition` 持有比较条件，经 `matchConditionValue` 求值后走 `FlowEdge.branch` 分支出边，出边不携带条件。判断节点至少一条分支出边、每分支至多一条，未连线的分支视为流程结束；入线落顶部/左侧/右侧入口 Handle，分支 Handle 只作出线端点；非判断节点至多一条出边。
- 内置变量单源 `FLOW_BUILTIN_VARIABLES`（布尔清单 `FLOW_BOOLEAN_VARIABLES`）；流程变量、终答 section 变量与评分模板变量（`name`、`character_prompt`）的保留清单都在 schema，`outputVariable` 禁止与之重名。
- 群聊选人：`mentioned` 按点名顺序（格式固定 `@角色名`）；`intent` 并行评分取最高，阈值与并列规则由节点配置，不排除已发言者——对话由阈值驱动持续多轮，全员低于阈值即冷场结束；`first` 按参与者顺序；`random` 在未发言者中随机，排除已发言者保证一轮收尾。评分模板经 `{{变量}}` 插值，`{{name}}` 与 `{{character_prompt}}` 指被评估角色。单参与者运行不经过选人；群聊流程结束且没有发言者是正常结束；选人步骤缺失由引擎运行期报错兜底。
- 工具证据链：终答请求只含开头 system 与回合装配的历史，引擎不追加工具轨迹——证据由终答模板显式引用（`{{tool_trace}}` 或整理节点输出变量），模板不含引用则终答不携带证据；`executeTools` 执行后引擎把按预算截断的轨迹文本写入 `tool_trace`；「整理要点」是模型节点配方而非步骤类型。
- 工具治理：工具使用 L0 共享 id，流程不挑选也不收窄工具，应用当前启用的工具全部可用；路由提示词按启用包拼装，引擎内禁止工具专属路由知识；两阶段拓扑硬约束：路由不带人格、终答不绑工具；工具包、执行器、绑定模型与路由提示词回合开始时解析一次写入回合状态，循环内复用，模型实例按 profile 跨回合缓存。
- 工具轮次预算是内部常量 `MAX_TOOL_ROUNDS`（`chat/loop-policy.ts`），流程步数上限由它推导（`flowStepLimit`），调整时必须同步核对；执行治理（并发/超时/重试）取应用侧策略与缺省值。
- 可配面：提示词（新建节点由 schema 内置提示词预填，可改写；route、intent、finalAnswer 与 intent 来源选人的提示词为空在运行期报错）、输出变量、群聊选人规则与外部输入字段；模型不进流程，没有模型名、温度、maxTokens 或 fallback；输出上限由模型条目 `maxTokens` 决定，上下文预算比例与压缩水位只来自全局设置；状态卡始终注入，记忆注入跟随记忆总开关，提交时始终按表情标记分段。
- `environmentInput` 与 `display` 是编排控制步骤，运行时不改变流程状态：前者用一个节点承载全部外部输入（用户消息、模型与模拟角色提示词），真实会话输入仍来自会话与角色配置；后者是串在连线中间的纯展示节点，按上游节点自动显示产出。
- 画布外观字段随包走、运行时不读取：连线端点侧别（`FlowEdge.fromSide`/`toSide`）与画布摆位（`FlowGraph.layout`）；摆位属于草稿内容，拖动与缩放即标记未保存，归一化逐项容错；端点在建线时定格一次，之后只能经拖动端点重连修改。
- 结构演进靠 `normalizeFlowPackage` 归一化容错，不做版本控制；旧的双包（带 kind 字段）流程读取即拒绝，不迁移、不删除旧文件。
- 内置 standard 只读（`apps/<app>/resources/flows/standard.json`，内部 `id` 必须为 `standard`），`save`/`delete` 拒绝 standard，修改需复制副本；设置页只负责选择当前流程与打开流程画布，流程的导入、导出、复制标准、删除与编辑全部在 lab。
- llm/intent 步骤的交换记录只追加回合本地 llmMessages，不进会话存储、不参与装配截断；自定义 prompt 不参与额外预算重算。

## lab

- lab 是一个窗口一块画布，只有左侧步骤池与中央画布；外部输入节点承载模型、用户消息与模拟角色（1 个按单聊运行，2 个以上按群聊运行），运行/停止在画布右上角托盘，运行错误显示在托盘下方。调试用当前画布（含未保存草稿）跑临时会话，用内存 `SessionStore`（`persist: false`），不写真实聊天记录；工具仍执行真实副作用，运行入口必须保留 token 成本提示。
