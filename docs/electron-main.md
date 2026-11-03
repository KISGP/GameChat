# 标准主进程契约

主进程与 preload 代码在 `@gamechat/electron`（`src/main`、`src/preload`），应用经 electron.vite 入口打包。

- 根上 `broadcast.ts`/`updater/` 是可独立复用的壳原语；窗口、托盘与日志化 IPC 的实现在 `main/app/` 与 `main/ipc/logged-handler.ts`；原语与标准装配禁止互相倒挂。
- main→renderer 推送一律走 `broadcastToAllWindows`/`sendToWebContents`（统一 isDestroyed 防护），禁止直接遍历 BrowserWindow 发送。
- `ipc/` 按域拆分，经日志化 handler 注册；新 IPC 通道先落 `ipc/`，preload 与 `env.d.ts` 同步扩展，未实现的域不预埋桥接。新主进程能力先落对应能力域模块（与 `ipc/` 同层），再经 `ipc/` 暴露；调试后端在 `agent-lab/`，Langfuse 桥接在 `trace/`。
- `utils/` 只保留 `path.ts`（应用路径基准）；通用原语一律从 `@gamechat/core` 导入，禁止重建副本。出站请求统一经 core `http.ts` 管线，传输由 `startChatAppMain` 按 `useSystemProxy` 设置注入（net.fetch 跟随系统代理 / Node fetch 直连），禁止任何业务模块直接调用 `net.fetch` 或裸 `fetch`。
- 应用专属值经 `ChatAppMainOptions` 声明（窗口、托盘、编排窗口、角色与 World 仓库、releases 地址、可选 UA 覆盖）；启动链在对应域首次使用前完成注入（`configureMainWindow`/`configureAgentLabWindow`/`configureCharacterDomain`/`configureWorldDomain`/`initializeUpdater`），未配置即使用一律抛错。`electron-builder.yml` 的 `appId` 必须与 `startChatAppMain` 的一致（AUMI 与系统通知归属），图标类资源经 `asarUnpack: resources/**` 落地。
- updater：`autoDownload` 与 `autoInstallOnAppQuit` 显式保持 `false`（`packages/electron/src/updater/index.ts`），下载与安装只在渲染层显式调用时发生。
- Langfuse 生命周期归应用层初始化与退出链，业务域不得触发追踪生命周期；SDK 引入点只允许动态 import，保持 devDependencies + 构建外置。
- 拥有进行中后台任务的域（下载队列、同步、连接测试等）必须暴露 `shutdown()` 或 `cancelAll()` 并接入退出链，不得依赖写盘自愈兜底退出。
