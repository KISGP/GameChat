# @gamechat/electron

Electron 壳适配包。收容宿主壳层职责：应用生命周期、窗口与托盘、IPC 总线、download 与 updater。

标准主进程经 `startChatAppMain(options)` 装配：应用入口以 `ChatAppMainOptions` 声明身份与呈现差异（appId、productName、窗口、托盘、仓库、发布页、可选 User-Agent），包内只保留机制与中性默认，不出现任何品牌名。
