import { useState, useEffect } from 'react'
import { api, type MachineStatus } from '../lib/api'
import type { PermissionPolicy } from '../lib/types'
import { Activity, Clock, Server, Shield, Cpu } from 'lucide-react'
import { Badge } from '../components/ui/badge'

const DEFAULT_PERMISSIONS: PermissionPolicy = {
  fileEdit: 'auto',
  fileCreate: 'auto',
  shell: 'ask',
  git: 'ask',
  network: 'ask',
  default: 'ask',
}

const PERMISSION_LABELS: Record<keyof PermissionPolicy, string> = {
  fileEdit: 'File Edit',
  fileCreate: 'File Create',
  shell: 'Shell',
  git: 'Git',
  network: 'Network',
  default: 'Default',
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function Settings() {
  const [status, setStatus] = useState<MachineStatus | null>(null)
  const [models, setModels] = useState<string[]>([])

  useEffect(() => {
    api.getStatus().then(setStatus).catch(console.error)
    api.getModels().then(setModels).catch(console.error)
  }, [])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* Machine Info */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-300">
          <Server className="h-4 w-4 text-zinc-400" />
          Machine
        </div>
        {status ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <InfoRow icon={Activity} label="Machine Name" value={status.machineName} />
            <InfoRow icon={Clock} label="Uptime" value={formatUptime(status.uptime)} />
            <InfoRow icon={Cpu} label="Active Sessions" value={String(status.activeSessionCount)} />
            <InfoRow icon={Server} label="Total Projects" value={String(status.totalProjects)} />
          </div>
        ) : (
          <p className="text-sm text-zinc-500">Loading...</p>
        )}
      </section>

      {/* Available Models */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-300">
          <Cpu className="h-4 w-4 text-zinc-400" />
          Available Models
        </div>
        <div className="flex flex-wrap gap-2">
          {models.map((m) => (
            <Badge key={m} variant="default">{m}</Badge>
          ))}
        </div>
      </section>

      {/* Default Permissions */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-300">
          <Shield className="h-4 w-4 text-zinc-400" />
          Default Permissions (new projects)
        </div>
        <div className="space-y-2">
          {(Object.keys(DEFAULT_PERMISSIONS) as (keyof PermissionPolicy)[]).map((key) => (
            <div
              key={key}
              className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-900 px-4 py-3"
            >
              <span className="text-sm text-zinc-300">{PERMISSION_LABELS[key]}</span>
              <Badge variant={DEFAULT_PERMISSIONS[key] === 'auto' ? 'success' : 'warning'}>
                {DEFAULT_PERMISSIONS[key]}
              </Badge>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-zinc-800 bg-zinc-900 px-4 py-3">
      <Icon className="h-4 w-4 text-zinc-500" />
      <div>
        <p className="text-xs text-zinc-500">{label}</p>
        <p className="text-sm font-medium text-zinc-200">{value}</p>
      </div>
    </div>
  )
}
