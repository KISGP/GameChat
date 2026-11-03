/** 策略可开关工具包的标识子集；常驻包不在此列。 */
export type AgentPolicyToolPackageId = 'world' | 'datetime' | 'moegirlpedia'

/** 全部工具包的标识（含常驻包与策略包）。 */
export type AgentToolPackageId =
  | 'world'
  | 'datetime'
  | 'moegirlpedia'
  | 'chat-history'
  | 'chat-images'
  | 'chat-emoticons'
  | 'chat-memory-tools'
  | 'state-card'
