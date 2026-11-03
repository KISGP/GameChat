# renderer 契约

renderer 位于 `apps/wuwachat/src/renderer`，本文件约束其结构与界面纪律。

- 结构固定为 `app/`（入口、应用壳、hooks、styles、telemetry）、`pages/`（chat、display、quickstart、settings 四页编排）、`features/`（按业务能力分域）、`common/`、`store/`、`services/`、`assets/`。`pages/` 只做页面编排与覆盖层生命周期；业务实现归 `features/<name>/`；`common/components/` 只放跨页面复用的视觉组件，保持扁平。
- 交互按钮一律使用 `common/components/button.tsx` 的 `Button`，variant 六种：`primary`/`brand`/`quiet`/`ghost`/`danger`/`link`；颜色一律经主题 token 在 Button 内表达，调用点只用 className 调几何与定位，禁止绕开 Button 重写配色。保留原生 `<button>` 的形态：圆形微钮、picker 与菜单列表项、画布/轨道/选择卡与列表选择行、分段/标签/折叠头。
- 跨页面 Zustand 状态放 `store/`（现有文件读目录即得），目录名固定 `store`、文件名不使用 `-store` 后缀；`services/` 是访问 preload 的唯一入口，除此之外禁止任何组件、页面、hook、store 直接调用 `window.*`。
- 失败上报与埋点统一走 `app/telemetry.ts`（经应用日志流），`console.*` 不作为失败上报渠道。
- 设置页保持单窗口覆盖层行为，不引入路由库或独立 BrowserWindow。
- 稳定命名，不得重命名：`ToolsTab`、`TTS/FishAudio`、`TTS/local/index-tts`。
- 静态资源集中在 `src/renderer/assets/`，不得散落到业务目录。
