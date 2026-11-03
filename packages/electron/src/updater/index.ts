/**
 * @description 应用内自动更新控制器：检查（GitHub 来源链 + 单源超时）、下载（可取消 + 进度广播）
 *   与安装（静默 + 自动重启）的框架侧实现。
 * @remarks 经 {@link createAppUpdaterController} 构造；electron-updater 的 autoUpdater 是模块级
 *   单例，进程内只应存在一个控制器实例。下载与安装都只在应用显式调用时发生，框架的自动
 *   下载与退出即装保持关闭。
 */
import { format } from 'node:util'
import { app } from 'electron'
import { autoUpdater, CancellationToken } from 'electron-updater'
import {
  describeGithubAttemptFailure,
  formatGithubChainError,
  GithubSourceChainError,
  type GithubSourceAttempt
} from '@gamechat/core'
import type { LogAdapter } from '@gamechat/core'
import { broadcastToAllWindows } from '../broadcast'
import { UPDATER_STATE_CHANNEL, type UpdaterPhase, type UpdaterSnapshot } from './types'

/** 发布列表地址之前拼接的「最新版本资产」路径；latest.yml 与安装包都从该前缀取。 */
const RELEASES_LATEST_PATH = '/latest/download'
/** 启动后延迟自动检查的等待时长，避免抢占启动窗口的网络与 CPU。 */
const AUTO_CHECK_DELAY_MS = 8_000
/** 单来源检查的超时时长：到点视为该来源失败换下一个，兜底连接挂起不落定。 */
const CHECK_TIMEOUT_MS = 15_000

/** 检查与下载共用的单个来源描述。 */
export type UpdaterSource = {
  /** 来源展示名，进入日志与失败归因文案。 */
  label: string
  /** 来源前缀地址（gh-proxy 方案）；为 null 表示 GitHub 直连，不加前缀。 */
  baseUrl: string | null
}

/** 更新控制器的应用依赖。 */
export type AppUpdaterOptions = {
  /** 发布列表地址，作为没有目标版本时的兜底出口。 */
  releasesUrl: string
  /** 读取 GitHub 来源链：逐来源尝试检查更新，第一个成功的来源同时作为安装包下载源。 */
  getSources: () => Promise<UpdaterSource[]>
  /** 是否排定启动延迟自动检查（一般映射设置项，只在安装版生效）。 */
  getAutoCheck: () => Promise<boolean>
  /** 日志出口。 */
  log: LogAdapter
}

/** 更新控制器：应用对更新流程的全部操作面。 */
export type AppUpdaterController = {
  /** 初始化更新域：声明手动语义、桥接框架日志、挂载事件监听，并在安装版排定延迟自动检查。 */
  initialize: () => void
  /** 检查更新；已在检查、下载中或已下载就绪时直接返回当前快照。 */
  checkForUpdates: () => Promise<UpdaterSnapshot>
  /** 下载已发现的更新；单来源失败自动沿来源链换源重试，取消时阶段回落 available 并正常返回。 */
  downloadUpdate: () => Promise<UpdaterSnapshot>
  /** 取消进行中的下载；只发中止信号，不改写阶段。 */
  cancelDownload: () => UpdaterSnapshot
  /** 退出应用并静默安装已下载的更新，完成后自动重启；仅安装版且下载完成后可用。 */
  installUpdate: () => void
  /** 读取当前更新快照。 */
  getState: () => UpdaterSnapshot
  /** 关停更新域：取消自动检查计时器与进行中的下载。 */
  shutdown: () => void
}

/**
 * @description 单来源检查超过时限未落定时抛出的哨兵错误。
 * @remarks 仅供来源链 catch 分支识别超时短因，不进入日志格式化以外的通用错误处理。
 */
class UpdateCheckTimeoutError extends Error {
  /**
   * @description 构造检查超时错误。
   */
  constructor() {
    super('Update check timed out')
    this.name = 'UpdateCheckTimeoutError'
  }
}

/**
 * @description 安装包缺少更新器运行时配置文件时抛出的哨兵错误。
 * @remarks 换来源无法弥补组件缺失，来源链识别到它后立即终止，不再逐源重试。
 */
class UpdateComponentMissingError extends Error {
  /**
   * @description 构造更新组件缺失错误。
   */
  constructor() {
    super('Update component missing (app-update.yml)')
    this.name = 'UpdateComponentMissingError'
  }
}

/**
 * @description 判断异常是否为更新器运行时配置文件缺失。
 * @param error 来源链尝试中捕获的异常。
 * @returns 异常消息同时包含 ENOENT 与 app-update.yml 时返回 true。
 * @remarks 该缺失源于安装包本身不完整，与来源和网络无关，重试其他来源没有意义。
 */
function isComponentMissingError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  return error.message.includes('ENOENT') && error.message.includes('app-update.yml')
}

/**
 * @description 创建应用内自动更新控制器。
 * @param options 应用依赖：发布地址、来源链读取、自动检查开关与日志出口。
 * @returns 更新控制器实例。
 * @remarks 非 Windows 平台整域不生效（安装包不由本渠道提供更新器）；开发态允许检查与下载，
 *   安装能力由 installUpdate 的打包守卫单独表达。
 */
export function createAppUpdaterController(options: AppUpdaterOptions): AppUpdaterController {
  let snapshot: UpdaterSnapshot | null = null
  let listenersAttached = false
  let autoCheckTimer: ReturnType<typeof setTimeout> | null = null
  let downloadCancellationToken: CancellationToken | null = null
  /** 递增的检查会话序号：每次发起检查加一，用于标识并失效过期检查的事件。 */
  let checkGeneration = 0
  /** 当前进行中的检查会话序号；无检查进行时为 null。 */
  let activeCheckGeneration: number | null = null

  /**
   * @description 构造发布页地址。
   * @param version 目标版本号；为空时返回发布列表地址。
   * @returns 指向该版本 tag 或发布列表的地址。
   */
  function buildReleaseUrl(version: string | null): string {
    const normalized = version?.trim().replace(/^v/i, '') ?? ''
    return normalized ? `${options.releasesUrl}/tag/v${normalized}` : options.releasesUrl
  }

  /**
   * @description 判断当前平台是否具备应用内自动更新能力。
   * @returns 仅 Windows 返回 true。
   */
  function isUpdaterSupported(): boolean {
    return process.platform === 'win32'
  }

  /**
   * @description 读取更新快照，首次访问时惰性取当前应用版本与平台能力。
   * @returns 当前更新快照。
   */
  function ensureSnapshot(): UpdaterSnapshot {
    if (!snapshot) {
      snapshot = {
        currentVersion: app.getVersion(),
        supported: isUpdaterSupported(),
        releaseUrl: options.releasesUrl,
        phase: { status: 'idle' }
      }
    }
    return snapshot
  }

  /**
   * @description 覆盖当前更新阶段并广播完整快照；阶段带目标版本时同步把发布页地址指向该 tag。
   * @param phase 新的更新阶段。
   */
  function setPhase(phase: UpdaterPhase): void {
    const current = ensureSnapshot()
    const version = 'version' in phase ? phase.version : null
    snapshot = {
      ...current,
      releaseUrl: buildReleaseUrl(version),
      phase
    }
    broadcastToAllWindows(UPDATER_STATE_CHANNEL, snapshot)
  }

  /**
   * @description 校验当前平台可执行更新流程；不支持的平台直接抛错。
   * @throws 当前平台不支持应用内更新时抛出，message 为面向渲染层的安全文案。
   */
  function assertUpdatable(): void {
    if (isUpdaterSupported()) {
      return
    }
    throw new Error('当前平台不支持应用内更新，请到发布页手动下载安装包。')
  }

  /**
   * @description 以超时竞速包裹单来源的更新检查。
   * @returns 检查在时限内落定时返回框架报告的目标版本号；框架未给出结果时为 null。
   * @throws {@link UpdateCheckTimeoutError} 检查超过 {@link CHECK_TIMEOUT_MS} 未落定时抛出。
   * @remarks 竞速输掉的检查无法真正中止，其后续事件由检查事件门卫与错误事件翻译条件丢弃。
   */
  async function withCheckTimeout(): Promise<string | null> {
    let timer: ReturnType<typeof setTimeout> | null = null
    try {
      return await Promise.race([
        autoUpdater.checkForUpdates().then((result) => result?.updateInfo.version ?? null),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new UpdateCheckTimeoutError()), CHECK_TIMEOUT_MS)
        })
      ])
    } finally {
      if (timer !== null) {
        clearTimeout(timer)
      }
    }
  }

  /**
   * @description 构造指定来源的更新源地址。
   * @param source 来源描述；带前缀来源把前缀拼在发布地址之前，直连来源不加前缀。
   * @returns 「发布页 + 最新版本资产」形态的源地址。
   */
  function buildSourceFeedUrl(source: UpdaterSource): string {
    return source.baseUrl
      ? `${source.baseUrl}/${options.releasesUrl}${RELEASES_LATEST_PATH}`
      : `${options.releasesUrl}${RELEASES_LATEST_PATH}`
  }

  /**
   * @description 沿来源链逐个尝试检查更新，第一个成功的来源同时作为安装包下载源。
   * @returns 无返回值；检查成功后 electron-updater 快照已就绪。
   * @remarks 每个来源把来源前缀拼在「发布页 + 最新版本资产」地址之前（直连来源不加前缀）后
   *   执行一次检查，单来源超过 {@link CHECK_TIMEOUT_MS} 未落定即按失败换下一个；逐来源的
   *   开始与结论写入应用日志。全部来源失败时抛出来源链聚合错误；下载阶段的来源切换由
   *   {@link downloadAlongSources} 沿同一来源链独立执行。
   */
  async function checkForUpdatesAlongSources(): Promise<void> {
    const sources = await options.getSources()
    const attempts: GithubSourceAttempt[] = []
    for (const source of sources) {
      const feedUrl = buildSourceFeedUrl(source)
      autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl })
      void options.log.info('updater', 'update-check-source-start', 'Trying update check source', {
        source: source.label,
        feedUrl
      })
      try {
        const version = await withCheckTimeout()
        void options.log.info('updater', 'update-check-source-ok', 'Update check source succeeded', {
          source: source.label,
          version
        })
        return
      } catch (error) {
        const reason =
          error instanceof UpdateCheckTimeoutError ? '请求超时' : describeGithubAttemptFailure(error)
        void options.log.warn(
          'updater',
          'update-check-source-failed',
          'Update check source failed',
          {
            source: source.label,
            reason
          }
        )
        attempts.push({ sourceLabel: source.label, reason })
      }
    }
    throw new GithubSourceChainError(attempts)
  }

  /**
   * @description 沿来源链逐源尝试下载安装包，单来源失败自动换下一个来源重试。
   * @param version 目标版本号，用于逐源重置下载阶段。
   * @param cancellationToken 下载中止信号；取消后不再尝试后续来源。
   * @returns 无返回值；任一来源下载成功后安装包已落盘。
   * @throws {@link UpdateComponentMissingError} 更新组件缺失时立即抛出，不换源；
   *   全部来源尝试后仍未成功时抛出来源链聚合错误。单来源下载不设超时，由用户取消兜底。
   */
  async function downloadAlongSources(
    version: string,
    cancellationToken: CancellationToken
  ): Promise<void> {
    const sources = await options.getSources()
    const attempts: GithubSourceAttempt[] = []
    for (const source of sources) {
      if (cancellationToken.cancelled) {
        return
      }
      autoUpdater.setFeedURL({ provider: 'generic', url: buildSourceFeedUrl(source) })
      setPhase({ status: 'downloading', version, percent: 0, speedBytesPerSecond: 0 })
      void options.log.info(
        'updater',
        'update-download-source-start',
        'Trying update download source',
        { source: source.label }
      )
      try {
        await autoUpdater.downloadUpdate(cancellationToken)
        void options.log.info(
          'updater',
          'update-download-source-ok',
          'Update download source succeeded',
          { source: source.label }
        )
        return
      } catch (error) {
        if (cancellationToken.cancelled) {
          return
        }
        if (isComponentMissingError(error)) {
          void options.log.error(
            'updater',
            'update-download-source-failed',
            'Update component is missing in this install',
            { source: source.label }
          )
          throw new UpdateComponentMissingError()
        }
        const reason = describeGithubAttemptFailure(error)
        void options.log.warn(
          'updater',
          'update-download-source-failed',
          'Update download source failed',
          { source: source.label, reason }
        )
        attempts.push({ sourceLabel: source.label, reason })
      }
    }
    throw new GithubSourceChainError(attempts)
  }

  /**
   * @description 把调用方异常翻译为「先记日志、再抛安全文案」的形态。
   * @param event 事件标识，进日志 action。
   * @param error 原始异常。
   * @param safeMessage 面向渲染层的中文文案。
   */
  function throwSafe(event: string, error: unknown, safeMessage: string): never {
    void options.log.warn('updater', event, 'Updater operation failed', {
      message: error instanceof Error ? error.message : String(error)
    })
    throw new Error(safeMessage)
  }

  const controller: AppUpdaterController = {
    initialize: () => {
      if (!isUpdaterSupported()) {
        void options.log.info(
          'updater',
          'updater-unsupported',
          'Auto updater disabled outside Windows',
          {
            platform: process.platform
          }
        )
        return
      }

      autoUpdater.autoDownload = false
      autoUpdater.autoInstallOnAppQuit = false
      autoUpdater.disableWebInstaller = true
      if (!app.isPackaged) {
        // 框架在未打包且未强制开发配置时会让 checkForUpdates 静默返回 null，检查阶段将永不落定；
        // 开发态必须显式开启，配合应用侧 dev-app-update.yml 走真实检查。
        autoUpdater.forceDevUpdateConfig = true
      }
      // 红线：禁止设置 autoUpdater.installDirectory——它会以 /D= 覆盖注册表记忆的安装位置，
      // 静默更新将不再落回用户首次安装的目录。
      attachInternalLoggerBridge()
      attachAutoUpdaterListeners()
      if (app.isPackaged) {
        void scheduleAutoCheck()
      }
    },

    checkForUpdates: async () => {
      assertUpdatable()
      const current = ensureSnapshot()
      if (
        current.phase.status === 'checking' ||
        current.phase.status === 'downloading' ||
        current.phase.status === 'downloaded'
      ) {
        return current
      }

      const generation = ++checkGeneration
      activeCheckGeneration = generation
      attachCheckEventListeners(generation)
      setPhase({ status: 'checking' })
      try {
        await checkForUpdatesAlongSources()
      } catch (error) {
        const chainSummary = formatGithubChainError(error)
        const message = `检查更新失败，请检查网络或 GitHub 来源设置后重试。${chainSummary ?? ''}`
        setPhase({ status: 'error', message })
        throwSafe('update-check-failed', error, message)
      } finally {
        activeCheckGeneration = null
      }
      return ensureSnapshot()
    },

    downloadUpdate: async () => {
      assertUpdatable()
      const current = ensureSnapshot()
      if (current.phase.status !== 'available') {
        throwSafe(
          'update-download-invalid-phase',
          new Error(`Download requested in phase ${current.phase.status}`),
          '当前没有可下载的更新。'
        )
      }

      const version = current.phase.version
      const cancellationToken = new CancellationToken()
      downloadCancellationToken = cancellationToken
      try {
        await downloadAlongSources(version, cancellationToken)
      } catch (error) {
        if (!cancellationToken.cancelled) {
          const message =
            error instanceof UpdateComponentMissingError
              ? '应用内更新组件缺失，请重新安装应用，或到发布页手动下载安装包。'
              : `更新下载失败，请检查网络后重试，或到发布页手动下载。${formatGithubChainError(error) ?? ''}`
          setPhase({ status: 'error', message })
          throwSafe('update-download-failed', error, message)
        }
        void options.log.warn(
          'updater',
          'update-download-failed',
          'Update download failed or was cancelled',
          {
            message: error instanceof Error ? error.message : String(error),
            cancelled: cancellationToken.cancelled
          }
        )
      } finally {
        downloadCancellationToken = null
      }
      if (cancellationToken.cancelled) {
        setPhase({ status: 'available', version })
      }
      return ensureSnapshot()
    },

    cancelDownload: () => {
      const current = ensureSnapshot()
      if (current.phase.status !== 'downloading' || downloadCancellationToken === null) {
        return current
      }

      downloadCancellationToken.cancel()
      return current
    },

    installUpdate: () => {
      assertUpdatable()
      if (!app.isPackaged) {
        throwSafe(
          'update-install-dev-blocked',
          new Error('Install is only available in packaged builds'),
          '安装更新仅在安装版中可用。'
        )
      }
      if (ensureSnapshot().phase.status !== 'downloaded') {
        throwSafe(
          'update-install-before-download',
          new Error('Install requested before download completed'),
          '更新尚未下载完成。'
        )
      }

      // 静默安装必须是 (true, true)：向导式安装器仅在 silent 且 forceRunAfter 时才会装回
      // 注册表记忆的目录并自动重启；第二个参数为 false 会导致更新后应用不再启动。
      autoUpdater.quitAndInstall(true, true)
    },

    getState: () => ensureSnapshot(),

    shutdown: () => {
      if (autoCheckTimer !== null) {
        clearTimeout(autoCheckTimer)
        autoCheckTimer = null
      }
      downloadCancellationToken?.cancel()
    }
  }

  return controller

  /**
   * @description 把 electron-updater 的内部日志桥接进应用日志，info、warn、error 按级映射。
   * @remarks 框架内部日志默认只进控制台，打包版不可见；桥接后跳过检查、重入等框架层诊断
   *   在宿主日志基建中同样可查。消息经 util.format 展开。LogAdapter 无 debug 级，
   *   框架调试输出降级忽略。
   */
  function attachInternalLoggerBridge(): void {
    autoUpdater.logger = {
      info: (message?: unknown, ...args: unknown[]) => {
        void options.log.info('updater', 'electron-updater', format(message, ...args))
      },
      warn: (message?: unknown, ...args: unknown[]) => {
        void options.log.warn('updater', 'electron-updater', format(message, ...args))
      },
      error: (message?: unknown, ...args: unknown[]) => {
        void options.log.error('updater', 'electron-updater', format(message, ...args))
      },
      debug: (message: string) => {
        void message
      }
    }
  }

  /**
   * @description 为一轮检查挂载带会话门卫的检查事件监听，进程内同一时刻只保留最新一轮。
   * @param generation 本轮检查的会话序号。
   * @remarks 检查结果事件只在事件属于当前活跃会话时翻译为阶段变更；被超时放弃的检查迟到
   *   触发的事件因会话序号过期被丢弃，防止改写已落定的阶段。
   */
  function attachCheckEventListeners(generation: number): void {
    autoUpdater.removeAllListeners('checking-for-update')
    autoUpdater.removeAllListeners('update-available')
    autoUpdater.removeAllListeners('update-not-available')
    autoUpdater.on('checking-for-update', () => {
      if (generation !== activeCheckGeneration) {
        return
      }
      setPhase({ status: 'checking' })
    })
    autoUpdater.on('update-available', (info) => {
      if (generation !== activeCheckGeneration) {
        return
      }
      setPhase({ status: 'available', version: info.version })
    })
    autoUpdater.on('update-not-available', () => {
      if (generation !== activeCheckGeneration) {
        return
      }
      setPhase({ status: 'idle' })
    })
  }

  /**
   * @description 订阅 electron-updater 的下载与错误事件并翻译为更新阶段广播；进程内只挂载一次。
   * @remarks 下载进度与完成事件直接驱动阶段；error 事件仅在下载或就绪阶段翻译——检查阶段的
   *   失败由来源链的异常路径上报，避免检查期间被放弃请求的迟到错误改写阶段。
   */
  function attachAutoUpdaterListeners(): void {
    if (listenersAttached) {
      return
    }
    listenersAttached = true

    autoUpdater.on('download-progress', (progress) => {
      const current = ensureSnapshot()
      const version = current.phase.status === 'downloading' ? current.phase.version : ''
      setPhase({
        status: 'downloading',
        version,
        percent: progress.percent,
        speedBytesPerSecond: progress.bytesPerSecond
      })
    })
    autoUpdater.on('update-downloaded', (info) => {
      setPhase({ status: 'downloaded', version: info.version })
    })
    autoUpdater.on('error', (error) => {
      const status = ensureSnapshot().phase.status
      if (status !== 'downloading' && status !== 'downloaded') {
        return
      }
      void options.log.warn('updater', 'updater-error', 'electron-updater reported an error', {
        message: error.message
      })
      setPhase({ status: 'error', message: `更新过程出错：${error.message}` })
    })
  }

  /**
   * @description 按设置排定启动延迟自动检查。
   * @returns 设置读取完成后的 Promise。
   * @remarks 自动检查只在安装版排定且失败只记日志，不打扰用户；手动检查才向上提示。
   */
  async function scheduleAutoCheck(): Promise<void> {
    if (!(await options.getAutoCheck())) {
      return
    }

    autoCheckTimer = setTimeout(() => {
      autoCheckTimer = null
      void controller.checkForUpdates().catch((error) => {
        void options.log.warn('updater', 'auto-check-failed', 'Automatic update check failed', {
          message: error instanceof Error ? error.message : String(error)
        })
      })
    }, AUTO_CHECK_DELAY_MS)
  }
}
