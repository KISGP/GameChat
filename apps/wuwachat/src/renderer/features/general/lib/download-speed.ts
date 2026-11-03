/**
 * @description 把下载速度字节数格式化为面向展示的速度文本。
 * @param bytesPerSecond 每秒字节数。
 * @returns 形如「3.2 MB/s」「860 KB/s」「512 B/s」的速度文本；无效或非正值返回空串。
 */
export function formatDownloadSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return ''
  }
  if (bytesPerSecond < 1024) {
    return `${Math.round(bytesPerSecond)} B/s`
  }
  if (bytesPerSecond < 1024 * 1024) {
    return `${Math.round(bytesPerSecond / 1024)} KB/s`
  }
  return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`
}
