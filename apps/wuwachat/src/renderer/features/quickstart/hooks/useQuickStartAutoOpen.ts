import { useEffect, useRef } from 'react'
import { trackError } from '@renderer/app/telemetry'
import { useCharacterRegistryStore } from '@renderer/store/character-registry'

/**
 * @description 应用启动后判定本地是否已安装角色，并在没有任何角色时自动打开首启配置向导。
 * @param enabled 应用设置是否已完成启动水合；未就绪时不做判定。
 * @param onOpen 判定命中后打开向导覆盖层的回调。
 * @returns 无返回值。
 * @remarks 判定前自行拉取一次角色注册表快照，规避启动阶段注册表异步加载与「确实无角色」的竞态；
 *   每次应用运行至多触发一次，用户关闭向导后本次运行不再复现，下次启动重新判定。
 */
export function useQuickStartAutoOpen(enabled: boolean, onOpen: () => void): void {
  const openedRef = useRef(false)
  const onOpenRef = useRef(onOpen)

  useEffect(() => {
    onOpenRef.current = onOpen
  }, [onOpen])

  useEffect(() => {
    if (!enabled || openedRef.current) {
      return
    }
    let disposed = false

    void useCharacterRegistryStore
      .getState()
      .refreshRegistry()
      .then(() => {
        if (disposed || openedRef.current) {
          return
        }
        if (useCharacterRegistryStore.getState().registry.local.length > 0) {
          return
        }
        openedRef.current = true
        onOpenRef.current()
      })
      .catch((error) => {
        trackError('quickstart-gate-failed', 'Failed to evaluate quick start gate', error)
      })

    return () => {
      disposed = true
    }
  }, [enabled])
}
