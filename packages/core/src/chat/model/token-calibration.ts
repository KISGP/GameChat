/**
 * @description 按模型条目维护估算 token 的滚动校准系数。
 * @remarks 系数为进程内内存态，跨启动不保留；冷启动取 1.0，由终答实测 inputTokens 回读持续
 *   校准。全部预算决策、截断判断与界面展示共用同一系数，保证口径唯一。
 */
export class TokenCalibrationStore {
  private readonly coefficients = new Map<string, number>()

  /** 校准采样的指数滑动平均权重：新采样占三成、历史系数占七成。 */
  private static readonly EMA_ALPHA = 0.3
  /** 校准系数下限，防止极端采样把估算压到失真。 */
  private static readonly COEFFICIENT_MIN = 0.5
  /** 校准系数上限，防止极端采样把估算放大到失真。 */
  private static readonly COEFFICIENT_MAX = 3

  /**
   * @description 读取指定模型的当前校准系数。
   * @param modelId 模型条目标识。
   * @returns 校准系数；该模型尚无采样时返回 1。
   */
  getCoefficient(modelId: string): number {
    return this.coefficients.get(modelId) ?? 1
  }

  /**
   * @description 记录一次估算与实测的配对样本，更新该模型的滚动校准系数。
   * @param modelId 模型条目标识。
   * @param rawEstimate 该次调用的未校准估算 token 数。
   * @param actualTokens 供应商返回的实际输入 token 数。
   * @remarks 估算或实测非正数时忽略该样本；单次采样比先钳制到上下限，再按指数滑动平均并入系数，
   *   单次异常值不会显著带偏口径。
   */
  record(modelId: string, rawEstimate: number, actualTokens: number): void {
    if (!(rawEstimate > 0) || !(actualTokens > 0)) {
      return
    }
    const sample = Math.min(
      TokenCalibrationStore.COEFFICIENT_MAX,
      Math.max(TokenCalibrationStore.COEFFICIENT_MIN, actualTokens / rawEstimate)
    )
    const previous = this.getCoefficient(modelId)
    const next =
      previous * (1 - TokenCalibrationStore.EMA_ALPHA) + sample * TokenCalibrationStore.EMA_ALPHA
    this.coefficients.set(
      modelId,
      Math.min(
        TokenCalibrationStore.COEFFICIENT_MAX,
        Math.max(TokenCalibrationStore.COEFFICIENT_MIN, next)
      )
    )
  }
}

let calibrationStore: TokenCalibrationStore | null = null

/**
 * @description 获取进程内共享的 token 校准系数存储。
 * @returns 惰性构造并缓存的 TokenCalibrationStore 单例。
 */
export function getTokenCalibration(): TokenCalibrationStore {
  if (!calibrationStore) {
    calibrationStore = new TokenCalibrationStore()
  }
  return calibrationStore
}
