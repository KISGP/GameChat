/**
 * @description core 路径工具：路径片段校验。
 * @remarks 目录布局函数由各域自持（如 chat/paths.ts），本模块只提供与基准无关的校验原语。
 */

/**
 * @description 判断值是否可作为单一路径片段安全使用。
 * @param value 待检查的路径片段。
 * @returns 非空且不含路径分隔符、不表示相对层级时返回 true。
 */
export function isPathSegment(value: string): boolean {
  return Boolean(value) && value !== '.' && value !== '..' && !/[\\/\0]/.test(value)
}

/**
 * @description 校验值必须可作为单一路径片段使用，阻止路径穿越和分隔符注入。
 * @param value 待校验的路径片段。
 * @param label 错误信息中的字段名。
 */
export function assertPathSegment(value: string, label: string): void {
  if (!isPathSegment(value)) {
    throw new Error(`Invalid ${label}`)
  }
}
