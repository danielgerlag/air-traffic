import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'
import type { CopilotSessionInfo } from '../lib/api'

interface SessionPickerProps {
  projectName: string
  onJoined?: () => void
}

export function SessionPicker({ projectName, onJoined }: SessionPickerProps) {
  const [sessions, setSessions] = useState<CopilotSessionInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [joining, setJoining] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const all = await api.getSessions()
      // Filter out already-managed sessions (except those matching this project)
      const available = all.filter(s => !s.managed || s.matchingProject === projectName)
      setSessions(available)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions')
    } finally {
      setLoading(false)
    }
  }, [projectName])

  useEffect(() => {
    if (expanded) refresh()
  }, [expanded, refresh])

  const handleJoin = async (sessionId: string) => {
    setJoining(sessionId)
    setError(null)
    try {
      await api.joinSession(projectName, sessionId)
      setExpanded(false)
      onJoined?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join session')
    } finally {
      setJoining(null)
    }
  }

  const handleLeave = async () => {
    setError(null)
    try {
      await api.leaveSession(projectName)
      onJoined?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to leave session')
    }
  }

  const formatAge = (dateStr: string) => {
    const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
    if (seconds < 60) return 'just now'
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.floor(hours / 24)}d ago`
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors px-2 py-1 rounded border border-zinc-700 hover:border-zinc-500"
        >
          🔗 {expanded ? 'Hide' : 'Join'} Session
        </button>
        <button
          onClick={handleLeave}
          className="text-xs text-zinc-500 hover:text-orange-400 transition-colors"
          title="Leave current session (keeps it alive)"
        >
          👋 Leave
        </button>
      </div>

      {expanded && (
        <div className="absolute top-8 left-0 z-50 w-[480px] bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-zinc-300">Available Copilot Sessions</span>
            <button
              onClick={refresh}
              disabled={loading}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              {loading ? '⏳' : '🔄'} Refresh
            </button>
          </div>

          {error && (
            <p className="text-xs text-red-400 mb-2">{error}</p>
          )}

          {sessions.length === 0 && !loading && (
            <p className="text-xs text-zinc-500 italic">No external sessions found.</p>
          )}

          <div className="max-h-[300px] overflow-y-auto space-y-1">
            {sessions.map(s => (
              <div
                key={s.sessionId}
                className={`flex items-start justify-between gap-2 p-2 rounded text-xs ${
                  s.matchingProject === projectName
                    ? 'bg-sky-950/30 border border-sky-800/50'
                    : 'bg-zinc-800/50 hover:bg-zinc-800'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <code className="text-zinc-400">{s.sessionId.slice(0, 8)}</code>
                    {s.matchingProject && (
                      <span className="text-sky-400">⭐</span>
                    )}
                    {s.managed && (
                      <span className="text-green-400 text-[10px]">managed</span>
                    )}
                    <span className="text-zinc-600">{formatAge(s.modifiedTime)}</span>
                  </div>
                  {s.summary && (
                    <p className="text-zinc-400 truncate mt-0.5">{s.summary}</p>
                  )}
                  {s.context && (
                    <p className="text-zinc-600 truncate">
                      {s.context.branch && `🔀 ${s.context.branch}`}
                      {s.context.cwd && ` 📁 ${s.context.cwd}`}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => handleJoin(s.sessionId)}
                  disabled={joining === s.sessionId || s.managed}
                  className="shrink-0 px-2 py-1 bg-sky-600 hover:bg-sky-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded text-[10px] font-medium transition-colors"
                >
                  {joining === s.sessionId ? '...' : 'Join'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
