import {
  createAppUpdaterController,
  type AppUpdaterController,
  type UpdaterSource
} from '@gamechat/electron'
import type { UpdaterSnapshot } from '@gamechat/type'
import { getAppSettings } from '../settings/app-settings'
import { logger } from '../logging/index'

/** 发布列表地址；由应用启动配置注入，作为没有目标版本时的兜底出口。 */
let releasesUrl: string | null = null

/** 进程内共享的更新控制器；首次初始化时构造。 */
let updaterController: AppUpdaterController | null = null

/**
 * @description 获取进程内共享的更新控制器。
 * @returns 惰性构造并缓存的更新控制器单例。
 * @remarks import 本模块零副作用；控制器在首次初始化时才构造，
 *   来源链与自动检查开关都从应用设置实时读取。
 */
function getUpdaterController(): AppUpdaterController {
  if (!updaterController) {
    if (!releasesUrl) {
      throw new Error('Releases URL is not configured; call initializeUpdater first.')
    }
    updaterController = createAppUpdaterController({
      releasesUrl,
      getSources: async (): Promise<UpdaterSource[]> => {
        const settings = await getAppSettings()
        return settings.githubProxy.sources.map((source) => ({
          label: source.label,
          baseUrl: source.baseUrl
        }))
      },
      getAutoCheck: async () => (await getAppSettings()).update.autoCheck,
      log: logger
    })
  }
  return updaterController
}

/**
 * @description 初始化更新域：登记发布页地址、声明手动下载与安装语义、桥接框架日志并在安装版排定延迟自动检查。
 * @param url 应用发布页地址（GitHub releases）。
 * @returns 无返回值。
 * @remarks 非 Windows 平台整域不生效（由控制器内部判定）；由应用启动链在 IPC 注册后调用。
 */
export function initializeUpdater(url: string): void {
  releasesUrl = url
  getUpdaterController().initialize()
}

/**
 * @description 检查 GitHub 发布页是否有新版本。
 * @returns 检查完成后的更新快照。
 */
export async function checkForUpdates(): Promise<UpdaterSnapshot> {
  return getUpdaterController().checkForUpdates()
}

/**
 * @description 下载已发现的新版本安装包，进度经广播推送。
 * @returns 下载完成后的更新快照；用户取消时同样正常返回。
 */
export async function downloadUpdate(): Promise<UpdaterSnapshot> {
  return getUpdaterController().downloadUpdate()
}

/**
 * @description 取消进行中的更新下载。
 * @returns 取消请求发出时的更新快照。
 */
export function cancelDownload(): UpdaterSnapshot {
  return getUpdaterController().cancelDownload()
}

/**
 * @description 立即退出应用并安装已下载的更新，完成后重新启动应用。
 * @returns 无返回值。
 */
export function installUpdate(): void {
  getUpdaterController().installUpdate()
}

/**
 * @description 读取当前更新快照，供渲染进程启动时同步状态。
 * @returns 当前更新快照。
 */
export function getState(): UpdaterSnapshot {
  return getUpdaterController().getState()
}

/**
 * @description 关停更新域：取消待执行的自动检查与进行中的下载。
 * @returns 无返回值。
 * @remarks 接入应用退出链；进行中的下载以中止信号取消。
 */
export function shutdownUpdater(): void {
  updaterController?.shutdown()
}
