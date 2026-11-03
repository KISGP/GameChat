# @gamechat/core

壳无关业务核心：聊天运行时（完整流程包 + 回合生命周期 + 显式事件出口 + 摘要制会话存储）、设置引擎、world 检索与基础设施原语。壳能力一律经 adapter 接口（`src/adapters.ts`）、宿主绑定（`src/chat/host.ts`）与日志/追踪 sink（`src/infra/log.ts`、`src/infra/trace.ts`）由宿主注入。

## 命令

- `npm run typecheck`（workspace 根委托）

## 目录

- `src/adapters.ts` —— 壳适配接口（HttpAdapter / StorageAdapter / IpcAdapter / LogAdapter）
- `src/chat/` —— 聊天域：`engine/`（路由/工具执行步骤、回合生命周期、消化与终答步骤、回合状态）、`flow/`（完整流程解释器、群聊选人、插值作用域）、`run/`（运行时门面、事件消费、运行注册与收尾）、`model/`（模型工厂与消息构造）、`session/`（摘要制会话存储）、`media/`、`state-card/`、`export/`、`tools/`（内置工具包）、`src/tools/`（工具契约与执行器）
- `src/flows/` —— 按 `single` / `group` 分目录的声明式流程包存储；内置 standard 只读，缺失或损坏抛错
- `src/settings/` —— 统一设置引擎（类型单源 + 归一化 + 存储引擎）
- `src/world/`、`src/retrieval/` —— world.json 资料检索与 BM25 实现
- `src/infra/` —— 原子写、容错读、并发原语、路径校验、出站 HTTP、日志/追踪 sink
