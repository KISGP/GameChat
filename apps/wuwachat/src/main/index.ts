import { startChatAppMain } from '@gamechat/electron'

startChatAppMain({
  appId: 'com.wuwachat',
  productName: 'WuWaChat',
  window: {
    width: 1200,
    height: 720,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundMaterial: 'acrylic',
    iconPath: 'icon.ico',
    title: 'WuWaChat'
  },
  tray: {
    iconPath: 'icon.ico',
    tooltip: 'WuWaChat',
    labels: {
      show: '打开主窗口',
      quit: '退出'
    }
  },
  agentLab: {
    width: 1440,
    height: 900,
    title: '流程画布'
  },
  repositories: {
    characters: { owner: 'KISGP', name: 'WuWaChatChars', branch: 'main' },
    world: { owner: 'KISGP', name: 'WuWaChatWorld', branch: 'main' }
  },
  releasesUrl: 'https://github.com/KISGP/GameChat/releases'
})
