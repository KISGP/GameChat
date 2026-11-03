import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import { ModelProvider, ProviderModel } from '@gamechat/type'
import { Button } from '@renderer/common/components/button'
import { ModelEditDialog, type ModelEditTarget } from './ModelEditDialog'

type ModelListProps = {
  provider: ModelProvider
  /** 保存回调：编辑目标原地更新条目，新建目标向供应商追加条目。 */
  onSaveModel: (model: ProviderModel, target: ModelEditTarget) => void
  onRemoveModel: (modelId: string) => void
}

/**
 * @description 渲染供应商内的模型摘要列表：模型名称、图片能力摘要与编辑、删除入口。
 * @param props 模型条目所属供应商及保存、删除回调。
 * @returns 供应商模型条目列表。
 * @remarks 字段编辑集中在模型编辑弹窗内进行；删除立即生效且不经确认。
 */
export function ModelList({ provider, onSaveModel, onRemoveModel }: ModelListProps): ReactElement {
  const [editTarget, setEditTarget] = useState<ModelEditTarget | null>(null)

  return (
    <div className="flex flex-col gap-2">
      {provider.models.map((model) => (
        <div
          key={model.id}
          className="flex items-center gap-3 rounded border border-white/10 bg-black/20 px-3 py-2"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-white/85">{model.model || model.id}</div>
          </div>
          <Button
            variant="quiet"
            size="icon-lg"
            onClick={() => setEditTarget({ mode: 'edit', modelId: model.id })}
            className="shrink-0"
            title="编辑模型"
            aria-label={`编辑模型 ${model.model || model.id}`}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            variant="danger"
            size="icon-lg"
            onClick={() => onRemoveModel(model.id)}
            className="shrink-0"
            title="删除模型"
            aria-label={`删除模型 ${model.model || model.id}`}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}

      <Button
        variant="quiet"
        onClick={() => setEditTarget({ mode: 'create' })}
        className="h-10 w-fit gap-2 self-start border-dashed px-3"
      >
        <Plus className="size-4" />
        添加模型
      </Button>

      {editTarget && (
        <ModelEditDialog
          key={editTarget.mode === 'edit' ? editTarget.modelId : 'create'}
          provider={provider}
          target={editTarget}
          onSave={(model) => {
            onSaveModel(model, editTarget)
            setEditTarget(null)
          }}
          onClose={() => setEditTarget(null)}
        />
      )}
    </div>
  )
}
