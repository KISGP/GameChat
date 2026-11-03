import type { ReactElement, ReactNode } from 'react'

import { Button } from '@renderer/common/components/button'

export type ConfirmActionModalProps = {
  title: string
  description: ReactNode
  confirmLabel: string
  cancelLabel?: string
  confirmDisabled?: boolean
  cancelDisabled?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmActionModal({
  title,
  description,
  confirmLabel,
  cancelLabel = '取消',
  confirmDisabled = false,
  cancelDisabled = false,
  onConfirm,
  onCancel
}: ConfirmActionModalProps): ReactElement {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center px-6 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded border border-white/15 bg-[#171717] p-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium text-white/90">{title}</h3>
            <div className="mt-2 text-sm leading-5 text-white/55">{description}</div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="quiet" size="lg" onClick={onCancel} disabled={cancelDisabled}>
            {cancelLabel}
          </Button>
          <Button variant="danger" size="lg" onClick={onConfirm} disabled={confirmDisabled}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
