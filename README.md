# WuWaChat

<div align="center">

![](https://raw.githubusercontent.com/KISGP/WuWaChat/main/resources/icon.png)

“飞讯是先行公约为终端开发的远程通讯程序，生活在索拉里斯的人们可以用飞讯互相联系。”

一款根据《鸣潮》内的飞讯设定构建的桌面聊天应用，支持角色会话、群聊、模型配置、流程编排与记忆检索。

</div>

## 页面预览

<table align="center">
	<tr>
		<td><img src="https://raw.githubusercontent.com/KISGP/WuWaChat/main/docs/1.png" width="420" /></td>
		<td><img src="https://raw.githubusercontent.com/KISGP/WuWaChat/main/docs/2.png" width="420" /></td>
	</tr>
	<tr>
		<td><img src="https://raw.githubusercontent.com/KISGP/WuWaChat/main/docs/3.png" width="420" /></td>
		<td><img src="https://raw.githubusercontent.com/KISGP/WuWaChat/main/docs/4.png" width="420" /></td>
	</tr>
</table>

## 下载

前往 [release](https://github.com/KISGP/WuWaChat/releases) 页面下载

## 快速开始

### 安装依赖

```bash
npm install
```

### 启动开发环境

```bash
npm run dev --workspace wuwachat
```

### 构建应用

```bash
npm run build --workspace wuwachat
```

### 打包安装包

```bash
npm run dist
```

## 项目结构

```text
apps/wuwachat         wuwachat 应用：界面渲染层、流程编排窗口与身份配置
packages/core         聊天运行时、Agent 工具、角色/记忆服务、设置引擎与检索
packages/electron     Electron 实现层：标准主进程、IPC 域服务与 preload 桥
packages/schema       跨进程契约的纯函数与常量：默认值、归一化、IPC 通道
packages/type         跨进程共享类型
${userData}/app-data  会话、流程包、记忆库、角色 Prompt 与 World 数据
```

## 技术栈

- Electron
- React
- TypeScript
- electron-vite
- Tailwind CSS
- Zustand
- LangChain
- React Flow
