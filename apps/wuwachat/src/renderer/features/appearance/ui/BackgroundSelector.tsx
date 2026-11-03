import { type ReactElement } from 'react'
import { CHAT_BACKGROUNDS, selectActiveBackground, useAppearanceStore } from '../store/appearance'
import { cn } from '@renderer/common/lib/cn'

export default function BackgroundSelector(): ReactElement {
  const activeBackground = useAppearanceStore(selectActiveBackground)
  const setBackgroundId = useAppearanceStore((state) => state.setBackgroundId)

  return (
    <div className="flex h-full w-full gap-8">
      <div className="my-2 grid h-fit shrink-0 grid-cols-2 gap-2">
        {CHAT_BACKGROUNDS.map((bg) => (
          <button
            key={bg.id}
            type="button"
            className={cn(
              'group relative overflow-hidden rounded-md border-2 transition-all',
              activeBackground.id === bg.id
                ? 'border-amber-200 shadow-[0_0_0_1px_rgba(253,230,138,0.5)]'
                : 'border-white/20 hover:border-amber-200/70'
            )}
            onClick={() => setBackgroundId(bg.id)}
          >
            <img
              src={bg.previewSrc}
              alt={bg.name}
              className="h-fit w-46 object-contain transition-transform duration-200 group-hover:scale-[1.02]"
            />
          </button>
        ))}
      </div>
      <div className="flex-1 text-white">
        <p className="my-2">{activeBackground.name}</p>
        <div className="relative inline-block h-96 w-160 overflow-hidden">
          <img
            src={activeBackground.fullSrc}
            alt={activeBackground.name}
            className="block h-full w-full object-cover object-center"
          />
        </div>

        <p className="mb-2 border-b border-white/20 pt-2 pb-1">{activeBackground.description}</p>
        <p className="text-xs text-gray-300/80">{activeBackground.obtained}</p>
      </div>
    </div>
  )
}
