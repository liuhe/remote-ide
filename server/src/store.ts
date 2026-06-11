import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { ensureUser } from './users.js';

export type Project = {
  id: string;
  name: string;
  path: string;
  createdAt: number;
};

export type Tab =
  | { id: string; type: 'file'; path: string }
  | { id: string; type: 'session'; resumeId?: string; title?: string }
  | { id: string; type: 'devin'; resumeId?: string; title?: string };

export type ProjectWorkspace = {
  tabs: Tab[];
};

export type Workspace = {
  projects: Record<string, ProjectWorkspace>;
};

export type Settings = {
  sendKey: 'enter' | 'cmd-enter' | 'shift-enter';
  theme: 'dark' | 'light' | 'dim';
  fontScale: 'small' | 'normal' | 'large' | 'xlarge' | 'huge' | 'xhuge';
  // claude CLI --model arg. '' = no override (claude CLI default).
  // Aliases: 'opus' | 'sonnet' | 'haiku'. Also accepts full model IDs.
  model: string;
  // Devin ACP model id. '' = let Devin pick its default.
  devinModel?: string;
};

const DEFAULT_SETTINGS: Settings = {
  sendKey: 'cmd-enter',
  theme: 'dark',
  fontScale: 'normal',
  model: '',
  devinModel: '',
};

const CONFIG_DIR =
  process.env.REMOTE_IDE_CONFIG_DIR || path.join(os.homedir(), '.config', 'remote-ide');
const USERS_DIR = path.join(CONFIG_DIR, 'users');

function userDir(uid: string): string { return path.join(USERS_DIR, uid); }
function projectsFile(uid: string): string { return path.join(userDir(uid), 'projects.json'); }
function workspaceFile(uid: string): string { return path.join(userDir(uid), 'workspace.json'); }
function settingsFile(uid: string): string { return path.join(userDir(uid), 'settings.json'); }

// Legacy single-user file locations — used only for the one-shot migration
// into the per-user tree on first start after the multi-user upgrade.
const LEGACY_PROJECTS = path.join(CONFIG_DIR, 'projects.json');
const LEGACY_WORKSPACE = path.join(CONFIG_DIR, 'workspace.json');
const LEGACY_SETTINGS = path.join(CONFIG_DIR, 'settings.json');

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as T;
  } catch (e: any) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
}

async function writeJson(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
}

export async function listProjects(uid: string): Promise<Project[]> {
  return readJson<Project[]>(projectsFile(uid), []);
}

export async function addProject(uid: string, input: { path: string; name?: string }): Promise<Project> {
  const abs = path.resolve(input.path.replace(/^~/, os.homedir()));
  const stat = await fs.stat(abs);
  if (!stat.isDirectory()) throw new Error('path is not a directory');
  const projects = await listProjects(uid);
  const existing = projects.find((p) => p.path === abs);
  if (existing) return existing;
  const project: Project = {
    id: randomUUID(),
    name: input.name?.trim() || path.basename(abs),
    path: abs,
    createdAt: Date.now(),
  };
  projects.push(project);
  await writeJson(projectsFile(uid), projects);
  return project;
}

export async function deleteProject(uid: string, id: string): Promise<void> {
  const projects = await listProjects(uid);
  const next = projects.filter((p) => p.id !== id);
  await writeJson(projectsFile(uid), next);
  const ws = await getWorkspace(uid);
  if (ws.projects[id]) {
    delete ws.projects[id];
    await writeJson(workspaceFile(uid), ws);
  }
}

export async function getProject(uid: string, id: string): Promise<Project | null> {
  const projects = await listProjects(uid);
  return projects.find((p) => p.id === id) ?? null;
}

export async function getWorkspace(uid: string): Promise<Workspace> {
  // Strip any legacy active fields lurking in the file — schema dropped them
  // (they're now per-browser in localStorage).
  const raw = await readJson<any>(workspaceFile(uid), { projects: {} });
  const projects: Record<string, ProjectWorkspace> = {};
  for (const [id, pw] of Object.entries(raw?.projects ?? {})) {
    projects[id] = { tabs: Array.isArray((pw as any)?.tabs) ? (pw as any).tabs : [] };
  }
  return { projects };
}

export async function putWorkspace(uid: string, ws: Workspace): Promise<Workspace> {
  const clean: Workspace = {
    projects: Object.fromEntries(
      Object.entries(ws.projects ?? {}).map(([id, pw]) => [id, { tabs: pw.tabs ?? [] }]),
    ),
  };
  await writeJson(workspaceFile(uid), clean);
  return clean;
}

// Rewrite every existing workspace.json through putWorkspace so the on-disk
// shape matches the current schema. Lazy migration via getWorkspace strips
// legacy `activeProjectId` / `activeTabId` only when a write happens, so users
// who haven't touched the app since the schema change still have stale fields
// in their file. Called once at server startup.
export async function sanitizeAllWorkspaces(): Promise<{ rewritten: number }> {
  let rewritten = 0;
  let entries: { name: string; isDirectory: () => boolean }[];
  try {
    entries = await fs.readdir(USERS_DIR, { withFileTypes: true });
  } catch {
    return { rewritten };
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const file = workspaceFile(e.name);
    let raw: string;
    try { raw = await fs.readFile(file, 'utf8'); }
    catch { continue; }
    let parsed: any;
    try { parsed = JSON.parse(raw); }
    catch { continue; }
    const hasLegacyTop = 'activeProjectId' in (parsed ?? {});
    const hasLegacyNested = Object.values(parsed?.projects ?? {})
      .some((p) => p && typeof p === 'object' && 'activeTabId' in (p as any));
    if (!hasLegacyTop && !hasLegacyNested) continue;
    await putWorkspace(e.name, parsed);
    rewritten++;
  }
  return { rewritten };
}

export async function getSettings(uid: string): Promise<Settings> {
  const stored = await readJson<Partial<Settings>>(settingsFile(uid), {});
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function putSettings(uid: string, s: Settings): Promise<Settings> {
  const merged = { ...DEFAULT_SETTINGS, ...s };
  await writeJson(settingsFile(uid), merged);
  return merged;
}

// One-shot migration: if pre-multi-user files exist at the legacy paths and
// no users have been provisioned yet, create a default user named "eric"
// (password from REMOTE_IDE_PASSWORD env, falling back to a placeholder that
// forces a manual passwd reset) and move the existing state under that user.
// Idempotent — safe to call on every startup.
export async function migrateLegacyIfNeeded(): Promise<void> {
  const usersJson = path.join(CONFIG_DIR, 'users.json');
  const hasUsers = await fs.access(usersJson).then(() => true, () => false);
  const hasLegacy = await fs.access(LEGACY_PROJECTS).then(() => true, () => false);
  if (hasUsers || !hasLegacy) return;

  const password = process.env.REMOTE_IDE_PASSWORD;
  if (!password || password.length < 6) {
    // Refuse to migrate with a weak / missing password — the user would be
    // locked out of the migrated data. Surface the problem instead.
    throw new Error(
      'Legacy single-user state exists but REMOTE_IDE_PASSWORD is missing or <6 chars. ' +
      'Set it in .env then restart, or remove the legacy files manually.',
    );
  }

  const user = await ensureUser('eric', password);
  await fs.mkdir(userDir(user.id), { recursive: true });

  for (const [src, dst] of [
    [LEGACY_PROJECTS, projectsFile(user.id)],
    [LEGACY_WORKSPACE, workspaceFile(user.id)],
    [LEGACY_SETTINGS, settingsFile(user.id)],
  ] as const) {
    const exists = await fs.access(src).then(() => true, () => false);
    if (!exists) continue;
    const dstExists = await fs.access(dst).then(() => true, () => false);
    if (dstExists) continue; // user already populated, don't overwrite
    await fs.rename(src, dst);
  }
  // eslint-disable-next-line no-console
  console.log(`[remote-ide] migrated legacy single-user state → users/${user.id} (name=eric)`);
}
