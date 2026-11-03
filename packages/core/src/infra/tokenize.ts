/**
 * @description 检索分词原语：查询与文档必须共同经本函数切分，异刀分词会导致检索静默失效。
 * @remarks 汉字逐字产单字、相邻汉字产双字，拉丁字母与数字连续段合为一词；全角字符先经
 *   normalize('NFKC') 归一，标点、空白、emoji 等非汉字非拉丁字符一律作分隔符，
 *   双字不跨非汉字字符拼接（「看《电影》」不产生「看电」）。
 */

const CJK = /[\u3400-\u9fff]/
const LATIN = /[a-z0-9]/

/**
 * @description 将文本切分为检索词元。
 * @param text 待切分文本。
 * @returns 词元数组；顺序无关，评分只消费词频。
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = []
  const chars = Array.from(text.toLowerCase().normalize('NFKC'))
  let latin: string[] = []
  let prev: string | null = null

  const flush = (): void => {
    if (latin.length > 0) {
      tokens.push(latin.join(''))
      latin = []
    }
  }

  for (const ch of chars) {
    if (CJK.test(ch)) {
      flush()
      tokens.push(ch)
      if (prev !== null) tokens.push(prev + ch)
      prev = ch
    } else if (LATIN.test(ch)) {
      latin.push(ch)
      prev = null
    } else {
      flush()
      prev = null
    }
  }
  flush()
  return tokens
}
