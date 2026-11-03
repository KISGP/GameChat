/**
 * @description core 基础设施：原子文件读写与容错读取。
 * @remarks 并发原语归 infra/concurrency，本模块再导出以维持既有导入路径稳定；
 *   单文件原子写基于 write-file-atomic（临时文件 + rename + 失败清理），目录级交换为本模块实现。
 */
import { mkdir, readFile, rename, rm, stat } from 'fs/promises'
import { dirname } from 'path'
import writeFileAtomicLib from 'write-file-atomic'
import { logger } from './log'

export {
  createSingleLazyPromise,
  createKeyedLazyPromise,
  createSingleFlight,
  createSerialQueue,
  type SerialQueue,
  type SerialQueueHandle
} from './concurrency'

/**
 * @description 将 JSON 内容原子写入目标路径。
 * @param targetPath 目标文件路径。
 * @param data 可序列化内容。
 * @param space 可选的缩进空格数；省略时使用 2 空格缩进，传 0 写出紧凑 JSON。
 * @returns 写入完成后的 Promise。
 * @remarks 自动创建父目录；写入失败时目标路径保持原值。
 */
export async function writeJsonFileAtomic(
  targetPath: string,
  data: unknown,
  space = 2
): Promise<void> {
  await writeFileAtomic(targetPath, JSON.stringify(data, null, space))
}

/**
 * @description 将文本或二进制内容原子写入目标路径。
 * @param targetPath 目标文件路径。
 * @param data 待写入的文本或二进制内容。
 * @returns 写入完成后的 Promise。
 * @remarks 自动创建父目录；底层经 write-file-atomic 以同目录临时文件加 rename 提交，
 *   读取方不会看到半写状态，写入失败时目标路径保持原值。
 */
export async function writeFileAtomic(
  targetPath: string,
  data: string | Uint8Array
): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true })
  await writeFileAtomicLib(targetPath, typeof data === 'string' ? data : Buffer.from(data))
}

/**
 * @description 读取 JSON 文件：缺失返回 null，损坏记警告并返回 null（由调用方降级）。
 * @param filePath 目标文件路径。
 * @returns 解析后的 JSON；文件缺失或损坏时为 null。
 */
export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await readFile(filePath, 'utf8')
    return JSON.parse(content) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[gamechat-core] Failed to read JSON file: ${filePath}`, error)
    }
    return null
  }
}

/**
 * @description 判断路径是否存在。
 * @param filePath 目标路径。
 * @returns 存在时返回 true。
 */
export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * @description 将一个已完整生成的临时文件原子替换到目标路径。
 * @param tempPath 已写入完整内容的临时文件路径。
 * @param targetPath 目标文件路径。
 * @returns 替换完成后的 Promise。
 * @remarks 替换失败时删除临时文件并抛出原始错误；替换成功后临时文件不复存在。
 */
export async function replaceFileAtomic(tempPath: string, targetPath: string): Promise<void> {
  try {
    await rm(targetPath, { force: true })
    await rename(tempPath, targetPath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch((cleanupError: unknown) => {
      void logger.warn('core', 'atomic-replace-cleanup-failed', 'Failed to clean temporary file', {
        tempPath,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      })
    })
    throw error
  }
}

/**
 * @description 通过目录交换将暂存目录原子提交为目标目录，失败时回滚旧目录。
 * @param stagingPath 已写入完整内容的暂存目录路径。
 * @param targetPath 目标目录路径。
 * @returns 提交完成后的 Promise。
 * @remarks 目标目录存在时先改名备份再交换；交换失败恢复备份并抛出原始错误，备份清理失败仅记录日志。
 */
export async function swapDirectoryAtomic(stagingPath: string, targetPath: string): Promise<void> {
  if (!(await pathExists(targetPath))) {
    await rename(stagingPath, targetPath)
    return
  }

  const backupPath = `${targetPath}.backup-${process.pid}-${Date.now()}`
  await rename(targetPath, backupPath)
  try {
    await rename(stagingPath, targetPath)
  } catch (error) {
    try {
      await rename(backupPath, targetPath)
    } catch (restoreError) {
      void logger.error(
        'core',
        'atomic-directory-restore-failed',
        'Failed to restore directory after failed swap',
        {
          targetPath,
          backupPath,
          error: restoreError instanceof Error ? restoreError.message : String(restoreError)
        }
      )
    }
    throw error
  }

  await rm(backupPath, { recursive: true, force: true }).catch((cleanupError: unknown) => {
    void logger.warn('core', 'atomic-backup-cleanup-failed', 'Failed to clean backup directory', {
      backupPath,
      error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
    })
  })
}
