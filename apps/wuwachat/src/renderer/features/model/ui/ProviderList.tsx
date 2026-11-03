import { Plus, Server, Trash2 } from "lucide-react";
import type { MouseEvent, ReactElement } from "react";
import { ModelProvider } from "@gamechat/type";
import { ProviderConnectionTestResult } from "@gamechat/type";
import { cn } from "@renderer/common/lib/cn";
import { Button } from "@renderer/common/components/button";

/**
 * @description 渲染模型设置页左栏的供应商列表：竖排卡片加尾部新增入口。
 * @param props.providers 可选的供应商配置集合。
 * @param props.selectedProviderId 当前进入编辑的供应商标识。
 * @param props.testResults 各供应商最近一次连通性测试结果。
 * @param props.onAddProvider 新增供应商时触发。
 * @param props.onSelectProvider 进入供应商编辑时触发。
 * @param props.onDeleteProvider 点击删除按钮时触发。
 * @returns 左栏供应商卡片列表。
 */
export function ModelProviderList({
  providers,
  selectedProviderId,
  onAddProvider,
  onSelectProvider,
  onDeleteProvider,
}: {
  providers: ModelProvider[];
  selectedProviderId?: string;
  testResults: Record<string, ProviderConnectionTestResult>;
  onAddProvider: () => void;
  onSelectProvider: (providerId: string) => void;
  onDeleteProvider: (provider: ModelProvider) => void;
}): ReactElement {
  /**
   * @description 处理删除按钮点击，阻止冒泡触发卡片选中。
   * @param event 当前按钮点击事件。
   * @param provider 需要删除的供应商配置。
   */
  const handleDeleteClick = (
    event: MouseEvent<HTMLButtonElement>,
    provider: ModelProvider,
  ): void => {
    event.stopPropagation();
    onDeleteProvider(provider);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {providers.map((provider) => (
        <div key={provider.id} className="group relative">
          <button
            type="button"
            onClick={() => onSelectProvider(provider.id)}
            className={cn(
              "flex w-full items-center gap-3 rounded border px-3 py-3 pr-10 text-left transition-colors",
              selectedProviderId === provider.id
                ? "border-[#e8c690]/60 bg-[#f5e8cd]/10 text-[#f2dfbd] shadow-[0_8px_24px_rgba(232,198,144,0.08)]"
                : "border-white/10 bg-black/20 text-white/70 hover:bg-white/5",
            )}
          >
            <Server className="size-4 shrink-0" />
            <span className="min-w-0 flex-1">
              <span
                className="block truncate text-sm font-medium"
                title={provider.name}
              >
                {provider.name}
              </span>
              <span className="mt-1 block truncate text-xs text-white/40">
                {provider.models.length > 0
                  ? `${provider.models.length} 个模型`
                  : "暂无模型"}
              </span>
            </span>
          </button>

          <Button
            variant="danger"
            size="icon-sm"
            onClick={(event) => handleDeleteClick(event, provider)}
            className="absolute top-2 right-2 bg-black/35 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
            title="删除供应商"
            aria-label={`删除供应商 ${provider.name}`}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}
      <Button
        variant="quiet"
        onClick={onAddProvider}
        className="h-10 w-full gap-2 border-dashed"
      >
        <Plus className="size-4" />
        新增供应商
      </Button>
    </div>
  );
}
