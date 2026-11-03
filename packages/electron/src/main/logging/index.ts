import { app, shell } from 'electron'
import { appendFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import type { LogContext, LogEntry, LogLevel, LogSource, LogViewerState, RendererLogEventPayload } from '@gamechat/type'
import { getLogsRoot } from './paths'
import { pathExists } from '@gamechat/core'
import { createSerialQueue, createSingleLazyPromise } from '@gamechat/core'

type LogInput = {
  level: LogLevel
  source: LogSource
  event: string
  message: string
  context?: LogContext
}

const SENSITIVE_KEYS = new Set([
  'apiKey',
  'fishApiKey',
  'apikey',
  'authorization',
  'Authorization',
  'prompt',
  'userMessage',
  'messageContent',
  'messages',
  'encryptedApiKey',
  'encryptedFishApiKey'
])

/** 键名疑似凭据的模式：精确清单之外的动态凭据键（如 api-key、accessToken）也按敏感处理。 */
const SENSITIVE_KEY_PATTERN = /(api[-_]?key|token|secret|password|authorization)/i

const writeQueue = createSerialQueue()

/** 主日志文件超过该字节数时触发轮转。 */
const MAX_LOG_FILE_BYTES = 5 * 1024 * 1024

/** 轮转后保留的历史日志份数（app.log.1、app.log.2）。 */
const MAX_LOG_BACKUP_FILES = 2

/** 主日志文件当前字节数，由 ensureLogDirectory 初始化、appendLine 累计。 */
let logFileBytes = 0

/**
 * @description 确保日志目录存在，并初始化主日志文件的字节计数。
 * @remarks 进程内仅执行一次；后续写入不再重复创建目录。
 */
const ensureLogDirectory = createSingleLazyPromise(async () => {
  await mkdir(getLogsDirectory(), { recursive: true })
  const currentStat = await stat(getLogFilePath()).catch(() => null)
  logFileBytes = currentStat?.size ?? 0
})

/**
 * @description 当主日志文件超过单文件上限时按序轮转为 app.log.1、app.log.2。
 * @remarks 超出保留份数的最旧备份直接删除；中间备份改名失败不阻断后续步骤；轮转整体失败只打印控制台。
 */
async function rotateLogIfNeeded(): Promise<void> {
  if (logFileBytes < MAX_LOG_FILE_BYTES) {
    return
  }

  const logPath = getLogFilePath()
  try {
    await unlink(`${logPath}.${MAX_LOG_BACKUP_FILES}`).catch(() => {})
    for (let index = MAX_LOG_BACKUP_FILES - 1; index >= 1; index -= 1) {
      await rename(`${logPath}.${index}`, `${logPath}.${index + 1}`).catch(() => {})
    }
    await rename(logPath, `${logPath}.1`)
    logFileBytes = 0
  } catch (error) {
    console.error('Failed to rotate log file', error)
  }
}

/**
 * @description 返回日志目录路径。
 * @returns 日志根目录。
 */
function getLogsDirectory(): string {
  return getLogsRoot()
}

/**
 * @description 返回主日志文件 app.log 的完整路径。
 * @returns 日志文件路径。
 */
function getLogFilePath(): string {
  return join(getLogsDirectory(), 'app.log')
}

/**
 * @description 递归清洗任意日志值：敏感键脱敏、长字符串截断到 500 字符、数组最多保留 20 项、对象最多保留 50 个键。
 * @param value 任意值。
 * @returns 可安全落盘的精简副本。
 */
function sanitizeValue(value: unknown): unknown {
  if (value == null) {
    return value
  }

  if (typeof value === 'string') {
    return value.length > 500 ? `${value.slice(0, 497)}...` : value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeValue(item))
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 50)
    return Object.fromEntries(
      entries.map(([key, nestedValue]) => [
        key,
        isSensitiveKey(key) ? '[redacted]' : sanitizeValue(nestedValue)
      ])
    )
  }

  return String(value)
}

/**
 * @description 判断上下文键名是否按敏感处理：精确清单命中或疑似凭据模式命中。
 * @param key 上下文键名。
 * @returns 敏感键返回 true。
 */
function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key) || SENSITIVE_KEY_PATTERN.test(key)
}

/**
 * @description 按键名决定单个上下文值的处理方式：敏感键脱敏，其余走通用清洗。
 * @param key 上下文键名。
 * @param value 对应的值。
 * @returns 处理后的值。
 */
function sanitizeByKey(key: string, value: unknown): unknown {
  if (isSensitiveKey(key)) {
    return '[redacted]'
  }

  return sanitizeValue(value)
}

/**
 * @description 清洗日志上下文对象，最多保留 50 个键并逐键应用 sanitizeByKey。
 * @param context 可选的日志上下文。
 * @returns 清洗后的上下文；入参缺失时返回 undefined。
 */
function sanitizeContext(context?: LogContext): LogContext | undefined {
  if (!context) {
    return undefined
  }

  return Object.fromEntries(
    Object.entries(context)
      .slice(0, 50)
      .map(([key, value]) => [key, sanitizeByKey(key, value)])
  ) as LogContext
}

/**
 * @description 把日志级别映射到对应的 console 方法名。
 * @param level 日志级别。
 * @returns warn、error 或 log。
 */
function toConsoleMethod(level: LogLevel): 'log' | 'warn' | 'error' {
  if (level === 'warn') return 'warn'
  if (level === 'error') return 'error'
  return 'log'
}

/**
 * @description 确保日志目录就绪后，把一行文本追加写入主日志文件并累计字节数。
 * @param line 已带换行符的日志行。
 */
async function appendLine(line: string): Promise<void> {
  await ensureLogDirectory.get()
  await appendFile(getLogFilePath(), line, 'utf-8')
  logFileBytes += Buffer.byteLength(line, 'utf-8')
}

/**
 * @description 把日志行加入串行写入队列，保证多条日志按顺序落盘，并在超过上限时轮转。
 * @param line 已带换行符的日志行。
 * @returns 本条写入完成后的 Promise。
 * @remarks 单条写入失败只打印到控制台，不会阻断后续日志。
 */
function enqueueWrite(line: string): Promise<void> {
  return writeQueue
    .enqueue(async () => {
      await appendLine(line)
      await rotateLogIfNeeded()
    })
    .promise.catch((error) => {
      console.error('Failed to write log entry', error)
    })
}

/**
 * @description 把日志条目输出到控制台；打包版只输出 error 级别。
 * @param entry 完整日志条目。
 */
function printConsole(entry: LogEntry): void {
  if (app.isPackaged && entry.level !== 'error') {
    return
  }

  const consoleMethod = toConsoleMethod(entry.level)
  console[consoleMethod](
    `[${entry.level.toUpperCase()}] ${entry.timestamp} ${entry.source}:${entry.event} ${entry.message}`,
    entry.context ?? ''
  )
}

/**
 * @description 组装带时间戳与清洗后上下文的日志条目，输出到控制台并追加到日志文件。
 * @param input 日志级别、来源、事件、消息与可选上下文。
 * @returns 文件写入完成后的 Promise。
 */
async function writeEntry(input: LogInput): Promise<void> {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level: input.level,
    source: input.source,
    event: input.event,
    message: input.message,
    context: sanitizeContext(input.context)
  }

  printConsole(entry)
  await enqueueWrite(`${JSON.stringify(entry)}\n`)
}

export const logger = {
  debug(source: LogSource, event: string, message: string, context?: LogContext): Promise<void> {
    return writeEntry({ level: 'debug', source, event, message, context })
  },
  info(source: LogSource, event: string, message: string, context?: LogContext): Promise<void> {
    return writeEntry({ level: 'info', source, event, message, context })
  },
  warn(source: LogSource, event: string, message: string, context?: LogContext): Promise<void> {
    return writeEntry({ level: 'warn', source, event, message, context })
  },
  error(source: LogSource, event: string, message: string, context?: LogContext): Promise<void> {
    return writeEntry({ level: 'error', source, event, message, context })
  },
  trackRendererEvent(payload: RendererLogEventPayload): Promise<void> {
    return writeEntry({
      level: payload.level || 'info',
      source: payload.source,
      event: payload.event,
      message: payload.message,
      context: payload.context
    })
  },
  async getViewerState(): Promise<LogViewerState> {
    const filePath = getLogFilePath()
    const exists = await pathExists(filePath)

    if (!exists) {
      return {
        directoryPath: getLogsDirectory(),
        filePath,
        exists: false,
        sizeBytes: 0,
        updatedAt: null
      }
    }

    const fileStat = await stat(filePath)

    return {
      directoryPath: getLogsDirectory(),
      filePath,
      exists: true,
      sizeBytes: fileStat.size,
      updatedAt: fileStat.mtime.toISOString()
    }
  },
  async readLogs(): Promise<LogEntry[]> {
    const filePath = getLogFilePath()
    if (!(await pathExists(filePath))) {
      return []
    }

    const content = await readFile(filePath, 'utf-8')
    return content
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          const parsed = JSON.parse(line) as LogEntry
          return parsed
        } catch {
          return {
            timestamp: '',
            level: 'warn',
            source: 'main',
            event: 'log-parse-failed',
            message: line,
            rawLine: line
          } satisfies LogEntry
        }
      })
  },
  /**
   * @description 在系统默认文本编辑器中打开当前主日志文件。
   * @remarks `shell.openPath` 返回非空错误串时记录日志并抛出，由 IPC 层向上传播给渲染层。
   */
  async openFile(): Promise<void> {
    const filePath = getLogFilePath()
    await mkdir(getLogsDirectory(), { recursive: true })
    const openErrorMessage = await shell.openPath(filePath)
    if (openErrorMessage) {
      await logger.error('main', 'log-file-open-failed', 'Failed to open log file', {
        filePath,
        error: openErrorMessage
      })
      throw new Error(openErrorMessage)
    }
  },
  async clearLogs(): Promise<void> {
    await mkdir(getLogsDirectory(), { recursive: true })
    await writeFile(getLogFilePath(), '', 'utf-8')
    logFileBytes = 0
  },
  getLogFilePath,
  getLogsDirectory
}

export { captureError } from './error-monitor'
