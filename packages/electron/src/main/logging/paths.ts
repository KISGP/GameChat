import { join } from 'path'
import { getAppDataRoot } from '../utils/path'

/**
 * @description 返回应用日志根目录。
 * @returns 日志文件所在目录。
 * @remarks 该路径解析位于启动最早期，本模块不得引入任何域级初始化依赖。
 */
export function getLogsRoot(): string {
  return join(getAppDataRoot(), 'logs')
}
