import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from 'react'

interface UseAsyncActionOptions<T> {
  onSuccess?: (data: T) => void
  onError?: (error: Error) => void
  /** @description 无论成功或失败都会执行的收尾回调，适合复位按钮的按条目 pending 状态。 */
  onSettled?: () => void
}

/**
 * @description 将异步操作封装为可复用的 React 状态，并跟踪加载、成功、失败和结果数据。
 * @param action 要执行的异步操作；调用参数会原样传递给该函数。
 * @param options 可选的成功、失败与收尾回调。
 * @returns 包含当前异步状态、结果、错误和执行方法的对象。
 * @remarks 异步操作失败时会先更新错误状态，再将规范化后的 Error 重新抛出给调用方；
 *   不希望向调用方传播错误的场景应在 onError 中处理并在 onSettled 中完成收尾。
 *   run 的引用在组件生命周期内保持稳定：action 与 options 变更经镜像 ref 在提交后生效，
 *   需要稳定回调 prop 的调用方应解构 run 后传递，不要依赖返回对象本身的引用。
 */
export function useAsyncAction<T, Args extends unknown[]>(
  action: (...args: Args) => Promise<T>,
  options?: UseAsyncActionOptions<T>
): {
  loading: boolean
  status: 'idle' | 'loading' | 'success' | 'error'
  data: T | null
  error: Error | null
  run: (...args: Args) => Promise<T>
  setStatus: Dispatch<SetStateAction<'idle' | 'loading' | 'success' | 'error'>>
} {
  const [isLoading, setIsLoading] = useState(false)
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  // action 与 options 的镜像：调用时读取最新值，保证 run 引用稳定且行为始终对齐最新闭包
  const actionRef = useRef(action)
  const optionsRef = useRef(options)

  useEffect(() => {
    actionRef.current = action
    optionsRef.current = options
  })

  const run = useCallback(async (...args: Args) => {
    const currentAction = actionRef.current
    const currentOptions = optionsRef.current
    setIsLoading(true)
    setStatus('loading')
    setError(null)
    setData(null)

    try {
      const result = await currentAction(...args)
      setData(result)
      setStatus('success')

      currentOptions?.onSuccess?.(result)

      return result
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e)
      setStatus('error')

      currentOptions?.onError?.(e)
      throw e
    } finally {
      setIsLoading(false)
      currentOptions?.onSettled?.()
    }
  }, [])

  return { loading: isLoading, status, data, error, run, setStatus }
}
