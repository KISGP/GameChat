import { type ReactElement } from 'react'
import { getSkinById, SKINS } from '../skins/catalog'
import { useAppearanceStore } from '../store/appearance'
import { cn } from '@renderer/common/lib/cn'

/**
 * @description 渲染界面设置中的主题皮肤选择页。
 * @returns 皮肤选择器元素。
 */
export default function SkinSelector(): ReactElement {
  const skinId = useAppearanceStore((state) => state.appearance.skinId)
  const setSkinId = useAppearanceStore((state) => state.setSkinId)
  const activeSkin = getSkinById(skinId)

  return (
    <div className="flex h-full w-full gap-8">
      <div className="my-2 grid h-fit shrink-0 grid-cols-2 gap-2">
        {SKINS.map((skin) => (
          <button
            key={skin.id}
            type="button"
            className={cn(
              'group relative overflow-hidden rounded-md border-2 transition-all',
              activeSkin.id === skin.id
                ? 'border-amber-200 shadow-[0_0_0_1px_rgba(253,230,138,0.5)]'
                : 'border-white/20 hover:border-amber-200/70'
            )}
            onClick={() => setSkinId(skin.id)}
          >
            <img
              src={skin.previewSrc}
              alt={skin.name}
              className="h-fit w-46 object-contain transition-transform duration-200 group-hover:scale-[1.02]"
            />
          </button>
        ))}
      </div>
      <div className="flex-1 text-white">
        <p className="my-2">{activeSkin.name}</p>
        <div className="relative inline-block h-96 w-160 overflow-hidden">
          <img
            src={activeSkin.largePreviewSrc}
            alt={activeSkin.name}
            className="block h-full w-full object-cover object-center"
          />
        </div>

        <p className="mb-2 border-b border-white/20 pt-2 pb-1">{activeSkin.description}</p>
        <p className="text-sm text-white/60">{activeSkin.obtained}</p>
      </div>
    </div>
  )
}
