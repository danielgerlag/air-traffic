import { Router } from 'express';
import type express from 'express';
import { simpleGit } from 'simple-git';
import fs from 'node:fs/promises';
import nodePath from 'node:path';
import type { WebServerDeps } from './server.js';

export function registerApiRoutes(
  app: express.Application,
  deps: WebServerDeps,
): void {
  const router = Router();

  // GET /api/status
  router.get('/status', async (_req, res) => {
    const projects = await deps.projectManager.listProjects();
    const activeNames = deps.orchestrator.getActiveProjectNames();
    res.json({
      machineName: deps.machineName,
      activeSessionCount: deps.orchestrator.getActiveSessionCount(),
      activeProjects: activeNames,
      totalProjects: projects.length,
      uptime: process.uptime(),
    });
  });

  // GET /api/projects
  router.get('/projects', async (_req, res) => {
    const projects = await deps.projectManager.listProjects();
    const activeNames = deps.orchestrator.getActiveProjectNames();
    const enriched = projects.map((p) => ({
      ...p,
      isActive: activeNames.includes(p.name),
    }));
    res.json(enriched);
  });

  // POST /api/projects  { name: string, repoUrl?: string }
  router.post('/projects', async (req, res) => {
    try {
      const { name, repoUrl } = req.body as {
        name: string;
        repoUrl?: string;
      };
      const project = await deps.projectManager.createProject(
        name,
        deps.machineName,
        repoUrl ? { repoUrl } : undefined,
      );
      res.status(201).json(project);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  // GET /api/projects/:name
  router.get('/projects/:name', async (req, res) => {
    try {
      const project = await deps.projectManager.getProject(req.params.name);
      const session = deps.orchestrator.getSession(req.params.name);
      res.json({
        ...project,
        isActive: !!session,
        isIdle: session?.isIdle() ?? true,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(404).json({ error: message });
    }
  });

  // PATCH /api/projects/:name  { model?, agent?, permissions? }
  router.patch('/projects/:name', async (req, res) => {
    try {
      const updated = await deps.projectManager.updateProjectConfig(
        req.params.name,
        req.body as Record<string, unknown>,
      );
      res.json(updated);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  // DELETE /api/projects/:name
  router.delete('/projects/:name', async (req, res) => {
    try {
      const session = deps.orchestrator.getSession(req.params.name);
      if (session) {
        await session.disconnect();
        deps.orchestrator.removeSession(req.params.name);
      }
      await deps.projectManager.deleteProject(req.params.name);
      res.json({ success: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  // GET /api/models
  router.get('/models', (_req, res) => {
    res.json(deps.modelRegistry.getAvailable());
  });

  // GET /api/projects/:name/git
  router.get('/projects/:name/git', async (req, res) => {
    try {
      const project = await deps.projectManager.getProject(req.params.name);
      const projectPath = project.path;

      try {
        await fs.access(nodePath.join(projectPath, '.git'));
      } catch {
        res.json({ isRepo: false });
        return;
      }

      const git = simpleGit(projectPath);
      const [branchSummary, log, status] = await Promise.all([
        git.branch(),
        git.log({ maxCount: 1 }),
        git.status(),
      ]);

      const remotes = await git.getRemotes(true);
      const remoteUrl = remotes.length > 0 ? (remotes[0].refs.fetch || remotes[0].refs.push) : null;
      const lastCommit = log.latest
        ? {
            hash: log.latest.hash,
            message: log.latest.message,
            author: log.latest.author_name,
            date: log.latest.date,
          }
        : null;

      res.json({
        isRepo: true,
        branch: branchSummary.current,
        remoteUrl,
        lastCommit,
        status: {
          modified: status.modified.length,
          added: status.created.length,
          deleted: status.deleted.length,
          untracked: status.not_added.length,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(404).json({ error: message });
    }
  });

  // GET /api/projects/:name/files
  router.get('/projects/:name/files', async (req, res) => {
    try {
      const project = await deps.projectManager.getProject(req.params.name);
      const projectPath = project.path;
      const relativePath = (req.query.dir as string) || '.';

      const resolved = nodePath.resolve(projectPath, relativePath);
      const normalizedProject = nodePath.resolve(projectPath);
      if (!resolved.startsWith(normalizedProject + nodePath.sep) && resolved !== normalizedProject) {
        res.status(400).json({ error: 'Invalid path: traversal outside project directory' });
        return;
      }

      const dirents = await fs.readdir(resolved, { withFileTypes: true });
      const filtered = dirents.filter((d) => d.name !== '.git');

      const entries = await Promise.all(
        filtered.map(async (d) => {
          const entryPath = nodePath.join(resolved, d.name);
          if (d.isDirectory()) {
            return { name: d.name, type: 'directory' as const, size: undefined };
          }
          const stat = await fs.stat(entryPath);
          return { name: d.name, type: 'file' as const, size: stat.size };
        }),
      );

      entries.sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name);
        return a.type === 'directory' ? -1 : 1;
      });

      res.json({ path: relativePath, entries });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('ENOENT') || message.includes('ENOTDIR')) {
        res.status(400).json({ error: message });
      } else {
        res.status(404).json({ error: message });
      }
    }
  });

  // GET /api/projects/:name/history — get conversation history for active session
  router.get('/projects/:name/history', async (req, res) => {
    try {
      const session = deps.orchestrator.getSession(req.params.name);
      if (!session) {
        res.json({ history: [], sessionId: null });
        return;
      }
      const history = await session.getHistory();
      res.json({ history, sessionId: session.getSessionId() });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // GET /api/sessions — list all Copilot CLI sessions
  router.get('/sessions', async (_req, res) => {
    try {
      const projects = await deps.projectManager.listProjects();
      const projectPaths = new Map(projects.map((p) => [p.name, p.path]));
      const sessions = await deps.orchestrator.listAllSessions(projectPaths);
      res.json(sessions);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // POST /api/projects/:name/join  { sessionId: string }
  router.post('/projects/:name/join', async (req, res) => {
    try {
      const { sessionId } = req.body as { sessionId: string };
      if (!sessionId) {
        res.status(400).json({ error: 'sessionId is required' });
        return;
      }

      const projectName = req.params.name;
      const project = await deps.projectManager.getProject(projectName);

      // Disconnect existing session
      const existing = deps.orchestrator.getSession(projectName);
      if (existing) {
        await existing.disconnect();
        deps.orchestrator.removeSession(projectName);
      }

      const { AgentSession } = await import('../copilot/agent-session.js');
      const client = await deps.orchestrator.ensureClient();
      const agentSession = new AgentSession(
        client,
        deps.adapter,
        project,
        deps.permissionManager,
      );

      const summary = await agentSession.resumeExisting(sessionId, project.channelId);
      deps.orchestrator.registerSession(projectName, agentSession);

      res.json({ success: true, sessionId, summary });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  // POST /api/projects/:name/leave
  router.post('/projects/:name/leave', async (req, res) => {
    try {
      const projectName = req.params.name;
      const session = deps.orchestrator.getSession(projectName);
      if (!session) {
        res.status(404).json({ error: 'No active session for this project' });
        return;
      }

      await session.disconnect();
      deps.orchestrator.removeSession(projectName);
      res.json({ success: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.use('/api', router);
}
