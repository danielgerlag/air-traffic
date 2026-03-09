import { useState, useEffect, useCallback, useRef } from 'react'
import { getSocket, joinProject, leaveProject, sendPrompt, abortSession } from '../lib/socket'
import type { SessionEvent } from '../lib/types'

export interface SessionLine {
  id: string
  type: 'delta' | 'message' | 'tool' | 'idle' | 'prompt' | 'error' | 'permission' | 'question' | 'answer' | 'intent' | 'subagent'
  content: string
  timestamp: number
}

export function useSession(projectName: string | undefined) {
  const [lines, setLines] = useState<SessionLine[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const idCounter = useRef(0)

  const addLine = useCallback((type: SessionLine['type'], content: string) => {
    setLines(prev => [...prev, {
      id: `${idCounter.current++}`,
      type,
      content,
      timestamp: Date.now(),
    }])
  }, [])

  useEffect(() => {
    if (!projectName) return

    const socket = getSocket()
    joinProject(projectName)

    const onDelta = (data: SessionEvent) => {
      if (data.projectName === projectName) {
        setIsStreaming(true)
        addLine('delta', data.content ?? '')
      }
    }
    const onTool = (data: SessionEvent) => {
      if (data.projectName === projectName) {
        addLine('tool', `🔧 ${data.toolName}: ${data.status}`)
      }
    }
    const onIdle = (data: SessionEvent) => {
      if (data.projectName === projectName) {
        setIsStreaming(false)
        addLine('idle', '--- Session idle ---')
      }
    }
    const onPromptRemote = (data: SessionEvent) => {
      if (data.projectName === projectName) {
        setIsStreaming(true)
        addLine('prompt', `> ${data.text ?? ''}`)
      }
    }
    const onPermissionRequest = (data: SessionEvent) => {
      if (data.projectName === projectName) {
        addLine('permission', `🔒 Permission requested: ${data.toolName} (${data.category})`)
      }
    }
    const onPermissionResponse = (data: SessionEvent) => {
      if (data.projectName === projectName) {
        const icon = data.decision === 'allow' || data.decision === 'always_allow' ? '✅' : '❌'
        addLine('permission', `${icon} Permission ${data.decision}: ${data.toolName}`)
      }
    }
    const onQuestion = (data: SessionEvent) => {
      if (data.projectName === projectName) {
        addLine('question', `❓ ${data.question ?? ''}`)
      }
    }
    const onAnswer = (data: SessionEvent) => {
      if (data.projectName === projectName) {
        addLine('answer', `💬 ${data.answer ?? ''}`)
      }
    }
    const onIntent = (data: SessionEvent) => {
      if (data.projectName === projectName) {
        addLine('intent', `💭 ${data.intent ?? ''}`)
      }
    }
    const onSubagent = (data: SessionEvent) => {
      if (data.projectName === projectName) {
        if (data.status === 'start') {
          addLine('subagent', `🤖 Sub-agent started: ${data.description ?? ''}`)
        } else if (data.status === 'done') {
          const output = data.output ? `\n${data.output}` : ''
          addLine('subagent', `🤖 Sub-agent done: ${data.description ?? ''}${output}`)
        }
      }
    }
    const onError = (data: { message: string }) => {
      addLine('error', `❌ ${data.message}`)
    }

    socket.on('session:delta', onDelta)
    socket.on('session:tool', onTool)
    socket.on('session:idle', onIdle)
    socket.on('session:prompt', onPromptRemote)
    socket.on('session:intent', onIntent)
    socket.on('session:subagent', onSubagent)
    socket.on('session:permission_request', onPermissionRequest)
    socket.on('session:permission_response', onPermissionResponse)
    socket.on('session:question', onQuestion)
    socket.on('session:answer', onAnswer)
    socket.on('error', onError)

    return () => {
      leaveProject(projectName)
      socket.off('session:delta', onDelta)
      socket.off('session:tool', onTool)
      socket.off('session:idle', onIdle)
      socket.off('session:prompt', onPromptRemote)
      socket.off('session:intent', onIntent)
      socket.off('session:subagent', onSubagent)
      socket.off('session:permission_request', onPermissionRequest)
      socket.off('session:permission_response', onPermissionResponse)
      socket.off('session:question', onQuestion)
      socket.off('session:answer', onAnswer)
      socket.off('error', onError)
    }
  }, [projectName, addLine])

  const send = useCallback((text: string) => {
    if (!projectName) return
    addLine('prompt', `> ${text}`)
    sendPrompt(projectName, text)
    setIsStreaming(true)
  }, [projectName, addLine])

  const abort = useCallback(() => {
    if (!projectName) return
    abortSession(projectName)
  }, [projectName])

  const clear = useCallback(() => {
    setLines([])
  }, [])

  return { lines, isStreaming, send, abort, clear }
}
