import { join } from 'path'
import { app } from 'electron'

/**
 * @description 返回统一设置文件的持久化路径。
 * @returns settings.json 的绝对路径。
 * @remarks 与设置存储引擎的写入位置一致，位于 userData 根目录。
 */
export function getSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}
