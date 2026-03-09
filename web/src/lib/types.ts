export type PermissionMode = 'auto' | 'ask'

export interface PermissionPolicy {
  fileEdit: PermissionMode
  fileCreate: PermissionMode
  shell: PermissionMode
  git: PermissionMode
  network: PermissionMode
  default: PermissionMode
}

export interface ProjectConfig {
  name: string
  path: string
  channelId: string
  model: string
  agent?: string
  permissions: PermissionPolicy
  createdAt: string
  source?: { type: 'github' | 'empty'; repoUrl?: string }
}

export interface SessionEvent {
  projectName: string
  content?: string
  text?: string
  toolName?: string
  status?: string
  category?: string
  decision?: string
  question?: string
  answer?: string
  intent?: string
  choices?: string[]
  description?: string
  output?: string
  label?: string
}
