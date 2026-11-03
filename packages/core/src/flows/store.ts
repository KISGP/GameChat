/**
 * @description 流程包存储：通用流程包的落盘、列表与当前流程解析。
 * @remarks 经 {@link createFlowPackageStore} 构造，应用数据根目录、内置资源目录与日志出口由宿主注入；
 *   用户流程固定落在 `<appDataRoot>/flows/<id>.json`，内置流程从
 *   `<builtinDir>/<id>.json` 读取。存储层只认结构合法的流程包，写入前过归一化；
 *   内置 standard 只读，save/delete 一律拒绝。
 */
import { mkdir, readFile, readdir, rm } from 'fs/promises'
import { join } from 'path'
import type { FlowPackage, FlowPackageSummary } from '@gamechat/type'
import { FLOW_STANDARD_ID } from '@gamechat/type'
import { normalizeFlowPackage } from '@gamechat/schema'
import type { LogAdapter } from '../adapters'
import { assertPathSegment } from '../infra/path'
import { pathExists, writeFileAtomic } from '../infra/fs'

/** 流程存储相对应用数据根的子路径。 */
const FLOWS_SUBPATH = 'flows'

/** 流程包存储的宿主依赖。 */
export type FlowPackageStoreDeps = {
  /** 应用数据根目录：流程目录的落盘基准。 */
  appDataRoot: () => string
  /** 内置流程资源根目录。 */
  builtinDir: string
  /** 日志出口：删除与读取失败经此记录。 */
  log: LogAdapter
}

/** 流程包存储：声明式流程包的持久化面。 */
export type FlowPackageStore = {
  /** 归一化并保存一个用户流程包；同 ID 覆盖，拒绝 standard。结构非法时抛出。 */
  save: (raw: unknown) => Promise<FlowPackage>
  /** 列出全部流程包摘要：内置 standard 在首位，用户流程按文件名排序；用户目录缺失视为空列表。 */
  list: () => Promise<FlowPackageSummary[]>
  /** 读取一个流程包；standard 读内置资源，其余读用户目录。缺失或损坏时抛出。 */
  load: (id: string) => Promise<FlowPackage>
  /** 删除一个用户流程包；拒绝 standard，文件不存在时静默完成。 */
  delete: (id: string) => Promise<void>
}

/**
 * @description 创建流程包存储实例。
 * @param deps 宿主依赖：应用数据根目录、内置资源目录与日志出口。
 * @returns 流程包存储实例。
 */
export function createFlowPackageStore(deps: FlowPackageStoreDeps): FlowPackageStore {
  /**
   * @description 解析用户流程目录。
   * @returns 用户流程目录绝对路径。
   */
  function userFlowsDir(): string {
    return join(deps.appDataRoot(), FLOWS_SUBPATH)
  }

  /**
   * @description 解析内置流程目录。
   * @returns 内置流程目录绝对路径。
   */
  function builtinFlowsDir(): string {
    return deps.builtinDir
  }

  /**
   * @description 校验流程标识为安全的单段路径片段。
   * @param id 用户输入的流程标识。
   * @returns 规范化后的文件名（不含扩展名）。
   * @throws 含路径分隔符或非法字符时抛出。
   */
  function assertFlowId(id: string): string {
    const trimmed = id.trim()
    assertPathSegment(trimmed, 'flow id')
    return trimmed
  }

  /**
   * @description 读取并归一化一个流程包文件。
   * @param path 流程包文件绝对路径。
   * @param id 流程标识（用于错误信息）。
   * @returns 结构合法的流程包。
   * @throws 文件缺失、JSON 损坏、结构非法或包内 id 与请求 id 不一致时抛出。
   * @remarks id 一致性是只读保护与内置判定的前提：包内 id 与文件名错位会让 standard
   *   判定失效，保存拒绝与回退逻辑随之失守，因此读取边界直接拒绝。
   */
  async function readPackage(path: string, id: string): Promise<FlowPackage> {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    const pkg = normalizeFlowPackage(parsed)
    if (!pkg) {
      throw new Error(`Invalid flow package: ${id}`)
    }
    if (pkg.id !== id) {
      throw new Error(`Flow package id mismatch: expected ${id}, got ${pkg.id}`)
    }
    return pkg
  }

  /**
   * @description 读取用户目录下的一个流程包。
   * @param id 已校验的流程标识。
   * @returns 结构合法的流程包。
   */
  function readUserPackage(id: string): Promise<FlowPackage> {
    return readPackage(join(userFlowsDir(), `${id}.json`), id)
  }

  /**
   * @description 读取内置目录下的一个流程包。
   * @param id 已校验的流程标识。
   * @returns 结构合法的流程包。
   */
  function readBuiltinPackage(id: string): Promise<FlowPackage> {
    return readPackage(join(builtinFlowsDir(), `${id}.json`), id)
  }

  /**
   * @description 按标识读取流程包：standard 读内置资源，其余读用户目录。
   * @param id 已校验的流程标识。
   * @returns 结构合法的流程包。
   */
  function loadPackage(id: string): Promise<FlowPackage> {
    return id === FLOW_STANDARD_ID ? readBuiltinPackage(id) : readUserPackage(id)
  }

  return {
    save: async (raw) => {
      const pkg = normalizeFlowPackage(raw)
      if (!pkg) {
        throw new Error('Invalid flow package: normalization failed')
      }
      if (pkg.id === FLOW_STANDARD_ID) {
        throw new Error('The builtin standard flow is read-only.')
      }
      const id = assertFlowId(pkg.id)
      // 全新安装的用户流程目录尚不存在，先建目录再落盘。
      await mkdir(userFlowsDir(), { recursive: true })
      await writeFileAtomic(join(userFlowsDir(), `${id}.json`), JSON.stringify(pkg, null, 2))
      return pkg
    },

    list: async () => {
      const summaries: FlowPackageSummary[] = []
      try {
        const standard = await readBuiltinPackage(FLOW_STANDARD_ID)
        summaries.push({ id: standard.id, name: standard.name })
      } catch (error) {
        void deps.log.warn(
          'ai',
          'flow-builtin-unreadable',
          'Failed to read the builtin standard flow; it is omitted from the list',
          {
            error: error instanceof Error ? error.message : String(error)
          }
        )
      }
      try {
        // 用户流程目录缺失是全新安装的正常形态，视为空列表而非错误。
        if (await pathExists(userFlowsDir())) {
          const entries = await readdir(userFlowsDir(), { withFileTypes: true })
          for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith('.json')) {
              continue
            }
            const id = entry.name.replace(/\.json$/u, '')
            try {
              summaries.push({ id, name: (await readUserPackage(id)).name })
            } catch (error) {
              void deps.log.warn(
                'ai',
                'flow-package-unreadable',
                'Failed to read flow package; falling back to bare id summary',
                {
                  id,
                  error: error instanceof Error ? error.message : String(error)
                }
              )
              summaries.push({ id, name: id })
            }
          }
        }
        return summaries.sort((left, right) => left.id.localeCompare(right.id))
      } catch (error) {
        void deps.log.warn('ai', 'flow-list-unavailable', 'Failed to list flow packages', {
          error: error instanceof Error ? error.message : String(error)
        })
        // 已收集的内置 standard 摘要保留，不因用户目录读取失败整表清空。
        return summaries.sort((left, right) => left.id.localeCompare(right.id))
      }
    },

    load: async (id) => loadPackage(assertFlowId(id)),

    delete: async (id) => {
      const flowId = assertFlowId(id)
      if (flowId === FLOW_STANDARD_ID) {
        throw new Error('The builtin standard flow is read-only.')
      }
      await rm(join(userFlowsDir(), `${flowId}.json`), { force: true })
      await deps.log.info('ai', 'flow-package-deleted', 'Flow package deleted', { id: flowId })
    }
  }
}
