import type { ProjectConfig, PermissionPolicy } from './types'

const BASE = '/api'

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error || res.statusText)
  }
  return res.json()
}

export interface MachineStatus {
  machineName: string
  activeSessionCount: number
  activeProjects: string[]
  totalProjects: number
  uptime: number
}

export interface ProjectInfo extends ProjectConfig {
  isActive: boolean
  isIdle?: boolean
}

// Re-export PermissionPolicy so consumers can import from api
export type { PermissionPolicy }

export interface GitInfo {
  isRepo: boolean
  branch?: string
  remoteUrl?: string
  lastCommit?: { hash: string; message: string; author: string; date: string }
  status?: { modified: number; added: number; deleted: number; untracked: number }
}

export interface FileEntry {
  name: string
  type: 'file' | 'directory'
  size?: number
}

export interface FileListing {
  path: string
  entries: FileEntry[]
}

export interface CopilotSessionInfo {
  sessionId: string
  startTime: string
  modifiedTime: string
  summary?: string
  isRemote: boolean
  managed: boolean
  matchingProject?: string
  context?: {
    cwd: string
    gitRoot?: string
    repository?: string
    branch?: string
  }
}

export interface HistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface SessionHistory {
  history: HistoryMessage[]
  sessionId: string | null
}

export const api = {
  getStatus: () => request<MachineStatus>('/status'),
  getProjects: () => request<ProjectInfo[]>('/projects'),
  getProject: (name: string) => request<ProjectInfo>(`/projects/${name}`),
  createProject: (name: string, repoUrl?: string) =>
    request<ProjectConfig>('/projects', {
      method: 'POST',
      body: JSON.stringify({ name, repoUrl }),
    }),
  updateProject: (name: string, updates: Record<string, unknown>) =>
    request<ProjectConfig>(`/projects/${name}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }),
  deleteProject: (name: string) =>
    request<{ success: boolean }>(`/projects/${name}`, { method: 'DELETE' }),
  getModels: () => request<string[]>('/models'),
  getGitInfo: (name: string) => request<GitInfo>(`/projects/${name}/git`),
  getFiles: (name: string, dir?: string) =>
    request<FileListing>(`/projects/${name}/files${dir ? `?dir=${encodeURIComponent(dir)}` : ''}`),
  getSessions: () => request<CopilotSessionInfo[]>('/sessions'),
  getHistory: (name: string) => request<SessionHistory>(`/projects/${name}/history`),
  joinSession: (projectName: string, sessionId: string) =>
    request<{ success: boolean; sessionId: string; summary: string }>(`/projects/${projectName}/join`, {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    }),
  leaveSession: (projectName: string) =>
    request<{ success: boolean }>(`/projects/${projectName}/leave`, { method: 'POST' }),
}
