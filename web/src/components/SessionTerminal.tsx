import { useEffect, useRef } from 'react'
import type { SessionLine } from '../hooks/useSession'
import { cn } from '../lib/utils'

interface SessionTerminalProps {
  lines: SessionLine[]
  onClear?: () => void
  className?: string
}

export function SessionTerminal({ lines, onClear, className }: SessionTerminalProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  // Group consecutive deltas into single blocks
  const groups: { type: SessionLine['type']; content: string; id: string }[] = []
  for (const line of lines) {
    if (line.type === 'delta' && groups.length > 0 && groups[groups.length - 1].type === 'delta') {
      groups[groups.length - 1].content += line.content
    } else {
      groups.push({ type: line.type, content: line.content, id: line.id })
    }
  }

  return (
    <div className={cn('flex flex-col rounded-lg border border-zinc-800 bg-black', className)}>
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
        <span className="text-xs font-medium text-zinc-400">Session Output</span>
        {onClear && (
          <button
            onClick={onClear}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Clear
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-4 font-mono text-sm min-h-[300px] max-h-[600px]">
        {groups.length === 0 ? (
          <p className="text-zinc-600 italic">No output yet. Send a prompt to start.</p>
        ) : (
          groups.map((g) => (
            <div
              key={g.id}
              className={cn('whitespace-pre-wrap break-words', {
                'text-emerald-400 font-bold': g.type === 'prompt',
                'text-zinc-300': g.type === 'delta',
                'text-zinc-100': g.type === 'message',
                'text-yellow-400': g.type === 'tool',
                'text-zinc-600 italic my-2': g.type === 'idle',
                'text-red-400': g.type === 'error',
                'text-orange-400': g.type === 'permission',
                'text-cyan-400': g.type === 'question',
                'text-blue-400': g.type === 'answer',
                'text-purple-400 italic': g.type === 'intent',
                'text-sky-400 border-l-2 border-sky-700 pl-2': g.type === 'subagent',
                'text-zinc-500 italic text-center my-1 border-t border-zinc-800 pt-1': g.type === 'history',
              })}
            >
              {g.content}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
