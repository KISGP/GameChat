/**
 * @description 聊天表情标记词汇：标记前缀与匹配正则，消息切分与提示词构造共用的单一事实源。
 */
export const CHAT_EMOTICON_MARKER_PREFIX = '[emoticon:'
export const CHAT_EMOTICON_MARKER_PATTERN = /^\[emoticon:([^\]\r\n]+)\]$/u
export const CHAT_EMOTICON_TOKEN_PATTERN = /\[emoticon:([^\]\r\n]+)\]/gu
