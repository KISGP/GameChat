# core 契约

`@gamechat/core` 的域版图与 infra 原语约束。壳无关性经注入达成：壳适配契约（LogAdapter/StorageAdapter/IpcAdapter/HttpAdapter）定义在 `core/src/adapters.ts`，宿主绑定经 `src/chat/host.ts` 的 `configureChatHost`/`setLogSink`/`setTraceSink` 注入，运行时由 `createChatRuntime` 构造。

## 域版图

根目录只有 `index.ts`（根门）、`adapters.ts`（壳适配契约集）与域目录。域间导入走对方门面（`'../tools'`、`'../infra'`）或包名（`@gamechat/schema`）；叶子域（memory/world）禁止引用 chat 引擎层。

- `chat/`：聊天流水线（engine/flow/run/model/session/tools/media/state-card/export），契约见 `chat-runtime.md`。
- `flows/`：声明式流程包存储，落盘 `<appDataRoot>/flows/<id>.json`，内置从 `<builtinDir>` 读取，文件名经 `assertPathSegment`；`standard` 只读；缺失或损坏直接抛错。
- `tools/`：Agent 工具契约（AgentTool/AgentToolContext/AgentToolPackage/AgentModelFactory），chat 引擎、内置工具包、lab 编排器三方共用；策略 ID 清单转导 L0。
- `characters/`：角色域（local/remote/sync）；媒体协议路径解析在 `media.ts`，URL 构造契约在 `@gamechat/schema` 的 `character-media.ts`。
- `memory/`：每角色 Markdown 整文档记忆，写前保留版本快照，按角色串行写入。
- `settings/`：统一设置引擎，类型单源在 L0，normalize + `UnifiedSettingsStore` 分区持久化。
- `world/`：`search.ts`（MiniSearch BM25 索引与查询期字段 boost）、`sync.ts`（GitHub 单文件 world.json 同步，落盘用 `swapDirectoryAtomic`）、`world-index.ts`（索引文件校验）。

## infra 原语

core 主动调用的实现，禁止再手写同类模式：

- `fs.ts`：原子写与容错读；`swapDirectoryAtomic` 是全仓唯一目录级交换实现；禁止手写 tmp+rename。
- `concurrency.ts`：`createSingleLazyPromise`/`createKeyedLazyPromise`/`createSingleFlight`/`createSerialQueue`；经 lazy promise 缓存的读路径，唯一写入方必须在写盘成功后失效缓存。
- `http.ts`：`request`/`requestJson`/`requestBuffer`/`readResponseCapped`（30s 超时、20MB 流式截断）；传输槽 `setHttpAdapter`/`appFetch`，宿主注入出站网络栈，未注入时 Node fetch 直连，模型客户端共享同一决策；`tokenize.ts` 检索分词，查询与文档必须同刀。
- `path.ts` 的 `isPathSegment`/`assertPathSegment` 是唯一路径段校验；`github.ts` 来源链（代理映射与逐来源故障转移）；`user-agent.ts` 出站 UA 单一模块槽，宿主经 `setUserAgent` 注入一次。
- 应用路径基准在 `packages/electron/src/main/utils/path.ts`；除此之外禁止再建 utils 层。
