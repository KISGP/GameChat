import { readFile } from 'fs/promises'

/** 派生索引中的剧情场景条目。 */
export type WorldIndexScene = {
  /** 剧情分类，如潮汐任务、伴星任务、活动任务。 */
  category: string
  /** 任务名。 */
  task: string
  /** 场景标题。 */
  title: string
  /** 场景话题摘要；正文不足最短长度的场景为空串。 */
  summary: string
  /** 场景对白原文。 */
  text: string
}

/** 派生索引中的名词解释条目。 */
export type WorldIndexTerm = {
  /** 词条名。 */
  term: string
  /** 词条定义。 */
  definition: string
}

/** world.json 全库派生索引文件，由固定同步管线产出。 */
export type WorldIndexFile = {
  /** 索引格式版本。 */
  version: number
  /** 生成时间。 */
  generatedAt: string
  /** 剧情场景条目。 */
  story: WorldIndexScene[]
  /** 名词解释条目。 */
  glossary: WorldIndexTerm[]
}

/**
 * @description 读取并校验本地 world.json 全库派生索引。
 * @returns 通过结构校验的索引文件。
 * @throws 文件缺失、JSON 非法或条目结构不符时抛出，由调用方降级；磁盘内容按不可信输入处理。
 */
export async function loadWorldIndexFile(indexPath: string): Promise<WorldIndexFile> {
  const filePath = indexPath
  let content: string
  try {
    content = await readFile(filePath, 'utf8')
  } catch {
    throw new Error(`World index file is unavailable: ${filePath}`)
  }
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    throw new Error(`World index file is not valid JSON: ${filePath}`)
  }
  return parseWorldIndex(value, filePath)
}

/**
 * @description 校验并规范化派生索引的原始 JSON 内容。
 * @param value 已解析的索引 JSON。
 * @param filePath 来源文件路径，用于生成可诊断错误。
 * @returns 结构完整的索引文件。
 */
function parseWorldIndex(value: unknown, filePath: string): WorldIndexFile {
  if (!value || typeof value !== 'object') {
    throw new Error(`World index must be an object: ${filePath}`)
  }
  const raw = value as Record<string, unknown>
  if (typeof raw.version !== 'number' || typeof raw.generatedAt !== 'string') {
    throw new Error(`World index has an invalid version or generatedAt: ${filePath}`)
  }
  if (!Array.isArray(raw.story) || !Array.isArray(raw.glossary)) {
    throw new Error(`World index story and glossary must be arrays: ${filePath}`)
  }
  return {
    version: raw.version,
    generatedAt: raw.generatedAt,
    story: raw.story.map((item, index) => parseWorldIndexScene(item, index, filePath)),
    glossary: raw.glossary.map((item, index) => parseWorldIndexTerm(item, index, filePath))
  }
}

/**
 * @description 校验并规范化单个场景条目。
 * @param value 场景条目 JSON。
 * @param index 条目在数组中的位置，用于生成可诊断错误。
 * @param filePath 来源文件路径，用于生成可诊断错误。
 * @returns 结构完整的场景条目。
 */
function parseWorldIndexScene(value: unknown, index: number, filePath: string): WorldIndexScene {
  const raw = requireFields(value, `story[${index}]`, filePath)
  return {
    category: requireString(raw.category, `story[${index}].category`, filePath),
    task: requireString(raw.task, `story[${index}].task`, filePath),
    title: requireString(raw.title, `story[${index}].title`, filePath),
    summary: requireString(raw.summary, `story[${index}].summary`, filePath),
    text: requireString(raw.text, `story[${index}].text`, filePath)
  }
}

/**
 * @description 校验并规范化单个词条条目。
 * @param value 词条条目 JSON。
 * @param index 条目在数组中的位置，用于生成可诊断错误。
 * @param filePath 来源文件路径，用于生成可诊断错误。
 * @returns 结构完整的词条条目。
 */
function parseWorldIndexTerm(value: unknown, index: number, filePath: string): WorldIndexTerm {
  const raw = requireFields(value, `glossary[${index}]`, filePath)
  return {
    term: requireString(raw.term, `glossary[${index}].term`, filePath),
    definition: requireString(raw.definition, `glossary[${index}].definition`, filePath)
  }
}

/**
 * @description 校验条目为对象并取出字段集合。
 * @param value 条目 JSON。
 * @param field 条目位置描述，用于生成可诊断错误。
 * @param filePath 来源文件路径，用于生成可诊断错误。
 * @returns 条目的字段集合。
 */
function requireFields(value: unknown, field: string, filePath: string): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    throw new Error(`World index ${field} must be an object: ${filePath}`)
  }
  return value as Record<string, unknown>
}

/**
 * @description 读取必需的字符串字段。
 * @param value 字段值。
 * @param field 字段路径描述，用于生成可诊断错误。
 * @param filePath 来源文件路径，用于生成可诊断错误。
 * @returns 字符串字段值。
 */
function requireString(value: unknown, field: string, filePath: string): string {
  if (typeof value !== 'string') {
    throw new Error(`World index ${field} must be a string: ${filePath}`)
  }
  return value
}
