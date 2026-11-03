/**
 * @description Agent 编排的变量插值与条件求值纯函数：渲染层与主进程引擎共用的单实现。
 * @remarks 与主进程 engine 的插值口径一致（引擎侧将迁移为消费本模块）；
 *   内置变量 last_user 为末位用户消息；未命名的变量占位替换为空串。
 */

import type { FlowCondition } from '@gamechat/type'

/** 插值求值所需的上下文切片。 */
export type InterpolateScope = {
  /** 命名变量表。 */
  variables: Record<string, string>
  /** 末位用户消息文本（内置变量 last_user 的取值）。 */
  lastUser: string
}

/**
 * @description 对模板文本执行 {{变量}} 插值。
 * @param template 模板文本。
 * @param scope 变量表与末位用户消息。
 * @returns 插值后的文本。
 */
export function interpolateTemplate(template: string, scope: InterpolateScope): string {
  return template.replace(/\{\{([\w\u4e00-\u9fff-]+)\}\}/gu, (_match, name: string) => {
    if (name === 'last_user') {
      return scope.lastUser
    }
    return scope.variables[name] ?? ''
  })
}

/** 通用激活条件，直接复用编排契约中的出边条件类型。 */
export type LabConditionInput = FlowCondition

/**
 * @description 求值一条激活条件。
 * @param condition 条件；variable 为空或缺省时视为无条件（恒真）。
 * @param scope 变量表与末位用户消息。
 * @returns 条件满足时返回 true。
 */
export function matchConditionValue(
  condition: LabConditionInput | undefined,
  scope: InterpolateScope
): boolean {
  if (!condition || !condition.variable) {
    return true
  }
  const actual = interpolateTemplate(`{{${condition.variable}}}`, scope)
  switch (condition.op) {
    case 'equals':
      return actual === (condition.value ?? '')
    case 'contains':
      return actual.includes(condition.value ?? '')
    case 'gt':
      return Number(actual) > Number(condition.value ?? 0)
    case 'lt':
      return Number(actual) < Number(condition.value ?? 0)
    case 'notEmpty':
      return actual.trim().length > 0
    case 'empty':
      return actual.trim().length === 0
    default:
      return true
  }
}
