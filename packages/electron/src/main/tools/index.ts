/**
 * 本文件属于 tools 域：负责游戏安装目录扫描与抽卡链接提取等宿主工具能力。
 * 它与 agent/tools（Agent 工具注册表，供模型调用的能力工具包）无任何关联。
 */
import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { basename, join, normalize } from 'node:path'
import { promisify } from 'node:util'
import type { GachaUrlRequest, GachaUrlResult } from '@gamechat/type'
import { logger } from '../logging/index'
import { pathExists } from '@gamechat/core'

type LogFileType = 'client' | 'debug'

type LogFileDescriptor = {
  path: string
  type: LogFileType
  lastModifiedMs: number
}

type RegistryEntry = {
  name: string
  data: string
}

const execFileAsync = promisify(execFile)

const CLIENT_LOG_NAME = 'Client.log'
const DEBUG_LOG_NAME = 'debug.log'
const CONVENE_URL_PATTERN =
  /https:\/\/aki-gm-resources(?:-oversea)?\.aki-game\.(?:net|com)\/aki\/gacha\/index\.html#\/record[^"\s]*/giu
const DEBUG_URL_PATTERN =
  /"#url": "(https:\/\/aki-gm-resources(?:-oversea)?\.aki-game\.(?:net|com)\/aki\/gacha\/index\.html#\/record[^"]*)"/giu
const WINDOWS_DRIVE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/**
 * @description 标准化安装目录路径并移除尾部分隔符，便于后续比较与拼接。
 * @param input 原始路径文本。
 * @returns 标准化后的路径；若输入为空则返回空字符串。
 */
function normalizeInstallPath(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) {
    return ''
  }

  return normalize(trimmed).replace(/[\\/]+$/u, '')
}

/**
 * @description 生成用于路径去重的大小写无关 key。
 * @param input 安装目录或日志路径。
 * @returns 统一小写后的比较 key。
 */
function toPathKey(input: string): string {
  return normalizeInstallPath(input).toLowerCase()
}

/**
 * @description 构造统一的抽卡链接获取结果对象。
 * @param ok 当前操作是否成功。
 * @param url 成功时返回的链接。
 * @param message 供界面展示的说明文本。
 * @param requiresManualPath 是否需要继续展示手动路径输入。
 * @returns 结构化结果对象。
 */
function createResult(
  ok: boolean,
  url: string | null,
  message: string,
  requiresManualPath: boolean
): GachaUrlResult {
  return {
    ok,
    url,
    message,
    requiresManualPath
  }
}

/**
 * @description 检查候选路径是否应跳过。
 * @param input 候选安装目录。
 * @returns 若路径为空或命中不支持位置则返回 true。
 * @remarks 当前与原脚本保持一致，跳过包含 OneDrive 的路径。
 */
function shouldSkipInstallPath(input: string): boolean {
  const normalizedPath = normalizeInstallPath(input)
  return !normalizedPath || normalizedPath.toLowerCase().includes('onedrive')
}

/**
 * @description 对路径集合做顺序稳定的去重与过滤。
 * @param paths 原始路径集合。
 * @returns 去重后的候选目录列表。
 */
function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const path of paths) {
    if (shouldSkipInstallPath(path)) {
      continue
    }

    const normalizedPath = normalizeInstallPath(path)
    const key = toPathKey(normalizedPath)

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    result.push(normalizedPath)
  }

  return result
}

/**
 * @description 为单个磁盘盘符生成常见鸣潮安装目录候选。
 * @param driveRoot 例如 `C:\` 的磁盘根路径。
 * @returns 该盘符下的常见安装目录列表。
 */
function buildCommonInstallCandidatesForDrive(driveRoot: string): string[] {
  return [
    join(driveRoot, 'SteamLibrary', 'steamapps', 'common', 'Wuthering Waves'),
    join(
      driveRoot,
      'SteamLibrary',
      'steamapps',
      'common',
      'Wuthering Waves',
      'Wuthering Waves Game'
    ),
    join(driveRoot, 'Program Files (x86)', 'Steam', 'steamapps', 'common', 'Wuthering Waves'),
    join(
      driveRoot,
      'Program Files (x86)',
      'Steam',
      'steamapps',
      'common',
      'Wuthering Waves',
      'Wuthering Waves Game'
    ),
    join(driveRoot, 'Program Files', 'Steam', 'steamapps', 'common', 'Wuthering Waves'),
    join(
      driveRoot,
      'Program Files',
      'Steam',
      'steamapps',
      'common',
      'Wuthering Waves',
      'Wuthering Waves Game'
    ),
    join(driveRoot, 'Games', 'Steam', 'steamapps', 'common', 'Wuthering Waves'),
    join(
      driveRoot,
      'Games',
      'Steam',
      'steamapps',
      'common',
      'Wuthering Waves',
      'Wuthering Waves Game'
    ),
    join(driveRoot, 'Steam', 'steamapps', 'common', 'Wuthering Waves'),
    join(driveRoot, 'Steam', 'steamapps', 'common', 'Wuthering Waves', 'Wuthering Waves Game'),
    join(driveRoot, 'Program Files', 'Epic Games', 'WutheringWavesj3oFh'),
    join(driveRoot, 'Program Files', 'Epic Games', 'WutheringWavesj3oFh', 'Wuthering Waves Game'),
    join(driveRoot, 'Program Files (x86)', 'Epic Games', 'WutheringWavesj3oFh'),
    join(
      driveRoot,
      'Program Files (x86)',
      'Epic Games',
      'WutheringWavesj3oFh',
      'Wuthering Waves Game'
    ),
    join(driveRoot, 'Wuthering Waves Game'),
    join(driveRoot, 'Wuthering Waves', 'Wuthering Waves Game'),
    join(driveRoot, 'Program Files', 'Wuthering Waves', 'Wuthering Waves Game'),
    join(driveRoot, 'Games', 'Wuthering Waves Game'),
    join(driveRoot, 'Games', 'Wuthering Waves', 'Wuthering Waves Game'),
    join(driveRoot, 'Program Files (x86)', 'Wuthering Waves', 'Wuthering Waves Game')
  ]
}

/**
 * @description 列出当前机器存在的文件系统盘符。
 * @returns 可访问盘符根路径列表。
 */
async function listAvailableDriveRoots(): Promise<string[]> {
  const roots = await Promise.all(
    WINDOWS_DRIVE_LETTERS.split('').map(async (letter) => {
      const driveRoot = `${letter}:\\`
      return (await pathExists(driveRoot)) ? driveRoot : null
    })
  )

  return roots.filter((item): item is string => Boolean(item))
}

/**
 * @description 非交互方式执行 `reg query` 并返回标准输出。
 * @param args 传给 `reg.exe` 的参数列表。
 * @returns 注册表查询输出；查询失败时返回空字符串。
 * @remarks 注册表线索属于辅助信息，失败时仅记录警告并继续其他扫描路径。
 */
async function queryRegistry(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('reg.exe', args, {
      windowsHide: true,
      encoding: 'utf8'
    })

    return stdout
  } catch (error) {
    void logger.warn(
      'main',
      'gacha-url-registry-query-failed',
      'Registry query failed during URL scan',
      {
        args,
        error: error instanceof Error ? error.message : String(error)
      }
    )
    return ''
  }
}

/**
 * @description 解析 `reg query` 输出中的值项。
 * @param output 注册表命令输出。
 * @returns 提取出的值名与值数据列表。
 */
function parseRegistryEntries(output: string): RegistryEntry[] {
  return output
    .split(/\r?\n/u)
    .map((line) => line.match(/^\s{4}(.+?)\s{2,}REG_\w+\s{2,}(.*)$/u))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      name: match[1].trim(),
      data: match[2].trim()
    }))
}

/**
 * @description 从包含游戏可执行文件路径的文本中回推出安装目录。
 * @param input 注册表值名或值数据中的原始路径文本。
 * @returns 安装目录；若无法识别则返回 `null`。
 */
function extractInstallPathFromExecutable(input: string): string | null {
  const normalizedInput = normalizeInstallPath(input).replace(/\//gu, '\\')
  const match = normalizedInput.match(/^(.*?)(\\Client\\.*|\\Client-Win64-Shipping\.exe.*)$/iu)

  if (!match?.[1]) {
    return null
  }

  return normalizeInstallPath(match[1])
}

/**
 * @description 从 MUI Cache 中收集历史运行过的鸣潮安装目录。
 * @returns 解析出的安装目录列表。
 */
async function collectMuiCacheCandidates(): Promise<string[]> {
  const output = await queryRegistry([
    'query',
    'HKCU\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\Shell\\MuiCache',
    '/s'
  ])

  return dedupePaths(
    parseRegistryEntries(output)
      .filter((entry) => entry.data.toLowerCase().includes('wuthering'))
      .filter((entry) => entry.name.toLowerCase().includes('client-win64-shipping.exe'))
      .map((entry) => extractInstallPathFromExecutable(entry.name))
      .filter((path): path is string => Boolean(path))
  )
}

/**
 * @description 从防火墙规则中收集鸣潮安装目录。
 * @returns 解析出的安装目录列表。
 */
async function collectFirewallCandidates(): Promise<string[]> {
  const output = await queryRegistry([
    'query',
    'HKLM\\SYSTEM\\CurrentControlSet\\Services\\SharedAccess\\Parameters\\FirewallPolicy\\FirewallRules',
    '/s'
  ])

  return dedupePaths(
    parseRegistryEntries(output)
      .filter((entry) => entry.data.toLowerCase().includes('wuthering'))
      .filter((entry) => entry.data.toLowerCase().includes('client-win64-shipping'))
      .map((entry) => {
        const appMatch = entry.data.match(/(?:^|\|)App=([^|]+Client-Win64-Shipping\.exe)/iu)
        return appMatch?.[1] ? extractInstallPathFromExecutable(appMatch[1]) : null
      })
      .filter((path): path is string => Boolean(path))
  )
}

/**
 * @description 解析卸载注册表块内容。
 * @param output 卸载项查询输出。
 * @returns 命中鸣潮的安装目录列表。
 */
function parseUninstallRegistryOutput(output: string): string[] {
  return dedupePaths(
    output
      .split(/\r?\n\r?\n+/u)
      .map((block) => parseRegistryEntries(block))
      .map((entries) => {
        const displayName = entries.find((entry) => entry.name === 'DisplayName')?.data || ''
        const installPath = entries.find((entry) => entry.name === 'InstallPath')?.data || ''

        if (!displayName.toLowerCase().includes('wuthering') || !installPath.trim()) {
          return null
        }

        return normalizeInstallPath(installPath)
      })
      .filter((path): path is string => Boolean(path))
  )
}

/**
 * @description 从卸载注册表项中收集原生客户端安装目录。
 * @returns 解析出的安装目录列表。
 */
async function collectUninstallCandidates(): Promise<string[]> {
  const [native64Output, native32Output] = await Promise.all([
    queryRegistry(['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall', '/s']),
    queryRegistry([
      'query',
      'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      '/s'
    ])
  ])

  return dedupePaths([
    ...parseUninstallRegistryOutput(native64Output),
    ...parseUninstallRegistryOutput(native32Output)
  ])
}

/**
 * @description 组合自动扫描所需的全部安装目录候选。
 * @returns 去重后的自动扫描目录列表。
 */
async function collectAutomaticInstallCandidates(): Promise<string[]> {
  const [driveRoots, muiCachePaths, firewallPaths, uninstallPaths] = await Promise.all([
    listAvailableDriveRoots(),
    collectMuiCacheCandidates(),
    collectFirewallCandidates(),
    collectUninstallCandidates()
  ])

  return dedupePaths([
    ...muiCachePaths,
    ...firewallPaths,
    ...uninstallPaths,
    ...driveRoots.flatMap((driveRoot) => buildCommonInstallCandidatesForDrive(driveRoot))
  ])
}

/**
 * @description 扩展手动输入的安装目录候选，兼容用户输入父目录或游戏目录。
 * @param gamePath 页面传入的手动目录。
 * @returns 去重后的候选目录列表。
 */
function expandManualInstallCandidates(gamePath: string): string[] {
  const normalizedPath = normalizeInstallPath(gamePath)

  if (!normalizedPath) {
    return []
  }

  if (basename(normalizedPath).toLowerCase() === 'wuthering waves game') {
    return [normalizedPath]
  }

  return dedupePaths([normalizedPath, join(normalizedPath, 'Wuthering Waves Game')])
}

/**
 * @description 在指定安装目录下探测可读取的日志文件。
 * @param installPath 单个安装目录候选。
 * @returns 命中的日志文件描述列表。
 */
async function collectLogFilesFromInstallPath(installPath: string): Promise<LogFileDescriptor[]> {
  const clientLogPath = join(installPath, 'Client', 'Saved', 'Logs', CLIENT_LOG_NAME)
  const debugLogPath = join(
    installPath,
    'Client',
    'Binaries',
    'Win64',
    'ThirdParty',
    'KrPcSdk_Global',
    'KRSDKRes',
    'KRSDKWebView',
    DEBUG_LOG_NAME
  )

  const candidates: Array<{ path: string; type: LogFileType }> = [
    { path: clientLogPath, type: 'client' },
    { path: debugLogPath, type: 'debug' }
  ]

  const results = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        if (!(await pathExists(candidate.path))) {
          return null
        }

        const fileStat = await stat(candidate.path)
        return {
          path: candidate.path,
          type: candidate.type,
          lastModifiedMs: fileStat.mtimeMs
        } satisfies LogFileDescriptor
      } catch (error) {
        void logger.warn(
          'main',
          'gacha-url-log-stat-failed',
          'Failed to inspect candidate log file during URL scan',
          {
            installPath,
            logPath: candidate.path,
            logType: candidate.type,
            error: error instanceof Error ? error.message : String(error)
          }
        )
        return null
      }
    })
  )

  return results.filter((item): item is LogFileDescriptor => Boolean(item))
}

/**
 * @description 从多个安装目录候选中收集并去重日志文件。
 * @param installPaths 安装目录候选集合。
 * @returns 按修改时间倒序排列的日志文件列表。
 */
async function collectLogFilesFromInstallPaths(
  installPaths: string[]
): Promise<LogFileDescriptor[]> {
  const groups = await Promise.all(
    installPaths.map((installPath) => collectLogFilesFromInstallPath(installPath))
  )
  const seen = new Set<string>()

  return groups
    .flat()
    .filter((item) => {
      const key = toPathKey(item.path)
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
    .sort((left, right) => right.lastModifiedMs - left.lastModifiedMs)
}

/**
 * @description 从文本中提取最新的抽卡历史链接。
 * @param content 日志文本。
 * @returns 命中的链接；未命中时返回 `null`。
 */
function extractLatestConveneUrl(content: string): string | null {
  const matches = [...content.matchAll(CONVENE_URL_PATTERN)]
  return matches.length > 0 ? matches[matches.length - 1][0] : null
}

/**
 * @description 将加密的 Client.log 内容按原脚本逻辑执行 XOR 解码。
 * @param buffer 原始日志字节。
 * @returns 解码后的 UTF-8 文本。
 */
function decryptClientLogBuffer(buffer: Buffer): string {
  const decoded = Buffer.from(buffer)

  for (let index = 0; index < decoded.length; index += 1) {
    const byte = decoded[index]
    decoded[index] = ((byte & 0x0f) % 2 === 1 ? byte ^ 0xa5 : byte ^ 0xef) & 0xff
  }

  return decoded.toString('utf8')
}

/**
 * @description 从单个日志文件中尝试提取抽卡链接。
 * @param logFile 待解析的日志文件描述。
 * @returns 命中的链接；若该日志未包含链接则返回 `null`。
 */
async function extractUrlFromLogFile(logFile: LogFileDescriptor): Promise<string | null> {
  try {
    const buffer = await readFile(logFile.path)

    if (logFile.type === 'client') {
      return (
        extractLatestConveneUrl(decryptClientLogBuffer(buffer)) ||
        extractLatestConveneUrl(buffer.toString('utf8'))
      )
    }

    const content = buffer.toString('utf8')
    const matches = [...content.matchAll(DEBUG_URL_PATTERN)]
    return matches.length > 0 ? matches[matches.length - 1][1] : null
  } catch (error) {
    void logger.warn(
      'main',
      'gacha-url-log-read-failed',
      'Failed to read candidate log file during URL scan',
      {
        logPath: logFile.path,
        logType: logFile.type,
        error: error instanceof Error ? error.message : String(error)
      }
    )
    return null
  }
}

/**
 * @description 按时间顺序遍历候选日志并返回首个可用链接。
 * @param logFiles 已排序的日志文件列表。
 * @returns 命中的链接；若所有日志都未命中则返回 `null`。
 */
async function resolveUrlFromLogFiles(logFiles: LogFileDescriptor[]): Promise<string | null> {
  for (const logFile of logFiles) {
    const url = await extractUrlFromLogFile(logFile)
    if (url) {
      return url
    }
  }

  return null
}

/**
 * @description 获取鸣潮抽卡记录链接。
 * @param request 可选请求参数；传入 `gamePath` 时只扫描该目录。
 * @returns 供 renderer 展示的结构化结果。
 * @remarks 该实现只复刻可自动化的扫描与提取逻辑，不做提权、脚本交互或系统修改。
 */
export async function getGachaUrl(request?: GachaUrlRequest): Promise<GachaUrlResult> {
  if (process.platform !== 'win32') {
    return createResult(false, null, '当前仅支持在 Windows 上获取抽卡链接。', false)
  }

  const manualPath = normalizeInstallPath(request?.gamePath || '')

  const installPaths = manualPath
    ? expandManualInstallCandidates(manualPath)
    : await collectAutomaticInstallCandidates()

  if (installPaths.length === 0) {
    return createResult(
      false,
      null,
      manualPath
        ? '未找到可用的游戏安装目录，请确认手动输入的路径是否正确。'
        : '自动获取失败，请手动填写游戏安装目录后重试。',
      true
    )
  }

  const logFiles = await collectLogFilesFromInstallPaths(installPaths)

  if (logFiles.length === 0) {
    return createResult(
      false,
      null,
      manualPath
        ? '该目录下没有找到可用日志，请先打开游戏内抽卡记录页后再重试。'
        : '自动扫描没有找到可用日志，请先打开游戏内抽卡记录页，或手动填写游戏安装目录。',
      true
    )
  }

  const url = await resolveUrlFromLogFiles(logFiles)

  if (!url) {
    return createResult(
      false,
      null,
      manualPath
        ? '已找到日志，但未提取到抽卡链接。请先在游戏内打开抽卡记录页后再重试。'
        : '自动扫描找到了日志，但未提取到抽卡链接。请先打开游戏内抽卡记录页，或手动填写游戏安装目录。',
      true
    )
  }

  return createResult(true, url, '已成功获取抽卡链接。', false)
}
