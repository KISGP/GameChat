import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactElement
} from 'react'
import { ImagePlus, Pencil, Send, Smile, StopCircle, X } from 'lucide-react'
import { toast } from 'sonner'
import type { ChatImageInput } from '@gamechat/type'
import { getUserEmoticons } from '@renderer/services/emoticons'
import type { ChatEmoticonImage } from '@gamechat/schema'
import { findProviderModel, useProvidersStore } from '@renderer/store/providers'
import { Button } from '@renderer/common/components/button'
import { useModelSelectionStore } from '../store/model-selection'
import { getVoiceOutputBlockReason } from '../lib/voice-readiness'
import { ComposerContextRing } from './ComposerContextRing'
import { ComposerPopover } from './ComposerPopover'
import { trackError } from '@renderer/app/telemetry'

const MAX_IMAGE_COUNT = 4
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024
const IMAGE_MIME_TYPES = new Set<ChatImageInput['mimeType']>([
  'image/png',
  'image/jpeg',
  'image/webp'
])

/** 会话命令定义：命令面板当前只注册实际存在的命令。 */
const CHAT_COMMANDS = [
  { id: 'compress', label: '压缩', description: '把较早的历史整理为滚动摘要' },
  { id: 'export', label: '导出', description: '把整个会话导出为 Markdown 文件' }
] as const

export type ChatCommandId = (typeof CHAT_COMMANDS)[number]['id']

type ChatComposerProps = {
  /** 发送文本消息;失败时拒绝,composer 据此保留草稿。 */
  onSendMessage: (message: string, images: ChatImageInput[]) => Promise<void>
  onStop?: () => void
  isLoading: boolean
  charId?: string
  participantNames?: string[]
  allowImages?: boolean
  onTypingActivity?: () => void
  onEmoticonPick: (emoticonId: string) => void
  /** 用户在命令面板中选中一条会话命令。 */
  onRunCommand: (command: ChatCommandId) => void
  /** 语音输出开启时需要预检就绪状态的全部角色标识。 */
  voiceCheckCharacterIds?: string[]
  /** 注入输入框的回填草稿；对象更换时覆盖当前输入。 */
  injectedDraft?: { text: string }
  /** 编辑失败消息时展示在输入框上方的提示文案。 */
  editingNotice?: string
  /** 用户取消编辑失败消息。 */
  onCancelEdit?: () => void
}

type MentionContext = {
  start: number
  end: number
  query: string
}

/**
 * @description 从输入框光标前的文本中提取当前正在输入的角色提及片段。
 * @param value 输入框当前文本。
 * @param cursor 输入框光标位置。
 * @returns 当前提及的起止位置和搜索文本；不在提及输入状态时返回 null。
 */
function getMentionContext(value: string, cursor: number): MentionContext | null {
  const beforeCursor = value.slice(0, cursor)
  const match = /(?:^|\s)@([^\s@]*)$/u.exec(beforeCursor)
  if (!match || match.index < 0) return null

  const start = match.index + match[0].length - match[1].length - 1
  return { start, end: cursor, query: match[1] }
}

/**
 * @description 将图片文件读取为可直接展示和提交给模型的数据 URL。
 * @param file 待读取的图片文件。
 * @returns 包含图片数据 URL 的 Promise。
 */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('无法读取图片文件'))
      }
    }
    reader.onerror = () => reject(reader.error ?? new Error('无法读取图片文件'))
    reader.readAsDataURL(file)
  })
}

/**
 * @description 判断文件是否符合当前聊天图片上传限制。
 * @param file 待校验的文件。
 * @returns 校验失败时返回中文提示，否则返回 null。
 */
function validateImageFile(file: File): string | null {
  if (!IMAGE_MIME_TYPES.has(file.type as ChatImageInput['mimeType'])) {
    return `不支持的图片格式：${file.name}`
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return `图片不能超过 10 MB：${file.name}`
  }
  return null
}

export default function ChatComposer({
  onSendMessage,
  onStop,
  isLoading,
  charId,
  participantNames = [],
  allowImages = true,
  onTypingActivity,
  onEmoticonPick,
  onRunCommand,
  voiceCheckCharacterIds = [],
  injectedDraft,
  editingNotice,
  onCancelEdit
}: ChatComposerProps): ReactElement {
  const [input, setInput] = useState('')
  const [images, setImages] = useState<ChatImageInput[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const [emoticons, setEmoticons] = useState<ChatEmoticonImage[]>([])
  const [isMentionPickerOpen, setIsMentionPickerOpen] = useState(false)
  const [mentionCandidates, setMentionCandidates] = useState<string[]>([])
  const [mentionCandidateIndex, setMentionCandidateIndex] = useState(0)
  const [commandCandidates, setCommandCandidates] = useState<
    readonly (typeof CHAT_COMMANDS)[number][]
  >([])
  const [commandCandidateIndex, setCommandCandidateIndex] = useState(0)
  const providersStore = useProvidersStore((state) => state.store)
  const selectedModelId = useModelSelectionStore((state) => state.selectedModelId)
  const selectedModel = findProviderModel(providersStore, selectedModelId)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cursorPositionRef = useRef(0)
  const voiceCheckInFlightRef = useRef(false)
  const emoticonPickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void getUserEmoticons()
      .then(setEmoticons)
      .catch((cause) =>
        trackError('load-user-emoticons-failed', 'Failed to load user emoticons', cause)
      )
  }, [])

  // 表情选择框失焦隐藏：面板打开期间监听按下事件，按压点落在触发按钮与面板容器之外即收起；
  // 用 pointerdown 而非 click，保证先于焦点转移与其他点击副作用收起。
  useEffect(() => {
    if (!isPickerOpen) {
      return
    }
    const handlePointerDown = (event: PointerEvent): void => {
      if (!emoticonPickerRef.current?.contains(event.target as Node)) {
        setIsPickerOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [isPickerOpen])

  /**
   * @description 将选中的图片加入当前待发送列表，并生成稳定的资源标识。
   * @param files 用户选择、粘贴或拖入的文件列表。
   * @returns 无返回值。
   */
  const addFiles = async (files: FileList | File[]): Promise<void> => {
    const selected = Array.from(files)
    const remaining = MAX_IMAGE_COUNT - images.length
    if (remaining <= 0) {
      toast.error(`单次最多上传 ${MAX_IMAGE_COUNT} 张图片`)
      return
    }

    const nextFiles = selected.slice(0, remaining)
    const errors: string[] = []
    const nextImages: ChatImageInput[] = []
    for (const file of nextFiles) {
      const validationError = validateImageFile(file)
      if (validationError) {
        errors.push(validationError)
        continue
      }
      try {
        const dataUrl = await readFileAsDataUrl(file)
        nextImages.push({
          resourceId: globalThis.crypto.randomUUID(),
          fileName: file.name,
          mimeType: file.type as ChatImageInput['mimeType'],
          sizeBytes: file.size,
          analysis: '',
          dataUrl
        })
      } catch (readError) {
        trackError('read-chat-image-failed', 'Failed to read chat image', readError)
        errors.push(`无法读取图片：${file.name}`)
      }
    }

    if (selected.length > remaining) {
      errors.push(`单次最多上传 ${MAX_IMAGE_COUNT} 张图片`)
    }
    if (errors.length > 0) {
      toast.error(errors.join('；'))
    }
    if (nextImages.length > 0) {
      setImages((current) => [...current, ...nextImages].slice(0, MAX_IMAGE_COUNT))
    }
  }

  // 回填草稿注入：渲染期比较注入对象，更换时覆盖输入框（React 认可的按 props 调整自身状态模式）。
  const [lastInjectedDraft, setLastInjectedDraft] = useState(injectedDraft)
  if (lastInjectedDraft !== injectedDraft) {
    setLastInjectedDraft(injectedDraft)
    if (injectedDraft?.text) {
      setInput(injectedDraft.text)
    }
  }

  /**
   * @description 发送当前文本和图片，并清空待发送草稿。
   * @remarks 语音输出开启时先做角色语音就绪预检，不通过则不发送并以 toast 提示原因；
   *   图片能力关闭时移除待发送图片并提示，兜住「先选图后切模型」的中间态。
   */
  const handleSend = (): void => {
    if (
      (!input.trim() && images.length === 0) ||
      isLoading ||
      (!charId && participantNames.length < 2) ||
      !selectedModel
    ) {
      return
    }
    if (!allowImages && images.length > 0) {
      setImages([])
      toast.error('当前模型不支持图片输入，已移除待发送图片。')
      return
    }
    if (voiceCheckInFlightRef.current) {
      return
    }
    if (voiceCheckCharacterIds.length > 0) {
      voiceCheckInFlightRef.current = true
      void getVoiceOutputBlockReason(voiceCheckCharacterIds)
        .then((reason) => {
          if (reason) {
            toast.error(reason)
            return
          }
          dispatchSend()
        })
        .catch((error) => {
          trackError(
            'voice-readiness-check-failed',
            'Failed to check voice output readiness',
            error
          )
          toast.error('语音就绪检查失败，请重试。')
        })
        .finally(() => {
          voiceCheckInFlightRef.current = false
        })
      return
    }
    dispatchSend()
  }

  /**
   * @description 按当前输入执行真实发送,成功后才清空输入区草稿。
   * @remarks 发送失败时保留草稿并交由 ChatPanel 呈现错误 toast,避免用户消息无反馈丢失。
   */
  const dispatchSend = (): void => {
    const text = input.trim()
    const sentImages = images
    void Promise.resolve(onSendMessage(text, sentImages)).then(
      () => {
        setInput('')
        setImages([])
        inputRef.current?.focus()
      },
      () => undefined
    )
  }

  /**
   * @description 根据当前输入光标位置刷新角色提及候选框。
   * @param value 输入框当前文本。
   * @param cursor 输入框光标位置。
   * @returns 无返回值。
   */
  const updateMentionCandidates = (value: string, cursor: number): void => {
    cursorPositionRef.current = cursor
    const context = getMentionContext(value, cursor)
    if (!context || participantNames.length === 0) {
      setIsMentionPickerOpen(false)
      setMentionCandidates([])
      setMentionCandidateIndex(0)
      return
    }

    const query = context.query.toLocaleLowerCase()
    const candidates = participantNames.filter((name) => name.toLocaleLowerCase().startsWith(query))
    setMentionCandidates(candidates)
    setMentionCandidateIndex(0)
    setIsMentionPickerOpen(candidates.length > 0)
  }

  /**
   * @description 将候选角色名称替换当前正在输入的提及片段。
   * @param name 要插入的角色名称。
   * @returns 无返回值。
   */
  const insertMention = (name: string): void => {
    const cursor = cursorPositionRef.current
    const context = getMentionContext(input, cursor)
    if (!context) return

    const nextInput = `${input.slice(0, context.start)}@${name} ${input.slice(context.end)}`
    const nextCursor = context.start + name.length + 2
    setInput(nextInput)
    setIsMentionPickerOpen(false)
    setMentionCandidates([])
    cursorPositionRef.current = nextCursor
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(nextCursor, nextCursor)
    })
  }

  /**
   * @description 根据当前输入刷新斜杠命令候选框；仅当输入以 `/` 开头时进入命令状态。
   * @param value 输入框当前文本。
   */
  const updateCommandCandidates = (value: string): void => {
    if (!value.startsWith('/')) {
      setCommandCandidates([])
      setCommandCandidateIndex(0)
      return
    }
    const query = value.slice(1).trim().toLocaleLowerCase()
    const candidates = CHAT_COMMANDS.filter((command) =>
      command.label.toLocaleLowerCase().includes(query)
    )
    setCommandCandidates(candidates)
    setCommandCandidateIndex(0)
  }

  /**
   * @description 执行选中的会话命令并清空输入区。
   * @param command 要执行的命令标识。
   */
  const runCommand = (command: ChatCommandId): void => {
    setInput('')
    setCommandCandidates([])
    onRunCommand(command)
    inputRef.current?.focus()
  }

  /**
   * @description 处理文本框的回车发送快捷键。
   * @param event 键盘事件。
   */
  const handleKeyPress = (event: KeyboardEvent): void => {
    if (commandCandidates.length > 0) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setCommandCandidates([])
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setCommandCandidateIndex((current) => {
          const offset = event.key === 'ArrowDown' ? 1 : -1
          return (current + offset + commandCandidates.length) % commandCandidates.length
        })
        return
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        runCommand(commandCandidates[commandCandidateIndex].id)
        return
      }
    }
    if (isMentionPickerOpen && mentionCandidates.length > 0) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setIsMentionPickerOpen(false)
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setMentionCandidateIndex((current) => {
          const offset = event.key === 'ArrowDown' ? 1 : -1
          return (current + offset + mentionCandidates.length) % mentionCandidates.length
        })
        return
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        insertMention(mentionCandidates[mentionCandidateIndex])
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSend()
    }
  }

  /**
   * @description 处理文件选择控件的图片输入。
   * @param event 文件输入变化事件。
   */
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    if (event.target.files) {
      void addFiles(event.target.files)
    }
    event.target.value = ''
  }

  /**
   * @description 从剪贴板提取图片并加入待发送列表。
   * @param event 剪贴板粘贴事件。
   */
  const handlePaste = (event: ClipboardEvent<HTMLInputElement>): void => {
    const files = Array.from(event.clipboardData.files).filter((file) =>
      file.type.startsWith('image/')
    )
    if (allowImages && files.length > 0) {
      event.preventDefault()
      void addFiles(files)
    }
  }

  /**
   * @description 处理拖拽释放图片文件的交互状态。
   * @param event 拖拽事件。
   */
  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setIsDragging(false)
    if (allowImages && !isLoading && event.dataTransfer.files.length > 0) {
      void addFiles(event.dataTransfer.files)
    }
  }

  const containerClassName =
    'absolute right-26 bottom-2 left-30 z-100 rounded-xl border-2 px-2 backdrop-blur-sm transition-colors focus-within:bg-white/90 hover:bg-white/60 ' +
    (isDragging ? 'border-[#393C4B] bg-white/90' : 'border-[#e5e7eb] bg-white/40')

  return (
    <div
      className={containerClassName}
      onDragEnter={(event) => {
        event.preventDefault()
        if (!isLoading) setIsDragging(true)
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setIsDragging(false)
      }}
      onDrop={handleDrop}
    >
      {images.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-1 pt-2">
          {images.map((image) => (
            <div
              key={image.resourceId}
              className="relative size-12 shrink-0 overflow-hidden rounded-md border border-white/70 bg-gray-100"
            >
              <img src={image.dataUrl} alt={image.fileName} className="size-full object-cover" />
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() =>
                  setImages((current) =>
                    current.filter((item) => item.resourceId !== image.resourceId)
                  )
                }
                className="absolute top-0 right-0 size-5 rounded-none bg-black/55 text-white hover:bg-black/70"
                title="移除图片"
                aria-label={`移除图片 ${image.fileName}`}
              >
                <X className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
      {editingNotice && (
        <div className="mx-1 mt-2 flex items-center gap-2 rounded-md bg-[#e8c690]/20 px-2 py-1 text-xs text-[#7a5c1e]">
          <Pencil className="size-3 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{editingNotice}</span>
          <button
            type="button"
            onClick={onCancelEdit}
            className="flex size-4 shrink-0 items-center justify-center rounded-full text-current opacity-60 transition-colors hover:bg-black/10 hover:opacity-100"
            title="取消编辑"
            aria-label="取消编辑"
          >
            <X className="size-3" />
          </button>
        </div>
      )}
      <div className="flex h-14 items-center gap-1">
        <ComposerContextRing />
        <div className="relative" ref={emoticonPickerRef}>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsPickerOpen((open) => !open)}
            disabled={isLoading || (!charId && participantNames.length < 2)}
            className="size-10 shrink-0 cursor-pointer rounded-lg text-gray-400 hover:bg-gray-100 hover:text-[#333] aria-expanded:bg-gray-100 aria-expanded:text-[#333]"
            title="发送表情"
            aria-label="发送表情"
            aria-expanded={isPickerOpen}
          >
            <Smile className="size-5" />
          </Button>
          {isPickerOpen && (
            <ComposerPopover className="absolute bottom-12 left-0 z-20 grid w-56 grid-cols-4 gap-2 p-2">
              {emoticons.map((emoticon) => (
                <button
                  key={emoticon.id}
                  type="button"
                  disabled={emoticon.unavailable || !emoticon.dataUrl}
                  onClick={() => {
                    onEmoticonPick(emoticon.id)
                    setIsPickerOpen(false)
                  }}
                  className="flex aspect-square items-center justify-center rounded-md hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
                  title={`${emoticon.id}：${emoticon.description}`}
                  aria-label={emoticon.description}
                >
                  {emoticon.dataUrl ? (
                    <img
                      src={emoticon.dataUrl}
                      alt={emoticon.description}
                      className="size-10 object-contain"
                      draggable="false"
                    />
                  ) : (
                    <span className="size-10 rounded bg-gray-200" />
                  )}
                </button>
              ))}
            </ComposerPopover>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={handleFileChange}
          disabled={isLoading || !charId || !allowImages}
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoading || !charId || !allowImages || images.length >= MAX_IMAGE_COUNT}
          className="size-10 shrink-0 cursor-pointer rounded-lg text-gray-400 hover:bg-gray-100 hover:text-[#333]"
          title={allowImages ? '添加图片' : '当前模型不支持图片输入'}
          aria-label={allowImages ? '添加图片' : '当前模型不支持图片输入'}
        >
          <ImagePlus className="size-5" />
        </Button>
        <div className="relative min-w-0 flex-1">
          {commandCandidates.length > 0 && (
            <ComposerPopover className="absolute right-0 bottom-12 left-0 z-20 flex max-h-48 flex-col gap-1 overflow-y-auto p-2">
              {commandCandidates.map((command, index) => (
                <button
                  key={command.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => runCommand(command.id)}
                  className={`rounded px-2 py-1 text-left hover:bg-gray-100 ${
                    index === commandCandidateIndex ? 'bg-gray-100' : ''
                  }`}
                >
                  <span className="text-sm text-[#333]">/{command.label}</span>
                  <span className="ml-2 text-xs text-gray-400">{command.description}</span>
                </button>
              ))}
            </ComposerPopover>
          )}
          {isMentionPickerOpen && mentionCandidates.length > 0 && (
            <ComposerPopover className="absolute right-0 bottom-12 left-0 z-20 flex max-h-48 flex-col gap-1 overflow-y-auto p-2">
              {mentionCandidates.map((name, index) => (
                <button
                  key={name}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => insertMention(name)}
                  className={`rounded px-2 py-1 text-left text-sm text-[#333] hover:bg-gray-100 ${
                    index === mentionCandidateIndex ? 'bg-gray-100' : ''
                  }`}
                >
                  @{name}
                </button>
              ))}
            </ComposerPopover>
          )}
          <input
            ref={inputRef}
            type="text"
            placeholder="发送消息...（输入 / 唤出命令）"
            value={input}
            onChange={(event) => {
              const cursor = event.target.selectionStart ?? event.target.value.length
              setInput(event.target.value)
              updateMentionCandidates(event.target.value, cursor)
              updateCommandCandidates(event.target.value)
              onTypingActivity?.()
            }}
            onSelect={(event) => {
              const cursor = event.currentTarget.selectionStart ?? input.length
              updateMentionCandidates(input, cursor)
              updateCommandCandidates(input)
            }}
            onKeyDown={handleKeyPress}
            onPaste={handlePaste}
            disabled={isLoading || (!charId && participantNames.length < 2)}
            className="h-full w-full min-w-0 bg-transparent px-2 text-[#333] outline-none placeholder:text-gray-400 disabled:opacity-50"
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={isLoading ? onStop : handleSend}
          disabled={
            ((!input.trim() && images.length === 0) ||
              (!charId && participantNames.length < 2) ||
              !selectedModel) &&
            !isLoading
          }
          className="size-10 shrink-0 cursor-pointer rounded-lg text-gray-400 hover:bg-gray-100 hover:text-[#333]"
          title={isLoading ? '停止生成' : selectedModel ? '发送消息' : '请先在左侧选择模型'}
          aria-label={isLoading ? '停止生成' : '发送消息'}
        >
          {isLoading ? (
            <div className="group relative flex size-10 items-center justify-center">
              <div className="absolute size-5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600 group-hover:opacity-0" />
              <StopCircle className="absolute size-5 opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
          ) : (
            <Send className="size-5" />
          )}
        </Button>
      </div>
    </div>
  )
}
