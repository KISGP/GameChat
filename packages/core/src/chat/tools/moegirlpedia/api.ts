import { join } from 'path'
import { logger } from '../../../infra/log'
import { getChatHost } from '../../host'
import {
  createSerialQueue,
  createSingleLazyPromise,
  getUserAgent,
  readJsonFile,
  readResponseCapped,
  request,
  writeJsonFileAtomic
} from '../../../infra'

const MOEGIRLPEDIA_API_URL = 'https://mzh.moegirl.org.cn/api.php'
const PAGE_URL_BASE = 'https://mzh.moegirl.org.cn/'
const DEFAULT_SEARCH_LIMIT = 5
const MAX_SEARCH_LIMIT = 8
/** 磁盘缓存条目的有效期：词条内容随版本缓慢更新，按周复用。 */
const DISK_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** 磁盘缓存条目上限，超出后淘汰最早过期的条目。 */
const DISK_CACHE_MAX_ENTRIES = 256

/** 所有只读 API 查询共用的参数：JSON 输出、数组形态的 pages、开放匿名跨域读取。 */
const COMMON_QUERY_PARAMS: Record<string, string> = {
  format: 'json',
  formatversion: '2',
  origin: '*'
}

/**
 * @description 构造 API 与页面视图共用的请求头。
 * @returns 带宿主品牌 User-Agent 的请求头（页面视图 WAF 放行自定义 UA，见类注释）。
 * @remarks 品牌值经 core 的 User-Agent 模块槽读取，包内不存在具体品牌名。
 */
function requestHeaders(): Record<string, string> {
  const userAgent = `${getUserAgent()} (MediaWiki API client)`
  return { 'User-Agent': userAgent, 'Api-User-Agent': userAgent }
}

export type MoeGirlpediaSearchItem = {
  title: string
  snippet: string
  pageId: number | null
  url: string
}

/** 产生本次搜索结果的实际通道：opensearch 为标题前缀匹配，fulltext 为全文相关度匹配。 */
export type MoeGirlpediaSearchChannel = 'opensearch' | 'fulltext'

export type MoeGirlpediaSearchResult = {
  channel: MoeGirlpediaSearchChannel
  items: MoeGirlpediaSearchItem[]
}

export type MoeGirlpediaPage = {
  title: string
  pageId: number | null
  content: string
  url: string
}

type JsonRecord = Record<string, unknown>

/** 磁盘缓存的单条记录：负载与其过期时间。 */
type DiskCacheEntry = {
  expiresAt: number
  payload: unknown
}

/** 磁盘缓存文件结构：键到记录的映射。 */
type DiskCacheFile = {
  entries: Record<string, DiskCacheEntry>
}

/**
 * @description 返回萌娘工具磁盘缓存文件的路径。
 * @returns 应用数据目录下缓存文件的绝对路径。
 */
function getDiskCacheFilePath(): string {
  return join(getChatHost().appDataRoot(), 'cache', 'moegirlpedia.json')
}

/**
 * @description 判断磁盘负载是否为结构可用的页面数据。
 * @param value 从磁盘读出的未受信任负载。
 * @returns 字段齐全且类型正确时返回 true。
 */
function isMoeGirlpediaPagePayload(value: unknown): value is MoeGirlpediaPage {
  if (!value || typeof value !== 'object') {
    return false
  }
  const record = value as JsonRecord
  return (
    typeof record.title === 'string' &&
    typeof record.content === 'string' &&
    typeof record.url === 'string' &&
    (record.pageId === null || typeof record.pageId === 'number')
  )
}

/**
 * @description 以匿名只读方式访问萌娘百科：API 走白名单查询通道，正文走渲染页 HTML 抓取。
 * @remarks 萌娘百科按客户端身份对 api.php 做模块级放行：标题检索走 opensearch、全文相关
 *   检索走 generator=search 均为匿名可用通道；prop=revisions 与 action=parse 对第三方客户端
 *   恒定拒绝，不得引入。页面正文走渲染页 HTML 抓取（无 API 契约）：实测页面视图的 WAF
 *   拦截主流浏览器 UA 字符串、放行自定义 UA，因此沿用品牌化 User-Agent 即可，无需伪装。
 *   正文为渲染后内容（模板表格可见），经解析链整形为模型可读文本。
 *   结果缓存为两层：进程内分钟级内存层（并发去重与同回合复用）加应用数据目录下的磁盘层
 *   （一周过期、跨启动复用），全部未命中才发起网络请求，失败请求不写入任何一层。
 */
export class MoeGirlpediaApiClient {
  /** 一级内存缓存的有效期：只服务并发去重与同回合复用，长时效复用交磁盘层。 */
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000
  /** 内存缓存条目上限，超出后丢弃最早写入的条目。 */
  private static readonly CACHE_MAX_ENTRIES = 64

  private readonly queryCache = new Map<string, { expiresAt: number; payload: unknown }>()
  private readonly pendingQueries = new Map<string, Promise<unknown>>()
  private readonly pageCache = new Map<string, { expiresAt: number; page: MoeGirlpediaPage }>()
  /** 磁盘缓存条目；首次访问时惰性加载，此后由写入方原地维护。 */
  private diskEntries: Record<string, DiskCacheEntry> | null = null
  private readonly diskLoad = createSingleLazyPromise(() => this.loadDiskCache())
  private readonly diskWriteQueue = createSerialQueue()

  /**
   * @description 搜索萌娘百科页面：先走 opensearch 标题前缀匹配，无命中或失败时回落全文检索。
   * @param query 页面标题或正文中的搜索词。
   * @param limit 返回结果数量，范围为 1 到 8。
   * @param signal 用于取消网络请求的信号。
   * @returns 标注实际通道的规范化搜索结果；opensearch 命中的条目没有摘要，全文检索的条目带摘要。
   * @remarks opensearch 是跨客户端最稳定的检索通道，但只能前缀匹配标题；查询词不是标题前缀
   *   （如复合短语）时全文检索才能命中，因此零命中与请求失败都回落全文通道。
   */
  async search(
    query: string,
    limit = DEFAULT_SEARCH_LIMIT,
    signal?: AbortSignal
  ): Promise<MoeGirlpediaSearchResult> {
    try {
      const { titles, descriptions } = await this.fetchSearchTitles(query, limit, signal)
      if (titles.length > 0) {
        return {
          channel: 'opensearch',
          items: titles.map((title, index) => ({
            title,
            snippet: descriptions[index] ?? '',
            pageId: null,
            url: this.pageUrl(title)
          }))
        }
      }
    } catch (error) {
      // opensearch 通道失效时回落全文检索；两个通道都失败时由全文检索抛出最终错误。
      void logger.warn('ai', 'moegirl-opensearch-unavailable', 'OpenSearch search failed; falling back to full-text search', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
    return { channel: 'fulltext', items: await this.fetchSearchPages(query, limit, signal) }
  }

  /**
   * @description 抓取指定页面的渲染页 HTML 并解析为正文纯文本。
   * @param title 页面标题。
   * @param signal 用于取消网络请求的信号。
   * @returns 解析后的页面标题、页面标识与正文内容。
   * @remarks 同标题经内存与磁盘两层缓存复用（磁盘层一周内跨启动）。正文锚定 mw-content-text
   *   主内容区，经解析链整形（整块移除横幅/视频小部件/导航模板与引用角标，表格按行拼接，
   *   实体解码）；锚点未命中或正文为空视为站点结构变化，抛出可读错误。
   */
  async readPage(title: string, signal?: AbortSignal): Promise<MoeGirlpediaPage> {
    const cached = this.pageCache.get(title)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.page
    }
    const diskPage = await this.readDiskEntry(`page:${title}`)
    if (isMoeGirlpediaPagePayload(diskPage)) {
      this.pageCache.set(title, { expiresAt: Date.now() + MoeGirlpediaApiClient.CACHE_TTL_MS, page: diskPage })
      return diskPage
    }
    const page = await this.fetchPage(title, signal)
    if (this.pageCache.size >= MoeGirlpediaApiClient.CACHE_MAX_ENTRIES) {
      const oldestKey = this.pageCache.keys().next().value
      if (oldestKey !== undefined) {
        this.pageCache.delete(oldestKey)
      }
    }
    this.pageCache.set(title, { expiresAt: Date.now() + MoeGirlpediaApiClient.CACHE_TTL_MS, page })
    void this.putDiskEntry(`page:${title}`, page)
    return page
  }

  /**
   * @description 加载磁盘缓存文件；缺失或损坏时降级为空缓存。
   * @returns 键到未过期记录的映射。
   * @remarks 文件按不可信输入处理：损坏日志由 readJsonFile 记录，结构不符或已过期的条目静默丢弃。
   */
  private async loadDiskCache(): Promise<Record<string, DiskCacheEntry>> {
    const stored = await readJsonFile<DiskCacheFile>(getDiskCacheFilePath())
    const entries: Record<string, DiskCacheEntry> = {}
    if (!stored || typeof stored !== 'object' || !stored.entries || typeof stored.entries !== 'object') {
      return entries
    }
    for (const [key, entry] of Object.entries(stored.entries)) {
      if (
        entry &&
        typeof entry === 'object' &&
        typeof (entry as DiskCacheEntry).expiresAt === 'number' &&
        (entry as DiskCacheEntry).expiresAt > Date.now()
      ) {
        entries[key] = { expiresAt: (entry as DiskCacheEntry).expiresAt, payload: (entry as DiskCacheEntry).payload }
      }
    }
    return entries
  }

  /**
   * @description 读取一条未过期的磁盘缓存负载，必要时先完成惰性加载。
   * @param key 缓存键。
   * @returns 命中的负载；未命中或已过期时返回 undefined。
   */
  private async readDiskEntry(key: string): Promise<unknown> {
    if (!this.diskEntries) {
      this.diskEntries = await this.diskLoad.get()
    }
    const entry = this.diskEntries[key]
    if (!entry || entry.expiresAt <= Date.now()) {
      return undefined
    }
    return entry.payload
  }

  /**
   * @description 写入一条磁盘缓存并把整份缓存经串行队列原子落盘。
   * @param key 缓存键。
   * @param payload 负载。
   * @returns 无返回值；落盘在后台完成，失败只记日志。
   * @remarks 首次写入前先完成加载，避免整文件覆盖丢失既有条目；超出上限时淘汰最早过期的条目。
   */
  private async putDiskEntry(key: string, payload: unknown): Promise<void> {
    try {
      if (!this.diskEntries) {
        this.diskEntries = await this.diskLoad.get()
      }
      const entries = this.diskEntries
      entries[key] = { expiresAt: Date.now() + DISK_CACHE_TTL_MS, payload }
      const keys = Object.keys(entries)
      if (keys.length > DISK_CACHE_MAX_ENTRIES) {
        const sorted = keys.sort((a, b) => entries[a].expiresAt - entries[b].expiresAt)
        for (const evicted of sorted.slice(0, keys.length - DISK_CACHE_MAX_ENTRIES)) {
          delete entries[evicted]
        }
      }
      const { promise } = this.diskWriteQueue.enqueue(async () => {
        await writeJsonFileAtomic(getDiskCacheFilePath(), { entries })
      })
      await promise
    } catch (error) {
      void logger.warn(
        'ai',
        'moegirlpedia-cache-write-failed',
        'Failed to persist MoeGirlpedia disk cache',
        {
          filePath: getDiskCacheFilePath(),
          error: error instanceof Error ? error.message : String(error)
        }
      )
    }
  }

  /**
   * @description 调用 opensearch 检索词条标题。
   * @param query 搜索词。
   * @param limit 结果数量上限。
   * @param signal 用于取消网络请求的信号。
   * @returns 命中的标题与对应描述数组。
   * @remarks OpenSearch 输出固定为「[查询词, 标题数组, 描述数组, URL 数组]」形态，不受
   *   formatversion 影响，因此按数组形态解析并对非字符串元素降级。
   */
  private async fetchSearchTitles(
    query: string,
    limit: number,
    signal?: AbortSignal
  ): Promise<{ titles: string[]; descriptions: string[] }> {
    const payload = await this.cachedQuery(
      { action: 'opensearch', search: query, limit, namespace: 0, redirects: 'resolve' },
      signal
    )
    const titles = Array.isArray(payload) ? payload[1] : asRecord(payload).titles
    const descriptions = Array.isArray(payload) ? payload[2] : asRecord(payload).descriptions
    return {
      titles: Array.isArray(titles) ? titles.filter(asStringFilter) : [],
      descriptions: Array.isArray(descriptions) ? descriptions.filter(asStringFilter) : []
    }
  }

  /**
   * @description 以 generator=search 全文检索页面并携带摘要。
   * @param query 搜索词。
   * @param limit 结果数量上限。
   * @param signal 用于取消网络请求的信号。
   * @returns 规范化的搜索结果。
   */
  private async fetchSearchPages(
    query: string,
    limit: number,
    signal?: AbortSignal
  ): Promise<MoeGirlpediaSearchItem[]> {
    const payload = await this.cachedQuery(
      {
        action: 'query',
        generator: 'search',
        gsrsearch: query,
        gsrlimit: limit,
        prop: 'info|extracts',
        exintro: 1,
        explaintext: 1,
        exchars: 300
      },
      signal
    )
    const queryData = asRecord(asRecord(payload).query)
    const items = Array.isArray(queryData.pages) ? queryData.pages : []
    return items.flatMap((item) => {
      const record = asRecord(item)
      const title = asString(record.title)
      if (!title) return []
      return [
        {
          title,
          snippet: stripHtml(asString(record.extract)),
          pageId: asNullableNumber(record.pageid),
          url: this.pageUrl(title)
        }
      ]
    })
  }

  /**
   * @description 抓取页面渲染页 HTML 并解析，无缓存地执行一次完整往返。
   * @param title 页面标题。
   * @param signal 用于取消网络请求的信号。
   * @returns 解析后的页面数据。
   */
  private async fetchPage(title: string, signal?: AbortSignal): Promise<MoeGirlpediaPage> {
    const url = this.pageUrl(title)
    const response = await request(url, { headers: requestHeaders(), signal, allowErrorStatus: true })
    const html = new TextDecoder().decode(await readResponseCapped(response, { url }))
    if (response.status === 404) throw new Error(`MoeGirlpedia page not found: ${title}`)
    if (!response.ok)
      throw new Error(`MoeGirlpedia page view failed: ${response.status} ${response.statusText}`)
    const extracted = extractArticleText(html)
    if (extracted.pageId === 0) throw new Error(`MoeGirlpedia page not found: ${title}`)
    if (!extracted.text)
      throw new Error(
        `MoeGirlpedia page extraction failed (page structure may have changed): ${title}`
      )
    let resolvedTitle = title
    try {
      const fromUrl = decodeURIComponent(new URL(response.url).pathname.slice(1))
      if (fromUrl) resolvedTitle = fromUrl
    } catch (error) {
      // 重定向 URL 无法解码时保留请求标题。
      void logger.warn('ai', 'moegirl-redirect-decode-failed', 'Failed to decode redirect URL title; keeping requested title', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
    if (extracted.title) resolvedTitle = extracted.title
    return {
      title: resolvedTitle,
      pageId: extracted.pageId,
      content: extracted.text,
      url: response.url
    }
  }

  /**
   * @description 缓存只读 API 查询：内存层去重复用，磁盘层一周内跨启动复用。
   * @param parameters MediaWiki action 参数。
   * @param signal 用于取消网络请求的信号。
   * @returns 未加工的 JSON 响应值。
   * @remarks 同键并发请求共享同一次往返，失败的请求不写入任何一层缓存；缓存键包含完整参数，
   *   通道之间互不污染。
   */
  private async cachedQuery(
    parameters: Record<string, string | number>,
    signal?: AbortSignal
  ): Promise<unknown> {
    const cacheKey = JSON.stringify(parameters)
    const cached = this.queryCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.payload
    }
    const diskPayload = await this.readDiskEntry(cacheKey)
    if (diskPayload !== undefined) {
      this.queryCache.set(cacheKey, {
        expiresAt: Date.now() + MoeGirlpediaApiClient.CACHE_TTL_MS,
        payload: diskPayload
      })
      return diskPayload
    }
    const pending = this.pendingQueries.get(cacheKey)
    if (pending) {
      return pending
    }
    const flight = this.request(parameters, signal)
      .then((payload) => {
        if (this.queryCache.size >= MoeGirlpediaApiClient.CACHE_MAX_ENTRIES) {
          const oldestKey = this.queryCache.keys().next().value
          if (oldestKey !== undefined) {
            this.queryCache.delete(oldestKey)
          }
        }
        this.queryCache.set(cacheKey, {
          expiresAt: Date.now() + MoeGirlpediaApiClient.CACHE_TTL_MS,
          payload
        })
        void this.putDiskEntry(cacheKey, payload)
        return payload
      })
      .finally(() => {
        this.pendingQueries.delete(cacheKey)
      })
    this.pendingQueries.set(cacheKey, flight)
    return flight
  }

  /**
   * @description 发送一次匿名只读 MediaWiki GET 请求。
   * @param parameters MediaWiki action 参数。
   * @param signal 用于取消网络请求的信号。
   * @returns 未加工的 JSON 响应值。
   * @remarks 出站请求经 utils/http 的系统网络栈，带品牌化 User-Agent；API 层错误转换为异常抛出。
   */
  private async request(
    parameters: Record<string, string | number>,
    signal?: AbortSignal
  ): Promise<unknown> {
    const query = new URLSearchParams(COMMON_QUERY_PARAMS)
    Object.entries(parameters).forEach(([key, value]) => query.set(key, String(value)))
    const response = await request(`${MOEGIRLPEDIA_API_URL}?${query.toString()}`, {
      headers: requestHeaders(),
      signal
    })
    const body = await readResponseCapped(response, { url: response.url })
    let payload: unknown
    try {
      payload = JSON.parse(new TextDecoder().decode(body))
    } catch (error) {
      throw new Error(
        `MoeGirlpedia returned invalid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
    const apiError = asRecord(asRecord(payload).error)
    if (Object.keys(apiError).length > 0)
      throw new Error(
        `MoeGirlpedia API error: ${asString(apiError.info) || asString(apiError.code)}`
      )
    return payload
  }

  /**
   * @description 返回页面的公开 URL。
   * @param title 页面标题。
   * @returns 页面 URL。
   */
  private pageUrl(title: string): string {
    return PAGE_URL_BASE + encodeURIComponent(title).replace(/%2F/gu, '/')
  }
}

/**
 * @description 解码 HTML 命名实体与数字/十六进制字符引用（如 &#91; → [）。
 * @param value 含实体的文本。
 * @returns 解码后的文本。
 * @remarks 未知实体原样保留，无效码位不转换，避免抛错。
 */
function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#[0-9]+|#x[0-9a-fA-F]+|[a-z][a-z0-9]*);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const num = /^#x/i.test(code) ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isInteger(num) && num > 0 && num <= 0x10ffff
        ? String.fromCodePoint(num)
        : match
    }
    return { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[code.toLowerCase()] ?? match
  })
}

/**
 * @description 从 startTagIdx 起删除一个同名标签配对的完整元素（按开闭标签平衡扫描，嵌套安全）。
 * @param html 待处理的 HTML。
 * @param startTagIdx 开标签起始位置。
 * @param tag 标签名。
 * @returns 删除后的 HTML；未找到配对闭合时原样返回。
 */
function removeBalancedTag(html: string, startTagIdx: number, tag: string): string {
  const re = new RegExp(`</?${tag}\\b`, 'gi')
  re.lastIndex = startTagIdx
  let depth = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(html))) {
    depth += match[0][1] === '/' ? -1 : 1
    if (depth === 0) return html.slice(0, startTagIdx) + html.slice(match.index + match[0].length)
  }
  return html
}

/**
 * @description 删除正文中所有开标签匹配指定正则的元素（配对平衡，嵌套安全）。
 * @param body 待处理的内容区 HTML。
 * @param tagPattern 完整开标签的匹配正则。
 * @param tag 标签名。
 * @returns 删除后的内容区 HTML。
 * @remarks 用正则匹配完整开标签而非 class 子串定位：小部件的容器标签带长串 data-* 属性，
 *   class 可能远离标签头。
 */
function removeElementsMatching(body: string, tagPattern: RegExp, tag: string): string {
  for (;;) {
    const match = body.match(tagPattern)
    if (!match || match.index === undefined) return body
    const next = removeBalancedTag(body, match.index, tag)
    if (next === body) return body
    body = next
  }
}

/**
 * @description 从渲染页 HTML 提取主内容区纯文本：标题转章节标记、表格按行拼接单元格。
 * @param html 渲染页完整 HTML。
 * @returns 提取的正文文本、从页面脚本读到的页面标识与页面主标题。
 * @remarks 锚点 indexOf 命中的是标签内部，必须先推进到标签闭合的 > 之后再切，否则标签残余
 *   会成为正文首行。顶部横幅（div.infoBox）、视频小部件（div.bilibili-video-container）与
 *   尾部导航模板（table.navbox）是版式噪音，在文本转换前整块移除；infobox 为 div-flex
 *   结构而非 table，键值分行属正常形态。锚点/类名会随站点改版静默失效，调用方必须把
 *   空提取视为错误。
 */
function extractArticleText(html: string): { text: string; pageId: number | null; title: string } {
  const anchor = html.indexOf('id="mw-content-text"')
  if (anchor === -1) return { text: '', pageId: null, title: '' }
  const start = html.indexOf('>', anchor) + 1
  let end = html.indexOf('id="catlinks"', start)
  if (end === -1) end = html.indexOf('class="printfooter"', start)
  if (end === -1) end = html.length
  const idMatch = html.match(/"wgArticleId":\s*(\d+)/) || html.match(/wgArticleId\s*=\s*(\d+)/)
  const headingMatch = html.match(/<h1[^>]*id="firstHeading"[^>]*>([\s\S]*?)<\/h1>/i)
  let body = html.slice(start, end)
  body = body
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
  body = removeElementsMatching(body, /<div[^>]*class="[^"]*infoBox/i, 'div')
  body = removeElementsMatching(body, /<div[^>]*bilibili-video-container/i, 'div')
  const navboxMatch = body.match(/<table[^>]*navbox[^>]*>/i)
  if (navboxMatch && navboxMatch.index !== undefined && navboxMatch.index > 0)
    body = body.slice(0, navboxMatch.index)
  body = body
    .replace(/<span class="mw-editsection"[\s\S]*?<\/span>/gi, '')
    .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, '')
    .replace(/<ol class="references[^>]*>[\s\S]*?<\/ol>/gi, '')
  body = body.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_match, row: string) => {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((cell) =>
        cell[1]
          .replace(/<br\s*\/?>/gi, '／')
          .replace(/<[^>]+>/g, '')
          .replace(/\s+/gu, ' ')
          .trim()
      )
      .filter(Boolean)
    return `\n${cells.join(' | ')}\n`
  })
  body = body
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n== $1 ==\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n=== $1 ===\n')
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n==== $1 ====\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|div|dd|dt|ul|ol|figcaption|h5|h6)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  return {
    text: decodeHtmlEntities(body)
      .split('\n')
      .map((line) =>
        line
          .replace(/^>+\s*/u, '')
          .replace(/[ \t\u3000]+/gu, ' ')
          .replace(/\s*\|\s*$/u, '')
          .trim()
      )
      .filter(Boolean)
      .join('\n'),
    pageId: idMatch ? Number(idMatch[1]) : null,
    title: headingMatch ? headingMatch[1].replace(/<[^>]+>/g, '').trim() : ''
  }
}

/**
 * @description 将未知值转换为结构化对象。
 * @param value 待转换的未知值。
 * @returns 对象值，否则返回空对象。
 */
function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {}
}

/**
 * @description 从未知值中读取字符串。
 * @param value 待转换的未知值。
 * @returns 字符串值，否则返回空字符串。
 */
function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * @description 判断未知值是否为字符串，供数组过滤使用。
 * @param value 待判断的数组元素。
 * @returns 字符串值时返回 true。
 */
function asStringFilter(value: unknown): value is string {
  return typeof value === 'string'
}

/**
 * @description 从未知值中读取可空数字。
 * @param value 待转换的未知值。
 * @returns 有限数字，否则返回 null。
 */
function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * @description 将搜索摘要中的 HTML 转换为纯文本。
 * @param value MediaWiki 返回的 HTML 摘要。
 * @returns 可安全交给模型阅读的纯文本。
 */
function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/gu, '')
    .replace(/&nbsp;/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .trim()
}

export { DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT }
