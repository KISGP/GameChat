import { useState, type ReactElement } from 'react'
import { useSkinDecorations } from '../skins/useSkinSlot'
import { SpineCanvas } from '@renderer/common/components/SpineCanvas'
import { cn } from '@renderer/common/lib/cn'

type SkinSpineMountsProps = {
  // 渲染面：应用顶栏或聊天面板，各自对应皮肤声明中的挂载清单
  surface: 'header' | 'chatPanel'
}

/**
 * 渲染当前皮肤声明中指定渲染面的全部 Spine 装饰挂载；皮肤未声明该面时渲染空。
 * 每个挂载在加载完成前不可见；含 tapAnimations 的挂载接收指针交互，否则点击穿透。
 */
export function SkinSpineMounts({ surface }: SkinSpineMountsProps): ReactElement {
  const decorations = useSkinDecorations()
  const mounts =
    decorations && (surface === 'header' ? decorations.headerSpines : decorations.panelSpines)
  // 已完成加载并回报布局的挂载键（索引+资产+动画）；换主题后旧键不再命中，无需重置
  const [readyKeys, setReadyKeys] = useState<ReadonlySet<string>>(new Set())

  if (!mounts) {
    return <></>
  }
  return (
    <>
      {mounts.map((mount, index) => {
        const readyKey = `${index}-${mount.assetId}-${mount.animations.join('/')}`
        return (
          <div
            key={readyKey}
            className={cn(
              mount.className,
              !readyKeys.has(readyKey) && 'invisible',
              mount.tapAnimations ? 'pointer-events-auto' : 'pointer-events-none'
            )}
          >
            <SpineCanvas
              assetId={mount.assetId}
              animations={mount.animations}
              scale={mount.scale}
              tapAnimations={mount.tapAnimations}
              onBounds={() => setReadyKeys((prev) => new Set(prev).add(readyKey))}
              className={cn('h-full w-full', mount.tapAnimations && 'cursor-pointer')}
            />
          </div>
        )
      })}
    </>
  )
}
