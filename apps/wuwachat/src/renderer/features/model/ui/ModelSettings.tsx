import { Eye, EyeOff } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import { API_FORMAT_LABELS } from '@gamechat/schema'
import { useProviderSettings } from '../hooks/useModelSettings'
import { useProvidersStore } from '@renderer/store/providers'
import { useShallow } from 'zustand/react/shallow'
import { ModelConnectionSection } from './ConnectionSection'
import { ModelProviderList } from './ProviderList'
import { ModelApiFormatField } from './ApiFormatField'
import { ModelList } from './ModelList'
import { ProviderDefaultParamsSection } from './AdvancedSection'
import { Input } from '@renderer/common/components/input'
import { Button } from '@renderer/common/components/button'
import { ConfirmActionModal } from '@renderer/common/components/ConfirmActionModal'

export function ModelTab(): ReactElement {
  const {
    store,
    isLoaded,
    updateProvider,
    updateProviderApiFormat,
    addProvider,
    removeProvider,
    addProviderModel,
    removeProviderModel,
    updateProviderModel,
    updateProviderDefaultParams
  } = useProvidersStore(
    useShallow((state) => ({
      store: state.store,
      isLoaded: state.isLoaded,
      updateProvider: state.updateProvider,
      updateProviderApiFormat: state.updateProviderApiFormat,
      addProvider: state.addProvider,
      removeProvider: state.removeProvider,
      addProviderModel: state.addProviderModel,
      removeProviderModel: state.removeProviderModel,
      updateProviderModel: state.updateProviderModel,
      updateProviderDefaultParams: state.updateProviderDefaultParams
    }))
  )

  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const [defaultParamsOpen, setDefaultParamsOpen] = useState(false)
  const providers = store.providers
  // 编辑对象按显式选择派生：选择失效（被删除）或从未选择时回落到第一个供应商。
  const currentProvider =
    providers.find((provider) => provider.id === selectedProviderId) ?? providers[0] ?? null
  const {
    showApiKey,
    setShowApiKey,
    deleteTarget,
    setDeleteTarget,
    testingProvider,
    currentResult,
    baseUrlInvalid,
    canTest,
    testResults,
    updateCurrentProvider,
    handleApiFormatSelect,
    handleTestConnection,
    handleCancelTestConnection,
    handleConfirmDelete
  } = useProviderSettings({
    currentProvider: currentProvider ?? undefined,
    updateProvider,
    updateProviderApiFormat,
    removeProvider
  })

  /**
   * @description 新增供应商并立即进入其编辑视图。
   * @returns 无返回值。
   */
  const handleAddProvider = (): void => {
    setSelectedProviderId(addProvider())
  }

  return (
    <>
      <div className="relative h-full">
        <div className="mx-auto flex h-full max-w-6xl gap-4 px-4">
          <aside className="flex w-60 shrink-0 flex-col gap-3 overflow-y-auto pb-3">
            {!isLoaded && (
              <div className="rounded border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60">
                正在读取模型配置...
              </div>
            )}
            <ModelProviderList
              providers={providers}
              selectedProviderId={currentProvider?.id}
              testResults={testResults}
              onAddProvider={handleAddProvider}
              onSelectProvider={setSelectedProviderId}
              onDeleteProvider={setDeleteTarget}
            />
          </aside>

          <section className="flex min-w-0 flex-1 flex-col overflow-y-auto pb-3">
            {currentProvider ? (
              <>
                <div className="rounded border border-white/8 bg-black/20 p-4">
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs text-white/55">显示名称</span>
                      <Input
                        type="text"
                        value={currentProvider.name}
                        onChange={(event) => updateCurrentProvider({ name: event.target.value })}
                      />
                    </label>

                    <ModelApiFormatField
                      provider={currentProvider}
                      onSelectApiFormat={handleApiFormatSelect}
                    />
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs text-white/55">Base URL</span>
                      <Input
                        type="url"
                        value={currentProvider.baseUrl}
                        onChange={(event) => updateCurrentProvider({ baseUrl: event.target.value })}
                      />
                      {baseUrlInvalid && (
                        <span className="text-xs text-red-300">
                          请输入以 `http` 或 `https` 开头的有效地址。
                        </span>
                      )}
                    </label>

                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs text-white/55">API Key</span>
                      <span className="relative">
                        <Input
                          type={showApiKey ? 'text' : 'password'}
                          value={currentProvider.apiKey}
                          onChange={(event) =>
                            updateCurrentProvider({ apiKey: event.target.value })
                          }
                          className="w-full pr-10"
                          placeholder="sk-..."
                        />
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => setShowApiKey((value) => !value)}
                          className="absolute inset-y-0 right-2 my-auto text-white/45 hover:text-white/80"
                          title={showApiKey ? '隐藏 API Key' : '显示 API Key'}
                        >
                          {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </Button>
                      </span>
                    </label>
                  </div>
                </div>

                <div className="mt-4">
                  <ProviderDefaultParamsSection
                    open={defaultParamsOpen}
                    provider={currentProvider}
                    onToggle={() => setDefaultParamsOpen((value) => !value)}
                    onUpdate={(patch) => updateProviderDefaultParams(currentProvider.id, patch)}
                  />
                </div>

                <div className="mt-4">
                  <span className="mb-2 block text-xs text-white/55">模型列表</span>
                  <ModelList
                    provider={currentProvider}
                    onSaveModel={(model, target) => {
                      if (target.mode === 'edit') {
                        updateProviderModel(currentProvider.id, target.modelId, model)
                      } else {
                        addProviderModel(currentProvider.id, model)
                      }
                    }}
                    onRemoveModel={(modelId) => removeProviderModel(currentProvider.id, modelId)}
                  />
                </div>

                <div className="mt-4">
                  <ModelConnectionSection
                    canTest={canTest}
                    testing={testingProvider === currentProvider.id}
                    result={currentResult}
                    onTest={handleTestConnection}
                    onCancel={handleCancelTestConnection}
                  />
                </div>
              </>
            ) : (
              isLoaded && (
                <div className="flex min-h-36 flex-1 items-center justify-center rounded border border-dashed border-white/10 bg-black/20 text-white/50">
                  暂无模型配置
                </div>
              )
            )}
          </section>
        </div>
      </div>

      {deleteTarget && (
        <ConfirmActionModal
          title="删除供应商"
          description={
            <>
              确认是否要删除名为 {deleteTarget.name} 的 {API_FORMAT_LABELS[deleteTarget.apiFormat]}{' '}
              供应商配置吗？其下的 {deleteTarget.models.length} 个模型条目会一并移除。
            </>
          }
          confirmLabel="删除"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleConfirmDelete}
        />
      )}
    </>
  )
}
