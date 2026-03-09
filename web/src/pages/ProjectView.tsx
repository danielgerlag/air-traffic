import { useParams, Link } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useSession } from '../hooks/useSession'
import { api, type ProjectInfo, type GitInfo } from '../lib/api'
import { cn } from '../lib/utils'
import { SessionTerminal } from '../components/SessionTerminal'
import { PromptInput } from '../components/PromptInput'
import { ConfigPanel } from '../components/ConfigPanel'
import { FileBrowser } from '../components/FileBrowser'
import { SessionPicker } from '../components/SessionPicker'
import { ArrowLeft } from 'lucide-react'

export function ProjectView() {
  const { name } = useParams<{ name: string }>()
  const { lines, isStreaming, send, abort, clear } = useSession(name)
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [activeTab, setActiveTab] = useState<'session' | 'config' | 'files'>('session')
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null)

  useEffect(() => {
    if (name) {
      api.getProject(name).then(setProject).catch(console.error)
      api.getGitInfo(name).then(setGitInfo).catch(() => setGitInfo(null))
    }
  }, [name])

  if (!name) return null

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/" className="text-zinc-400 hover:text-zinc-100 transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{name}</h1>
          {project && (
            <>
              <p className="text-sm text-zinc-400">
                {project.model} · {project.isActive ? 'Active' : 'Idle'}
                {project.source?.type === 'github' && ` · ${project.source.repoUrl}`}
              </p>
              {project.path && (
                <p className="text-xs text-zinc-500 font-mono mt-0.5">
                  📁 {project.path}
                </p>
              )}
              {gitInfo?.isRepo && (
                <p className="text-xs text-zinc-500 mt-0.5">
                  🔀 {gitInfo.branch}
                  {gitInfo.remoteUrl && (
                    <span className="ml-2 text-zinc-600">· {gitInfo.remoteUrl}</span>
                  )}
                  {gitInfo.lastCommit && (
                    <span className="ml-2 text-zinc-600">
                      · {gitInfo.lastCommit.hash.slice(0, 7)} {gitInfo.lastCommit.message}
                    </span>
                  )}
                </p>
              )}
            </>
          )}
        </div>
        <div className="ml-auto">
          <SessionPicker
            projectName={name}
            onJoined={() => api.getProject(name).then(setProject).catch(console.error)}
          />
        </div>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 border-b border-zinc-800">
        <button
          onClick={() => setActiveTab('session')}
          className={cn(
            'px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
            activeTab === 'session'
              ? 'border-emerald-400 text-emerald-400'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          )}
        >
          Session
        </button>
        <button
          onClick={() => setActiveTab('config')}
          className={cn(
            'px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
            activeTab === 'config'
              ? 'border-emerald-400 text-emerald-400'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          )}
        >
          Config
        </button>
        <button
          onClick={() => setActiveTab('files')}
          className={cn(
            'px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
            activeTab === 'files'
              ? 'border-emerald-400 text-emerald-400'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          )}
        >
          Files
        </button>
      </div>

      {/* Tab content */}
      {activeTab === 'session' ? (
        <div className="space-y-4">
          <SessionTerminal lines={lines} onClear={clear} className="h-[calc(100vh-320px)]" />
          <PromptInput onSend={send} onAbort={abort} isStreaming={isStreaming} />
        </div>
      ) : activeTab === 'config' ? (
        project && <ConfigPanel project={project} onUpdate={setProject} />
      ) : (
        <FileBrowser projectName={name} />
      )}
    </div>
  )
}
