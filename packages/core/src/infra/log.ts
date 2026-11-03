/**
 * @description core 日志出口：模块级 sink，宿主启动时注入实现，缺省静默。
 * @remarks chat 域的日志调用横跨类与模块函数，经模块级 sink 保持与既有调用形态同构；
 *   宿主在应用启动链调用 setLogSink 映射到各自日志基建，未注入时全部调用为 no-op。
 */
import type { LogAdapter } from '../adapters'

const noopSink: LogAdapter = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
}

let sink: LogAdapter = noopSink

/**
 * @description 注入日志 sink，宿主日志基建自此承接 core 全部日志输出。
 * @param next 宿主日志适配实现。
 */
export function setLogSink(next: LogAdapter): void {
  sink = next
}

/**
 * @description core 业务域统一日志出口。
 * @remarks scope 为域内约定的日志来源标记（如 `ai`、`chat`、`main`），由宿主按需映射；
 *   未注入 sink 时本对象全部方法静默。
 */
export const logger: LogAdapter = {
  info: (scope, event, message, detail) => sink.info(scope, event, message, detail),
  warn: (scope, event, message, detail) => sink.warn(scope, event, message, detail),
  error: (scope, event, message, detail) => sink.error(scope, event, message, detail)
}
