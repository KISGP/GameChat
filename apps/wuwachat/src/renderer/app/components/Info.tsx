import * as DialogPrimitive from '@radix-ui/react-dialog'
import CloseIcon from './Close'
import { cn } from '@renderer/common/lib/cn'
import Github from '@renderer/assets/github.png'
import { type ReactElement } from 'react'
import InfoBg from '@renderer/assets/T_CommonPopupBg.png'
import InfoBgPattern from '@renderer/assets/T_ComPopupPattern.png'
import InfoBgPattern1 from '@renderer/assets/T_ComPopupPattern1.png'
import InfoBgPattern2 from '@renderer/assets/T_ComPopupPattern2.png'
import InfoBgPattern3 from '@renderer/assets/T_ComPopupPattern3.png'
import InfoBgPattern5 from '@renderer/assets/T_ComPopupPattern5.png'
import InfoBgLine from '@renderer/assets/T_CommonPopupBgLine.png'

interface InfoProps {
  isOpen: boolean
  onClose: () => void
  className?: string
}

export default function Info({ isOpen, onClose, className }: InfoProps): ReactElement {
  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-100 flex items-center justify-center bg-black/60 backdrop-blur-md duration-300 ease-in-out" />
        <img
          src={InfoBgPattern}
          draggable="false"
          className="pointer-events-none absolute bottom-0 left-46 z-100 scale-40"
        />
        <img
          src={InfoBgPattern1}
          draggable="false"
          className="pointer-events-none absolute right-39 bottom-27 z-100 scale-50"
        />
        <img
          src={InfoBgPattern2}
          draggable="false"
          className="pointer-events-none absolute top-18 right-39 z-100 scale-50"
        />
        <img
          src={InfoBgPattern3}
          draggable="false"
          className="pointer-events-none absolute -top-12 -left-69 z-100 scale-70"
        />
        <img
          src={InfoBgPattern5}
          draggable="false"
          className="pointer-events-none absolute -right-65 -bottom-9 z-100 scale-x-48 scale-y-60"
        />

        <div className="pointer-events-none fixed inset-0 z-100 flex items-center justify-center">
          <DialogPrimitive.Content
            className={cn(
              'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-bottom-4 data-[state=open]:slide-in-from-bottom-4 pointer-events-auto relative flex h-fit w-186 flex-col gap-px rounded-sm pr-0.5 duration-300 ease-in-out outline-none focus:outline-none',
              className
            )}
          >
            <img src={InfoBg} draggable="false" className="pointer-events-none" />
            <img
              src={InfoBgLine}
              draggable="false"
              className="pointer-events-none absolute top-0 right-2 bottom-0 h-104"
            />

            <div data-drag-region className="absolute h-14 w-full">
              <span className="absolute top-5 left-6 z-100 scale-90 text-2xl font-semibold">
                飞讯说明
              </span>
              <CloseIcon
                className="absolute top-3 right-6 z-100 scale-90 invert"
                onClick={onClose}
              />
            </div>

            <div className="absolute top-24 bottom-4 flex flex-col justify-between px-20">
              <span className="text-lg text-neutral-700">
                飞讯是先行公约为终端开发的远程通讯程序，生活在索拉里斯的人们可以用飞讯互相联系。
              </span>

              <div className="bottom-4 flex items-center gap-2">
                <img src={Github} className="size-5" />
                <span>项目链接：</span>
                <span
                  className="cursor-pointer hover:text-[#e8c690]"
                  onClick={() =>
                    window.open(
                      'https://github.com/KISGP/GameChat',
                      '_blank',
                      'noopener,noreferrer'
                    )
                  }
                >
                  https://github.com/KISGP/GameChat
                </span>
              </div>
            </div>
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
