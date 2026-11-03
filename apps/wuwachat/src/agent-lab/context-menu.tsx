/**
 * @description 节点右键菜单卡片：复制、设为入口与删除。
 * @remarks 菜单挂在窗口层，pointerdown 冒泡被阻断以防立即自关闭；关闭由画布全局 pointerdown 处理。
 */
import type { ReactElement } from 'react'

/**
 * @description 渲染节点右键菜单。
 * @param props 菜单位置、目标节点与各操作回调。
 * @param props.menu 菜单屏幕坐标与目标节点标识。
 * @param props.onClose 关闭菜单。
 * @param props.onDuplicate 复制目标节点。
 * @param props.onSetEntry 把目标节点设为入口。
 * @param props.onDelete 删除目标节点。
 * @returns 固定定位的菜单。
 */
export function ContextMenuCard(props: {
  menu: { x: number; y: number; nodeKey: string }
  onClose: () => void
  onDuplicate: (nodeKey: string) => void
  onSetEntry: (nodeKey: string) => void
  onDelete: (nodeKey: string) => void
}): ReactElement {
  const { menu, onClose, onDuplicate, onSetEntry, onDelete } = props
  return (
    <div
      className="animate-fade-in border-border bg-card fixed z-50 rounded-lg border py-1 shadow-xl"
      style={{ left: menu.x, top: menu.y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="hover:bg-primary/10 block w-full px-4 py-1.5 text-left text-xs"
        onClick={() => {
          onDuplicate(menu.nodeKey)
          onClose()
        }}
      >
        复制节点
      </button>
      <button
        type="button"
        className="hover:bg-primary/10 block w-full px-4 py-1.5 text-left text-xs"
        onClick={() => {
          onSetEntry(menu.nodeKey)
          onClose()
        }}
      >
        设为入口
      </button>
      <button
        type="button"
        className="block w-full px-4 py-1.5 text-left text-xs text-red-500 hover:bg-red-500/10"
        onClick={() => {
          onDelete(menu.nodeKey)
          onClose()
        }}
      >
        删除节点
      </button>
    </div>
  )
}
