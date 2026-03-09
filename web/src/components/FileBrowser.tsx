import { useState, useEffect } from 'react'
import { api, type FileListing } from '../lib/api'
import { Folder, File, ChevronRight } from 'lucide-react'

interface FileBrowserProps {
  projectName: string
}

function formatSize(bytes?: number): string {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function FileBrowser({ projectName }: FileBrowserProps) {
  const [currentDir, setCurrentDir] = useState('')
  const [listing, setListing] = useState<FileListing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api
      .getFiles(projectName, currentDir || undefined)
      .then(setListing)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [projectName, currentDir])

  const breadcrumbSegments = currentDir ? currentDir.split('/').filter(Boolean) : []

  const navigateToSegment = (index: number) => {
    setCurrentDir(breadcrumbSegments.slice(0, index + 1).join('/'))
  }

  const directories = listing?.entries.filter((e) => e.type === 'directory') ?? []
  const files = listing?.entries.filter((e) => e.type === 'file') ?? []

  return (
    <div className="border border-zinc-800 rounded-lg bg-black overflow-hidden">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-zinc-800 text-sm text-zinc-400 flex-wrap">
        <button
          onClick={() => setCurrentDir('')}
          className="hover:text-zinc-100 transition-colors font-medium"
        >
          root
        </button>
        {breadcrumbSegments.map((seg, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-zinc-600" />
            <button
              onClick={() => navigateToSegment(i)}
              className="hover:text-zinc-100 transition-colors"
            >
              {seg}
            </button>
          </span>
        ))}
      </div>

      {/* Content */}
      {loading && (
        <div className="px-4 py-8 text-center text-zinc-500">Loading…</div>
      )}
      {error && (
        <div className="px-4 py-8 text-center text-red-400">{error}</div>
      )}
      {!loading && !error && (
        <div className="divide-y divide-zinc-800/50">
          {currentDir && (
            <button
              onClick={() => {
                const parts = currentDir.split('/').filter(Boolean)
                parts.pop()
                setCurrentDir(parts.join('/'))
              }}
              className="w-full flex items-center gap-3 px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 transition-colors"
            >
              <Folder className="h-4 w-4 text-zinc-500" />
              <span>..</span>
            </button>
          )}
          {directories.map((entry) => (
            <button
              key={entry.name}
              onClick={() =>
                setCurrentDir(currentDir ? `${currentDir}/${entry.name}` : entry.name)
              }
              className="w-full flex items-center gap-3 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100 transition-colors"
            >
              <Folder className="h-4 w-4 text-emerald-400" />
              <span className="flex-1 text-left">{entry.name}</span>
            </button>
          ))}
          {files.map((entry) => (
            <div
              key={entry.name}
              className="flex items-center gap-3 px-4 py-2 text-sm text-zinc-300"
            >
              <File className="h-4 w-4 text-zinc-500" />
              <span className="flex-1">{entry.name}</span>
              <span className="text-xs text-zinc-500">{formatSize(entry.size)}</span>
            </div>
          ))}
          {directories.length === 0 && files.length === 0 && (
            <div className="px-4 py-8 text-center text-zinc-500 text-sm">
              Empty directory
            </div>
          )}
        </div>
      )}
    </div>
  )
}
