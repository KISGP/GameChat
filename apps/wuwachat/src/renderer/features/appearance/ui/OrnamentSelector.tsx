import { type ReactElement } from 'react'
import { ORNAMENT_NONE_PREVIEW, ORNAMENTS } from '../ornaments/catalog'
import { useAppearanceStore } from '../store/appearance'
import { SpineCanvas } from '@renderer/common/components/SpineCanvas'
import { cn } from '@renderer/common/lib/cn'

/**
 * @description 渲染界面设置中的飞讯摆件选择页：左侧摆件卡片（含「无摆件」选项，卡片样式对齐主题与背景选择器），右侧详情区为活体动画预览。
 * @returns 摆件选择器元素。
 */
export default function OrnamentSelector(): ReactElement {
  const ornamentId = useAppearanceStore((state) => state.appearance.ornamentId)
  const setOrnamentId = useAppearanceStore((state) => state.setOrnamentId)
  const activeOrnament = ORNAMENTS.find((ornament) => ornament.id === ornamentId) ?? null

  return (
    <div className="flex h-full w-full gap-8">
      <div className="my-2 grid h-fit shrink-0 grid-cols-2 gap-2">
        <button
          type="button"
          className={cn(
            'group relative overflow-hidden rounded-md border-2 transition-all',
            ornamentId === ''
              ? 'border-amber-200 shadow-[0_0_0_1px_rgba(253,230,138,0.5)]'
              : 'border-white/20 hover:border-amber-200/70'
          )}
          onClick={() => setOrnamentId('')}
        >
          <img
            src={ORNAMENT_NONE_PREVIEW}
            alt="无摆件"
            className="h-fit w-46 object-contain transition-transform duration-200 group-hover:scale-[1.02]"
            draggable="false"
          />
        </button>
        {ORNAMENTS.map((ornament) => (
          <button
            key={ornament.id}
            type="button"
            className={cn(
              'group relative overflow-hidden rounded-md border-2 transition-all',
              ornamentId === ornament.id
                ? 'border-amber-200 shadow-[0_0_0_1px_rgba(253,230,138,0.5)]'
                : 'border-white/20 hover:border-amber-200/70'
            )}
            onClick={() => setOrnamentId(ornament.id)}
          >
            <img
              src={ornament.previewSrc}
              alt={ornament.name}
              className="h-fit w-46 object-contain transition-transform duration-200 group-hover:scale-[1.02]"
              draggable="false"
            />
          </button>
        ))}
      </div>
      <div className="flex-1 text-white">
        <p className="my-2">{activeOrnament ? activeOrnament.name : '未装备摆件'}</p>
        <div className="relative inline-block h-96 w-160 overflow-hidden rounded-md bg-black/20">
          {activeOrnament && (
            <SpineCanvas
              assetId={activeOrnament.id}
              animations={activeOrnament.animations}
              controls
              className="h-full w-full"
            />
          )}
        </div>
        <p className="mb-2 border-b border-white/20 pt-2 pb-1">
          {activeOrnament ? activeOrnament.description : '聊天面板不显示任何摆件。'}
        </p>
        {activeOrnament && <p className="text-sm text-white/60">{activeOrnament.obtained}</p>}
      </div>
    </div>
  )
}
