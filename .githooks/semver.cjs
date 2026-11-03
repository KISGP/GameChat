#!/usr/bin/env node
/**
 * @description 语义化版本解析与比较的共享模块，供 commit-msg 钩子与 release 工作流共同使用，规则单一事实源。
 * @remarks 经 CLI 调用时执行 compare 子命令并以退出码表达成败；被 require 时只导出函数，无副作用。
 */
'use strict';

/**
 * @description 匹配语义化版本号（主.次.修订，可带连字符 prerelease 后缀）的正则。
 */
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/**
 * @description 把版本号字符串解析为可比较的结构。
 * @param {string} version - 版本号字符串，形如 0.2.0 或 0.2.0-beta.1。
 * @returns {{major: number, minor: number, patch: number, pre: string[] | null}} 解析结果；pre 为 null 表示正式版。
 * @throws {Error} 版本号不符合语义化版本格式时抛出。
 */
function parseVersion(version) {
  const match = VERSION_PATTERN.exec(version);
  if (match === null) {
    throw new Error(`版本号不符合语义化版本格式：${version}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] === undefined ? null : match[4].split('.'),
  };
}

/**
 * @description 按语义化版本优先级比较两个版本：核心段逐位比较，正式版高于 prerelease，prerelease 标识符按数字优先于字母、数字逐位数值、字母逐字典序的规则比较。
 * @param {string} a - 左侧版本号。
 * @param {string} b - 右侧版本号。
 * @returns {number} a 小于 b 返回 -1，等于返回 0，大于返回 1。
 * @throws {Error} 任一版本号不符合语义化版本格式时抛出。
 */
function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) {
      return left[key] < right[key] ? -1 : 1;
    }
  }
  if (left.pre === null && right.pre === null) {
    return 0;
  }
  if (left.pre === null) {
    return 1;
  }
  if (right.pre === null) {
    return -1;
  }
  const length = Math.max(left.pre.length, right.pre.length);
  for (let index = 0; index < length; index += 1) {
    const x = left.pre[index];
    const y = right.pre[index];
    if (x === undefined) {
      return -1;
    }
    if (y === undefined) {
      return 1;
    }
    const xIsNumber = /^\d+$/.test(x);
    const yIsNumber = /^\d+$/.test(y);
    if (xIsNumber && yIsNumber) {
      const delta = Number(x) - Number(y);
      if (delta !== 0) {
        return delta < 0 ? -1 : 1;
      }
    } else if (xIsNumber !== yIsNumber) {
      return xIsNumber ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

module.exports = { parseVersion, compareVersions };

if (require.main === module) {
  const [, , command, left, right] = process.argv;
  if (command !== 'compare' || !left || !right) {
    console.error('用法：node semver.cjs compare <版本a> <版本b>');
    process.exit(2);
  }
  try {
    console.log(String(compareVersions(left, right)));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
