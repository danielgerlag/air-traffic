import { useState, useRef, useCallback, type KeyboardEvent } from 'react'
import { cn } from '../lib/utils'
import { Send, Square } from 'lucide-react'

interface PromptInputProps {
  onSend: (text: string) => void
  onAbort?: () => void
  isStreaming?: boolean
  className?: string
}

export function PromptInput({ onSend, onAbort, isStreaming, className }: PromptInputProps) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed || isStreaming) return
    onSend(trimmed)
    setText('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }, [text, isStreaming, onSend])

  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInput = () => {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`
    }
  }

  return (
    <div className={cn('flex gap-2 items-end', className)}>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          handleInput()
        }}
        onKeyDown={handleKeyDown}
        placeholder="Send a prompt to Copilot..."
        rows={1}
        className="flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
      />
      {isStreaming ? (
        <button
          onClick={onAbort}
          className="flex h-11 w-11 items-center justify-center rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
          title="Abort"
        >
          <Square className="h-4 w-4" />
        </button>
      ) : (
        <button
          onClick={handleSend}
          disabled={!text.trim()}
          className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Send (Ctrl+Enter)"
        >
          <Send className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
