import type { Project, Workspace, ResumableSession, ResumableDevinSession, Settings } from './types';

export type AuthStatus = {
  required: boolean;
  authenticated: boolean;
  configured?: boolean;
  username?: string;
};

export async function getAuthStatus(): Promise<AuthStatus> {
  const r = await fetch('/api/auth/status', { credentials: 'include' });
  return r.json();
}

export async function login(username: string, password: string): Promise<boolean> {
  const r = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return r.ok;
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
}

export async function listProjects(): Promise<Project[]> {
  const r = await fetch('/api/projects');
  return r.json();
}

export async function addProject(input: { path: string; name?: string }): Promise<Project> {
  const r = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error((await r.json()).error || 'failed');
  return r.json();
}

export async function deleteProject(id: string): Promise<void> {
  await fetch(`/api/projects/${id}`, { method: 'DELETE' });
}

export async function getWorkspace(): Promise<Workspace> {
  const r = await fetch('/api/workspace');
  return r.json();
}

export async function putWorkspace(ws: Workspace): Promise<Workspace> {
  const r = await fetch('/api/workspace', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ws),
  });
  return r.json();
}

export async function listResumableSessions(projectId: string): Promise<ResumableSession[]> {
  const r = await fetch(`/api/projects/${projectId}/sessions`);
  const j = await r.json();
  return j.sessions ?? [];
}

export async function listDevinSessions(projectId: string): Promise<ResumableDevinSession[]> {
  const r = await fetch(`/api/projects/${projectId}/devin-sessions`);
  const j = await r.json();
  return j.sessions ?? [];
}

export async function getSettings(): Promise<Settings> {
  const r = await fetch('/api/settings');
  return r.json();
}

export async function putSettings(s: Settings): Promise<Settings> {
  const r = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(s),
  });
  return r.json();
}
