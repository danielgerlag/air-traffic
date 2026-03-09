import { useState, useEffect } from 'react'
import { api, type ProjectInfo } from '../lib/api'
import type { PermissionPolicy, PermissionMode } from '../lib/types'
import { cn } from '../lib/utils'
import { Settings, Shield, Save, Loader2 } from 'lucide-react'
import { useToast } from './ui/toast'

interface ConfigPanelProps {
  project: ProjectInfo
  onUpdate: (p: ProjectInfo) => void
}

const PERMISSION_LABELS: Record<keyof PermissionPolicy, string> = {
  fileEdit: 'File Edit',
  fileCreate: 'File Create',
  shell: 'Shell',
  git: 'Git',
  network: 'Network',
  default: 'Default',
}

const PERMISSION_KEYS = Object.keys(PERMISSION_LABELS) as (keyof PermissionPolicy)[]

export function ConfigPanel({ project, onUpdate }: ConfigPanelProps) {
  const [model, setModel] = useState(project.model)
  const [agent, setAgent] = useState(project.agent ?? '')
  const [permissions, setPermissions] = useState<PermissionPolicy>({ ...project.permissions })
  const [models, setModels] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    api.getModels().then(setModels).catch(console.error)
  }, [])

  useEffect(() => {
    const changed =
      model !== project.model ||
      agent !== (project.agent ?? '') ||
      PERMISSION_KEYS.some((k) => permissions[k] !== project.permissions[k])
    setDirty(changed)
  }, [model, agent, permissions, project])

  const togglePermission = (key: keyof PermissionPolicy) => {
    setPermissions((prev) => ({
      ...prev,
      [key]: prev[key] === 'auto' ? 'ask' : 'auto',
    }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const updated = await api.updateProject(project.name, {
        model,
        agent: agent || undefined,
        permissions,
      })
      onUpdate({ ...updated, isActive: project.isActive, isIdle: project.isIdle } as ProjectInfo)
      setDirty(false)
      toast('success', 'Configuration saved')
    } catch (err) {
      console.error('Failed to save:', err)
      toast('error', 'Failed to save configuration')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Model & Agent */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-300">
          <Settings className="h-4 w-4 text-zinc-400" />
          General
        </div>

        <div className="space-y-1">
          <label htmlFor="model" className="block text-xs text-zinc-400">
            Model
          </label>
          <select
            id="model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-400"
          >
            {models.length === 0 && <option value={model}>{model}</option>}
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="agent" className="block text-xs text-zinc-400">
            Agent (optional)
          </label>
          <input
            id="agent"
            type="text"
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            placeholder="e.g. copilot"
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-400"
          />
        </div>
      </section>

      {/* Permissions */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-300">
          <Shield className="h-4 w-4 text-zinc-400" />
          Permissions
        </div>

        <div className="space-y-2">
          {PERMISSION_KEYS.map((key) => (
            <div
              key={key}
              className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-900 px-4 py-3"
            >
              <span className="text-sm text-zinc-300">{PERMISSION_LABELS[key]}</span>
              <div className="flex items-center gap-3">
                <ModeBadge mode={permissions[key]} />
                <button
                  onClick={() => togglePermission(key)}
                  className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  Toggle
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={!dirty || saving}
        className={cn(
          'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
          dirty
            ? 'bg-emerald-600 text-white hover:bg-emerald-700'
            : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
        )}
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {saving ? 'Saving...' : 'Save Changes'}
      </button>
    </div>
  )
}

function ModeBadge({ mode }: { mode: PermissionMode }) {
  return (
    <span
      className={cn('rounded-full px-2 py-0.5 text-xs font-medium', {
        'bg-emerald-400/10 text-emerald-400': mode === 'auto',
        'bg-yellow-400/10 text-yellow-400': mode === 'ask',
      })}
    >
      {mode}
    </span>
  )
}
