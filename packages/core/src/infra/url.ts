/**
 * @description 拼接 URL 片段，并去除重复的斜杠边界。
 * @param baseUrl 基础 URL。
 * @param path 路径片段。
 * @returns 拼接后的 URL。
 */
export function joinUrl(baseUrl: string, path: string): string {
  const trimmedBase = baseUrl.replace(/\/+$/, '')
  const trimmedPath = path.replace(/^\/+/, '')
  return `${trimmedBase}/${trimmedPath}`
}
