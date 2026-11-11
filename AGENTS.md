# AGENTS.md

## 项目概览

- 项目名称 `GameChat`：根包 `gamechat-monorepo`，npm workspaces，Node ≥ 20。
- 定位：chat 应用底座——聊天引擎与壳能力全部下沉为包，应用层只承担装配与界面；不做通用公共包，只服务自己的应用。
- 技术栈：Electron 42、React 19、TypeScript 5、electron-vite、Tailwind CSS 4、Zustand。
- AI 运行时：LangChain（`@langchain/openai`、`@langchain/anthropic`）；模型客户端只有 Chat Completions 与 Anthropic Messages 两种接入格式。
- 根 README 是产品介绍页；仓库约束与开发规范在本文件，各层契约细节在 `docs/` 对应文档，`packages/core/README.md` 是 core 目录导览。

## 仓库结构与落点

应用与库分离：`apps/` 放可打包运行的应用，`packages/` 只放可复用的包。

| 位置 | 包 | 层 | 职责 |
|------|----|----|------|
| `packages/type` | `@gamechat/type` | L0 共享类型 | 主进程与渲染层之间的纯类型；零运行时、零 Node 依赖、浏览器安全 |
| `packages/schema` | `@gamechat/schema` | L0 共享逻辑 | 作用于上述类型的纯函数与常量：默认值、归一化、工厂、选项清单、插值、消息切分、表情标记 |
| `packages/core` | `@gamechat/core` | L1 核心 | 聊天运行时、Agent 工具契约、角色/记忆服务、设置引擎、world 检索、infra 原语 |
| `packages/electron` | `@gamechat/electron` | L2 Electron 实现层 | 壳原语（主窗口、托盘、IPC 广播、日志化 handler、updater 控制器）与标准聊天应用主进程：`src/main`（域服务、IPC 通道、生命周期）、`src/preload`（桥接层） |
| `apps/wuwachat` | `wuwachat` | L3 应用 | renderer（`src/renderer`）、编排窗口渲染入口（`src/agent-lab`，与 renderer 平级）、两个薄入口文件与身份配置；主进程与 preload 直接消费 `@gamechat/electron` |

**落点判定三问**（新文件或新能力进哪个包，按序回答）：

1. 主进程与渲染层两侧都要用？类型进 `@gamechat/type`，通道常量与派生纯函数进 `@gamechat/schema`。仅 renderer 使用的类型就近放对应 feature，不上收 L0。
2. 壳无关且可复用？引擎与业务进 `@gamechat/core`，Electron 实现层进 `@gamechat/electron`。抽象层只在存在真实的第二实现或第二用例时引入。
3. 都不是？应用自有代码进 `apps/<name>/src`。

**引用与构建纪律：**

- 跨进程契约不设 shared 层，main/preload/renderer 三侧直引 L0。
- 单入口根门：各包唯一对外入口是根 barrel；core 各域自带 `index.ts` 门面，根 `src/index.ts` 只做 `export * from './域'` 转发。禁止文件级深导入；`@gamechat/core/<域>` 子路径映射为存量消费保留解析，禁新用、触碰即改。
- `BUNDLE_PACKAGES`（`@gamechat` 系包，TS 源码形态）必须打进产物；`TRACE_EXTERNAL_PACKAGES`（`@langfuse` 四包与 `@opentelemetry/sdk-node`）保持 devDependencies 且构建期外置，打进产物会拖垮打包版启动。
- agent-lab 窗口与页面随构建装配：renderer 独立入口无条件进产物，与主窗口共用同一份 preload 桥；打包版经 `agent-lab/window.ts` 的打包态 loadFile 分支加载。
- 进程内单例一律惰性 getter，模块 import 零副作用、初始化走显式 init 入口；运行时用户数据保存在仓库外部（目录由宿主注入），禁止假设工作区内文件是应用状态源。
- 新增应用进 `apps/<name>/`，与 wuwachat 并排；新增可复用包进 `packages/`。仓内经 workspaces 依赖，仓外消费方与本仓库同级克隆、以 `file:` 目录依赖接入。

**品牌与身份纪律：**

- `packages/` 内零品牌名；产品名、仓库地址、发布页等品牌值只允许出现在 `apps/<name>/`。`GameChat` 是应用类型名，允许作为 core 的 UA 兜底默认与协议 scheme 前缀，默认只在 `infra/user-agent.ts` 定义一次；协议 scheme 用类型名前缀：`gamechat-media`（角色媒体）、`gamechat-tts`（语音音频）。
- 新应用与 wuwachat 的 main 侧机制完全一致，差异只允许出现在 renderer 与身份/呈现配置（appId、productName、窗口几何与样式、托盘、角色/World 仓库、发布页、User-Agent），经 `ChatAppMainOptions` 在应用入口声明；包内不设品牌默认，未配置即使用报错。main 需要新行为时回 `@gamechat/electron` 加机制或配置项，禁止复制分叉。

**路径别名：**

- 应用薄入口：`src/main/index.ts` 调用 `startChatAppMain`，`src/preload/index.ts` 导入 `@gamechat/electron/preload`；包内互引用一律相对路径。
- renderer 用 `@renderer/*` 指向 `apps/wuwachat/src/renderer`；跨进程契约直引 `@gamechat/type` 与 `@gamechat/schema`；其余别名见应用 `electron.vite.config.ts` 与各包 tsconfig paths。
- 文件已使用别名时延续现有写法，避免退回冗长相对路径。

## 常用命令

- 安装依赖：`npm install`（`.npmrc` 已把 Electron 与 electron-builder 二进制指向 npmmirror 镜像）。
- 检查：`npm run typecheck`（workspaces 遍历，新包带同名脚本自动纳入）与 `npm run lint`（显式 glob 见根 package.json，新包需手动追加）。
- 开发：`npm run dev --workspace wuwachat`；构建：`npm run build --workspace wuwachat`（仅产出 out/）。
- 打包：`npm run dist`（根入口，产出 NSIS 安装包与 latest.yml）；目录产物验证用 `npm run pack --workspace wuwachat`。
- 发版预演：`npm run verify`（typecheck + 完整打包一步完成，与远端发版链同构）；release 提交前本地跑绿再推送。

## 各层契约文档

各层契约细节在 `docs/` 单文件维护，本文件只留定位；改动对应层前先读该文档：

- core 域版图与 infra 原语：`docs/core-contract.md`
- 聊天运行时（四层边界、会话与事件、流程包与编排、lab）：`docs/chat-runtime.md`
- 标准主进程：`docs/electron-main.md`
- renderer：`docs/renderer.md`

## 工程规约

### 代码风格

- 新增代码默认 TypeScript，类型清晰可追踪；命名、模块拆分、目录组织优先对齐现有代码。
- 注释只解释不直观的约束、边界或原因，不重复代码表面含义；只描述现行行为与不变量，不用「既有」「原」「旧的」等历史参照措辞。
- 所有函数必须有 JSDoc；React 组件豁免；接口或工厂函数层已有文档的对象字面量方法与函数体内局部闭包不重复写。
- `@description` 必填且准确；参数语义、约束、副作用不直观时补 `@param`，返回语义不直观时补 `@returns`，有边界条件、异常行为、跨进程约束或使用前提时补 `@remarks`，标签内容与签名一致。修改导出函数签名或行为时同步更新 JSDoc，禁止注释与实现漂移。
- 注释正文只用中文与全角标点，每个标签段以「。」结尾；标签名、代码标识符、协议名与产品名保留原文。
- 纯数据字段用单行 `//`；其余一切声明用标签式多行 JSDoc；构造函数参数写在构造函数的 JSDoc 上。

### 质量与变更

- 先理解现有实现再决定改动点，禁止未读上下文直接改文件；扫描工具或子代理产出的审查发现，写入结论或实施前必须亲自读相关代码复核。
- 改动形成最小闭环，只解决当前任务，禁止顺手做无关重构；不重命名、不搬迁、不批量整理无关代码。
- 优先复用现有分层、模块与 `core/src/infra` 原语；无明确收益不引入新抽象，禁止为将来预留扩展点、禁止无附加逻辑的纯转发包装。
- 同一份数据在相邻链路上只校验一次：跨进程入口与磁盘路径构造各保留一道边界校验，中间层信任上游；类型能表达的约束用类型表达。
- 值域清单与配套界面选项保持单一事实源：值域在 L0 时选项清单同处，禁止消费域或 renderer 平行自建。
- 禁止无理由 `any`、`@ts-ignore`、大范围 `eslint-disable`；无法避免时缩小作用范围并说明原因。
- 禁止吞错：`catch` 至少执行记录日志、转换错误、向上抛出之一。
- 跨进程或跨包契约改动必须同步共享类型、桥接接口与调用方；现有 IPC 契约视为稳定接口，除非调用链两端同时更新。
- chat runtime、memory、world 检索的改动必须同时检查失败路径、日志记录与资源释放。
- 仓库外持久化的用户数据在读取侧按不可信输入处理：入口校验、损坏降级、降级记日志。
- 状态管理、异步流程、IPC 返回值必须考虑空状态、加载中、失败回退与重复触发。
- 不手工修改 `out`、构建产物或无任务需求的锁文件。
- 允许例外，但例外范围必须最小化，并在结果说明中写明原因、影响与后续风险。

### 工作流与验证

按序执行：读相关代码与边界，确认包与层级，改层契约前先读 `docs/` 对应文档 → 定最小方案 → 实施并保持跨文件契约一致 → 验证主路径与失败路径 → 汇报变更、影响范围、验证结果与剩余风险。

- 验证是硬性门槛：提交前至少执行与改动范围匹配的检查，默认根目录 `npm run lint` 与 `npm run typecheck`；不执行必须说明原因；无法完整验证必须写明未执行项、阻塞原因与可能影响范围。
- 批量文本替换必须把脚本落盘执行（临时 Node 脚本，用后删除），禁止 shell 内联多行正则；执行后检索残留特征并运行 typecheck。

### 提交消息

- Conventional Commit：`<type>(<scope>): <subject>`；type 清单 `feat`/`fix`/`refactor`/`docs`/`test`/`chore`/`release`；scope 必填，写改动归属的模块或域，`release` 的 scope 固定 `<应用名>/v<版本号>`（应用名为 `apps/` 下目录名）；subject 用简洁明确的中文短语，专有名词保留原文，不以句号结尾。
- release 提交只携带 `apps/<应用名>/package.json` 与 `package-lock.json` 的版本号更新（先改版本号再 `npm install` 同步 lock），版本必须严格大于上一版本。
- 提交格式与 release 版本一致性由本地 commit-msg 钩子机械校验（`.githooks/`，经根 prepare 脚本在 npm install 时自动启用），发布工作流构建前按同规则复验。
- 示例：`feat(chat): 日志条目支持复制反馈`、`fix(lab): 修复连线端点重连`、`release(wuwachat/v0.2.0): 发布 0.2.0 版本`。

### 分支与发布

- 开发与发版都在 main 单分支进行；推送前确认 lint 与 typecheck 通过，质量检查靠本地执行。
- 发版：根目录 `npm run version:patch|version:minor|version:major` 升级 `apps/<应用名>/package.json` 的 `version` 并同步 lock（等价于手改版本号后 `npm install`）→ `npm run verify` 本地预演通过 → 提交 release 提交 → push main。
- push main 时头提交为 release 提交即触发 `.github/workflows/release.yml`：复验版本 → typecheck → 构建 → electron-builder 打包；成功后创建 GitHub Release 并落 tag `<应用名>-vX.Y.Z`（`--generate-notes` 自动生成更新日志，版本含 `-` 为 prerelease 不进 latest），上传安装包、`latest.yml` 与 `.blockmap`。
- 构建失败不残留 tag 与 Release，修复后重跑工作流或发更高版本；普通提交推送 main 不触发打包。

## 会话纪律（No Negative Echo）

生成最终产物及其包装（标题、文件名、正文、注释、标签、commit、PR、交付说明）时，只描述最终采用的状态，假设读者没看过本次会话。

- 会话里的否决、中间尝试与措辞纠正只当控制信息，不成为最终产物的命名或叙述中心。
- 「不要提 X」不是写「无 X」；标题、文件名、开篇和标签从正向目标重新生成，不逐词修改被否文案。
- 保留真实的基线变化、已执行的外部操作，以及必要的技术名称、诊断、测试和快照。
- 与任务无关的改动不写进本次 commit、PR 或交付说明。
- 写完后通读全部用户可见内容及其包装；内容变化后重新检查，不另加「已清理」或「无残留」类声明。
