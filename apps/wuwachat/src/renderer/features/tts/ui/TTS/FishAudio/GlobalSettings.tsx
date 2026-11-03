import { useState, type ReactElement } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '@renderer/common/components/input'
import { Button } from '@renderer/common/components/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/common/components/select'

export default function FishGlobalSettings({
  settings,
  onChange
}: {
  settings: { apiKey: string; model: string }
  onChange: (patch: Partial<{ apiKey: string; model: string }>) => Promise<void>
}): ReactElement {
  const [showApiKey, setShowApiKey] = useState(false)
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-white/55">Fish Audio API Key</span>
        <span className="relative">
          <Input
            type={showApiKey ? 'text' : 'password'}
            value={settings.apiKey}
            onChange={(event) => void onChange({ apiKey: event.currentTarget.value })}
            className="w-full pr-10"
            placeholder="输入 API Key"
            autoComplete="off"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'}
            onClick={() => setShowApiKey((value) => !value)}
            className="absolute inset-y-0 right-2 my-auto text-white/45 hover:text-white/80"
          >
            {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
        </span>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-white/55">模型</span>
        <Select value={settings.model} onValueChange={(value) => void onChange({ model: value })}>
          <SelectTrigger className="h-10 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="s2.1-pro-free">s2.1-pro-free</SelectItem>
            <SelectItem value="s2.1-pro">s2.1-pro</SelectItem>
            <SelectItem value="s2-pro">s2-pro</SelectItem>
            <SelectItem value="s1">s1</SelectItem>
          </SelectContent>
        </Select>
      </label>
    </div>
  )
}
