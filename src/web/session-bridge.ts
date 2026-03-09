import type { Server as SocketIOServer } from 'socket.io';
import type { AgentSession } from '../copilot/agent-session.js';

export class SessionBridge {
  private bridges: Map<string, () => void> = new Map();

  constructor(private io: SocketIOServer) {}

  /** Subscribe to an AgentSession's events and forward to the Socket.IO room. */
  bridge(projectName: string, session: AgentSession): void {
    this.unbridge(projectName);

    const room = `project:${projectName}`;
    const emitter = session.events;

    const onPrompt = (data: { text: string }) => {
      this.io.to(room).emit('session:prompt', { projectName, ...data });
    };
    const onDelta = (data: { content: string }) => {
      this.io.to(room).emit('session:delta', { projectName, ...data });
    };
    const onTool = (data: { toolName: string; status: string }) => {
      this.io.to(room).emit('session:tool', { projectName, ...data });
    };
    const onIdle = () => {
      this.io.to(room).emit('session:idle', { projectName });
    };
    const onIntent = (data: { intent: string }) => {
      this.io.to(room).emit('session:intent', { projectName, ...data });
    };
    const onPermissionRequest = (data: { toolName: string; category: string }) => {
      this.io.to(room).emit('session:permission_request', { projectName, ...data });
    };
    const onPermissionResponse = (data: { toolName: string; category: string; decision: string }) => {
      this.io.to(room).emit('session:permission_response', { projectName, ...data });
    };
    const onQuestion = (data: { question: string; choices?: string[] }) => {
      this.io.to(room).emit('session:question', { projectName, ...data });
    };
    const onAnswer = (data: { question: string; answer: string }) => {
      this.io.to(room).emit('session:answer', { projectName, ...data });
    };
    const onSubagent = (data: { status: string; description: string; output?: string }) => {
      this.io.to(room).emit('session:subagent', { projectName, ...data });
    };

    emitter.on('prompt', onPrompt);
    emitter.on('delta', onDelta);
    emitter.on('tool', onTool);
    emitter.on('idle', onIdle);
    emitter.on('intent', onIntent);
    emitter.on('permission_request', onPermissionRequest);
    emitter.on('permission_response', onPermissionResponse);
    emitter.on('question', onQuestion);
    emitter.on('answer', onAnswer);
    emitter.on('subagent', onSubagent);

    this.bridges.set(projectName, () => {
      emitter.off('prompt', onPrompt);
      emitter.off('delta', onDelta);
      emitter.off('tool', onTool);
      emitter.off('idle', onIdle);
      emitter.off('intent', onIntent);
      emitter.off('permission_request', onPermissionRequest);
      emitter.off('permission_response', onPermissionResponse);
      emitter.off('question', onQuestion);
      emitter.off('answer', onAnswer);
      emitter.off('subagent', onSubagent);
    });
  }

  unbridge(projectName: string): void {
    const cleanup = this.bridges.get(projectName);
    if (cleanup) {
      cleanup();
      this.bridges.delete(projectName);
    }
  }

  unbridgeAll(): void {
    for (const cleanup of this.bridges.values()) cleanup();
    this.bridges.clear();
  }
}
