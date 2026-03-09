import { io, Socket } from 'socket.io-client'

let socket: Socket | null = null

export function getSocket(): Socket {
  if (!socket) {
    socket = io(window.location.origin, {
      transports: ['websocket', 'polling'],
    })
  }
  return socket
}

export function joinProject(name: string): void {
  getSocket().emit('join:project', name)
}

export function leaveProject(name: string): void {
  getSocket().emit('leave:project', name)
}

export function sendPrompt(projectName: string, text: string): void {
  getSocket().emit('prompt', { projectName, text })
}

export function abortSession(projectName: string): void {
  getSocket().emit('abort', projectName)
}
