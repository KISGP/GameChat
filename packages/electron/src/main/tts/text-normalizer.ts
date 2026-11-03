const TTS_TEXT_COMPATIBILITY_REPLACEMENTS: Record<string, string> = {
  // The bundled ONNX preprocessor has no pronunciation entry for “啊”.
  啊: '呀'
}

export type TtsNormalizedText = {
  text: string
  replacementCount: number
}

/**
 * @description 处理当前 ONNX Bundle 文本预处理器无法生成拼音的已知中文字符。
 * @param text 已通过长度与空值校验的原始消息文本。
 * @returns 可交给 Bundle 预处理器的兼容文本，以及替换字符数。
 * @remarks 未列入映射的字符保持不变，并由 sidecar 返回明确的兼容性错误。
 */
export function normalizeTextForTts(text: string): TtsNormalizedText {
  let replacementCount = 0
  const normalizedText = text.replace(/[啊]/gu, (character) => {
    replacementCount += 1
    return TTS_TEXT_COMPATIBILITY_REPLACEMENTS[character] || character
  })

  return { text: normalizedText, replacementCount }
}
