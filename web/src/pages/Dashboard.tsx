import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Trash2, Activity, FolderGit2, Clock } from 'lucide-react'
import { useProjects } from '../hooks/useProjects'
import { useStatus } from '../hooks/useStatus'
import { api } from '../lib/api'
import { Button } from '../components/ui/button'
import { Dialog, DialogTitle, DialogDescription } from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { Badge } from '../components/ui/badge'
import { Select } from '../components/ui/select'
import { useToast } from '../components/ui/toast'

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

const PROJECT_NAME_RE = /^[a-zA-Z0-9-]+$/

export function Dashboard() {
  const { status } = useStatus()
  const { projects, loading, error, refresh } = useProjects()
  const { toast } = useToast()

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newRepoUrl, setNewRepoUrl] = useState('')
  const [newModel, setNewModel] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    if (createOpen) {
      api.getModels().then(setModels).catch(() => setModels([]))
    }
  }, [createOpen])

  async function handleCreate() {
    if (!newName.trim()) return
    if (!PROJECT_NAME_RE.test(newName)) {
      setCreateError('Name must be alphanumeric with hyphens only')
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      await api.createProject(newName.trim(), newRepoUrl.trim() || undefined)
      setCreateOpen(false)
      setNewName('')
      setNewRepoUrl('')
      setNewModel('')
      toast('success', `Project "${newName.trim()}" created`)
      await refresh()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err))
      toast('error', 'Failed to create project')
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await api.deleteProject(deleteTarget)
      toast('success', `Project "${deleteTarget}" deleted`)
      setDeleteTarget(null)
      await refresh()
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err))
      toast('error', 'Failed to delete project')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Status header */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Dashboard</h1>
            {status && (
              <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-zinc-400">
                <span className="flex items-center gap-1.5">
                  <Activity className="h-4 w-4 text-emerald-400" />
                  {status.machineName}
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4" />
                  {formatUptime(status.uptime)}
                </span>
                <span>{status.activeSessionCount} active session{status.activeSessionCount !== 1 ? 's' : ''}</span>
                <span>{status.totalProjects} project{status.totalProjects !== 1 ? 's' : ''}</span>
              </div>
            )}
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Create Project
          </Button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-lg border border-red-800 bg-red-900/20 p-4 text-sm text-red-400">
          Failed to load projects: {error}
        </div>
      )}

      {/* Project grid */}
      {loading ? (
        <p className="text-zinc-400">Loading projects...</p>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 p-12 text-center">
          <FolderGit2 className="h-12 w-12 text-zinc-600" />
          <p className="mt-4 text-lg font-medium">No projects yet</p>
          <p className="mt-1 text-sm text-zinc-400">Create one to get started.</p>
          <Button className="mt-4" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Create Project
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <div
              key={p.name}
              className="group relative rounded-lg border border-zinc-800 bg-zinc-900 p-4 transition-colors hover:border-zinc-700"
            >
              <Link to={`/project/${p.name}`} className="block">
                <h3 className="font-semibold group-hover:text-emerald-400 transition-colors">
                  {p.name}
                </h3>
                <p className="mt-1 text-sm text-zinc-400">{p.model}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge variant={p.isActive ? 'success' : 'default'}>
                    {p.isActive ? 'Active' : 'Idle'}
                  </Badge>
                  {p.source?.type === 'github' && (
                    <Badge variant="warning">GitHub</Badge>
                  )}
                </div>
                <p className="mt-3 text-xs text-zinc-500">
                  {formatRelativeTime(p.createdAt)}
                </p>
              </Link>
              <button
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setDeleteTarget(p.name)
                }}
                className="absolute right-3 top-3 rounded-md p-1.5 text-zinc-500 opacity-0 transition-all hover:bg-zinc-800 hover:text-red-400 group-hover:opacity-100"
                aria-label={`Delete ${p.name}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Create Project Dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)}>
        <DialogTitle>Create Project</DialogTitle>
        <DialogDescription>Set up a new project for Wingman to manage.</DialogDescription>

        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Name</label>
            <Input
              placeholder="my-project"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <p className="mt-1 text-xs text-zinc-500">Alphanumeric characters and hyphens only</p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Repository URL (optional)</label>
            <Input
              placeholder="https://github.com/owner/repo"
              value={newRepoUrl}
              onChange={(e) => setNewRepoUrl(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Model</label>
            <Select value={newModel} onChange={(e) => setNewModel(e.target.value)}>
              <option value="">Default</option>
              {models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </Select>
          </div>
          {createError && (
            <p className="text-sm text-red-400">{createError}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Delete Project</DialogTitle>
        <DialogDescription>
          Are you sure you want to delete <strong>{deleteTarget}</strong>?
        </DialogDescription>
        <p className="mt-2 text-sm text-zinc-400">
          This will delete the project and all its data.
        </p>
        {deleteError && (
          <p className="mt-2 text-sm text-red-400">{deleteError}</p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </Dialog>
    </div>
  )
}
