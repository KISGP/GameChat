import MiniSearch from 'minisearch'
import type { LogAdapter } from '../adapters'
import { createSingleLazyPromise } from '../infra/fs'
import { tokenize } from '../infra/tokenize'
import { loadWorldIndexFile, type WorldIndexScene, type WorldIndexTerm } from './world-index'

/**
 * @description 场景标题检索权重。
 * @remarks 检索台实验定稿（对齐 utils 常量纪律），非用户设置；权重只表达字段间相对比例。
 */
const SCENE_TITLE_WEIGHT = 0.25

/**
 * @description 场景摘要检索权重。
 * @remarks 检索台实验定稿：摘要是话题语言载体，承担模糊查询的主要召回。
 */
const SCENE_SUMMARY_WEIGHT = 2

/**
 * @description 词条名检索权重。
 * @remarks 检索台实验定稿：词条名即触发键，命中即强信号。
 */
const TERM_NAME_WEIGHT = 5

/**
 * @description 单次检索返回的剧情场景条数上限。
 * @remarks 内部策略常量（对齐 MAX_TOOL_ROUNDS 先例），临时值；检索结果统一经工具证据消化节点
 *   整理后才进终答上下文，条数只约束消化调用的输入规模，冒烟后随消化质量调整。
 */
const SEARCH_SCENE_LIMIT = 8

/**
 * @description 单次检索返回的名词解释条数上限。
 * @remarks 同 {@link SEARCH_SCENE_LIMIT} 的消化预算逻辑。
 */
const SEARCH_TERM_LIMIT = 5

/** 单次 search_world 检索的结果。 */
export type WorldSearchResult = {
  /** 原样返回的查询文本。 */
  query: string
  /** 按相关度截断的剧情场景。 */
  scenes: WorldIndexScene[]
  /** 按相关度截断的名词解释。 */
  terms: WorldIndexTerm[]
}

/** 索引文档：条目下标字符串与参与匹配的字段。 */
type SceneIndexDoc = { indexId: string; title: string; summary: string }
type TermIndexDoc = { indexId: string; term: string }

/** 预构建的检索快照：索引条目与对应的 BM25 检索索引实例。 */
type WorldSearchSnapshot = {
  scenes: WorldIndexScene[]
  terms: WorldIndexTerm[]
  sceneIndex: MiniSearch<SceneIndexDoc>
  termIndex: MiniSearch<TermIndexDoc>
}

/** 场景索引构建选项：标题与摘要两字段，字段加权在查询时经 boost 表达。 */
function createSceneIndex(): MiniSearch<SceneIndexDoc> {
  return new MiniSearch<SceneIndexDoc>({
    idField: 'indexId',
    fields: ['title', 'summary'],
    tokenize,
    processTerm: (term: string) => term
  })
}

/** 词条索引构建选项：只索引词条名。 */
function createTermIndex(): MiniSearch<TermIndexDoc> {
  return new MiniSearch<TermIndexDoc>({
    idField: 'indexId',
    fields: ['term'],
    tokenize,
    processTerm: (term: string) => term
  })
}

/**
 * @description 对 world.json 派生索引执行 BM25 检索，索引实例按快照缓存。
 * @remarks 索引装载与检索索引构建共用一个惰性快照，唯一写者是 World 同步的整目录交换提交，
 *   提交后经 WorldService.invalidate 失效；读取侧不做漂移检测。索引缺失或损坏时检索降级为
 *   空结果并记日志，由模型按「查不到」路径自然回应。检索面只含标题、摘要与词条名
 *   （对白原文不参与匹配、仅随结果返回）；零分文档不进结果。
 */
export class WorldSearchService {
  private readonly snapshot: ReturnType<typeof createSingleLazyPromise<WorldSearchSnapshot>>
  private readonly indexPath: string
  private readonly log: LogAdapter

  /**
   * @description 创建 world 检索服务。
   * @param deps 宿主依赖：派生索引文件路径与日志出口。
   */
  constructor(deps: { indexPath: string; log: LogAdapter }) {
    this.indexPath = deps.indexPath
    this.log = deps.log
    this.snapshot = createSingleLazyPromise<WorldSearchSnapshot>(async () => {
      const file = await loadWorldIndexFile(deps.indexPath)
      const sceneIndex = createSceneIndex()
      sceneIndex.addAll(
        file.story.map((scene, index) => ({
          indexId: String(index),
          title: scene.title,
          summary: scene.summary
        }))
      )
      const termIndex = createTermIndex()
      termIndex.addAll(
        file.glossary.map((term, index) => ({ indexId: String(index), term: term.term }))
      )
      return { scenes: file.story, terms: file.glossary, sceneIndex, termIndex }
    })
  }

  /**
   * @description 按自然语言查询检索背景剧情场景与名词解释。
   * @param query 模型从用户话提炼的查询文本。
   * @returns 场景与词条的 BM25 检索结果；索引不可用或零命中时对应数组为空。
   * @remarks 字段加权经查询期 boost 表达；结果按下标映射回快照原始条目并截断到上限。
   */
  async search(query: string): Promise<WorldSearchResult> {
    let snapshot: WorldSearchSnapshot
    try {
      snapshot = await this.snapshot.get()
    } catch (error) {
      this.log.error(
        'world',
        'world-search-unavailable',
        'World index is unavailable; search degrades to empty',
        {
          filePath: this.indexPath,
          error: error instanceof Error ? error.message : String(error)
        }
      )
      return { query, scenes: [], terms: [] }
    }
    const sceneHits = snapshot.sceneIndex
      .search(query, { boost: { title: SCENE_TITLE_WEIGHT, summary: SCENE_SUMMARY_WEIGHT } })
      .slice(0, SEARCH_SCENE_LIMIT)
    const termHits = snapshot.termIndex
      .search(query, { boost: { term: TERM_NAME_WEIGHT } })
      .slice(0, SEARCH_TERM_LIMIT)
    return {
      query,
      scenes: sceneHits.flatMap((hit) => pickByIndexId(snapshot.scenes, hit.id)),
      terms: termHits.flatMap((hit) => pickByIndexId(snapshot.terms, hit.id))
    }
  }

  /**
   * @description 丢弃检索快照，使下一次检索重新装载索引。
   */
  invalidate(): void {
    this.snapshot.invalidate()
  }
}

/**
 * @description 按索引标识取回快照中的原始条目。
 * @param items 快照装载时的原始条目数组。
 * @param id 索引构建时写入的数组下标字符串。
 * @returns 单元素数组；下标越界时为空数组。
 */
function pickByIndexId<T>(items: readonly T[], id: string): T[] {
  const index = Number(id)
  return index >= 0 && index < items.length ? [items[index]] : []
}
