export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogSource =
  | 'main'
  | 'renderer'
  | 'ipc'
  | 'ai'
  | 'core'
  | 'characters'
  | 'world'
  | 'memory'
  | 'settings'
  | 'tts'
  | 'updater'
  | 'window'

export type LogContext = Record<string, unknown>

export type LogEntry = {
  timestamp: string
  level: LogLevel
  source: LogSource
  event: string
  message: string
  context?: LogContext
  rawLine?: string
}

export type RendererLogEventPayload = {
  level?: Exclude<LogLevel, 'debug'>
  source: Extract<LogSource, 'renderer'>
  event: string
  message: string
  context?: LogContext
}

export type LogViewerState = {
  directoryPath: string
  filePath: string
  exists: boolean
  sizeBytes: number
  updatedAt: string | null
}
