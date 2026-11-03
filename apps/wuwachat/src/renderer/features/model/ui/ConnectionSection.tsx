import { Wifi, X } from 'lucide-react'
import type { ReactElement } from 'react'
import { ProviderConnectionTestResult } from '@gamechat/type'
import { cn } from '@renderer/common/lib/cn'
import { Button } from '@renderer/common/components/button'

export function ModelConnectionSection({
  canTest,
  testing,
  result,
  onTest,
  onCancel
}: {
  canTest: boolean
  testing: boolean
  result?: ProviderConnectionTestResult
  onTest: () => Promise<void>
  onCancel: () => Promise<void>
}): ReactElement {
  return (
    <section className="absolute bottom-0 left-0 flex w-full flex-row-reverse items-center justify-between gap-3 bg-black/20 px-5 py-3">
      <div className="flex items-center gap-3">
        {result && (
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-sm',
              result.ok ? 'text-green-400' : 'text-red-300'
            )}
            title={result.message}
          >
            {result.message}
            {typeof result.latencyMs === 'number' ? ` / ${result.latencyMs}ms` : ''}
          </span>
        )}
        {testing ? (
          <Button variant="danger" size="lg" onClick={() => void onCancel()}>
            <X className="size-4" />
            取消测试
          </Button>
        ) : (
          <Button
            variant="quiet"
            size="lg"
            onClick={() => void onTest()}
            disabled={!canTest}
            className="border-white/20"
          >
            <Wifi className="size-4" />
            测试连接
          </Button>
        )}
      </div>
    </section>
  )
}
