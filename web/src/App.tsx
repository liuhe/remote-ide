import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileTree } from './components/FileTree';
import { Viewer } from './components/Viewer';
import { ChatPanel } from './components/ChatPanel';
import { DevinPanel } from './components/DevinPanel';
import { ProjectPicker } from './components/ProjectPicker';
import { TabBar } from './components/TabBar';
import { Settings as SettingsModal } from './components/Settings';
import { SessionPicker, type PickerItem } from './components/SessionPicker';
import { Login } from './components/Login';
import {
  listProjects,
  addProject,
  deleteProject,
  getWorkspace,
  putWorkspace,
  listResumableSessions,
  listDevinSessions,
  getSettings,
  putSettings,
  getAuthStatus,
  logout,
} from './api';
import type { Project, Tab, Workspace, Settings } from './types';

const DEFAULT_SETTINGS: Settings = { sendKey: 'cmd-enter', theme: 'dark', fontScale: 'normal', model: '', devinModel: '' };

function randomId() { return Math.random().toString(36).slice(2, 10); }

// Active project lives in the URL hash so it's shareable and survives across
// browser windows opening the same URL; the per-project active-tab pointer
// stays in localStorage so different windows can have different tabs focused
// within the same project. The tabs list itself stays on the server (shared).
const ACTIVE_LS_KEY = 'remote-ide:active';
type ActiveState = { projectId: string | null; tabs: Record<string, string | null> };

function projectIdFromHash(): string | null {
  try {
    const h = decodeURIComponent(window.location.hash.slice(1));
    return h || null;
  } catch {
    return null;
  }
}

function loadActive(): ActiveState {
  let tabs: Record<string, string | null> = {};
  try {
    const raw = localStorage.getItem(ACTIVE_LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.tabs && typeof parsed.tabs === 'object' && !Array.isArray(parsed.tabs)) {
        tabs = parsed.tabs;
      }
    }
  } catch {}
  return { projectId: projectIdFromHash(), tabs };
}

function saveActive(s: ActiveState) {
  // Persist only the per-browser bit. projectId is reflected to the hash by a
  // separate effect so we don't fight ourselves on hashchange.
  try { localStorage.setItem(ACTIVE_LS_KEY, JSON.stringify({ tabs: s.tabs })); } catch {}
}

function setProjectHash(id: string | null) {
  const target = id ? `#${encodeURIComponent(id)}` : '';
  if (window.location.hash === target) return;
  if (!target && !window.location.hash) return;
  const url = window.location.pathname + window.location.search + target;
  history.replaceState(null, '', url);
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [workspace, setWorkspace] = useState<Workspace>({ projects: {} });
  const [active, setActive] = useState<ActiveState>(() => loadActive());
  const [loaded, setLoaded] = useState(false);
  const [authState, setAuthState] = useState<{ required: boolean; authenticated: boolean; username?: string } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState<Record<string, number>>({});
  const exportApiRef = useRef<Map<string, { open: () => void; canExport: boolean }>>(new Map());
  const [exportApiVersion, setExportApiVersion] = useState(0);
  const registerExportApi = useCallback(
    (tabId: string, api: { open: () => void; canExport: boolean } | null) => {
      if (api) exportApiRef.current.set(tabId, api);
      else exportApiRef.current.delete(tabId);
      setExportApiVersion((n) => n + 1);
    },
    [],
  );
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [picker, setPicker] = useState<{
    title: string;
    items: PickerItem[];
    onPick: (id: string) => void;
  } | null>(null);

  // Initial load
  useEffect(() => {
    (async () => {
      const auth = await getAuthStatus();
      setAuthState(auth);
      if (auth.required && !auth.authenticated) return;
      const [ps, ws, st] = await Promise.all([listProjects(), getWorkspace(), getSettings()]);
      setProjects(ps);
      setWorkspace(ws);
      setSettings(st);
      setLoaded(true);
    })();
  }, []);

  function updateSettings(next: Settings) {
    setSettings(next);
    putSettings(next);
  }

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  useEffect(() => {
    document.documentElement.dataset.fontScale = settings.fontScale;
  }, [settings.fontScale]);

  // Debounced persist (tabs list only; active fields are local).
  const saveTimer = useRef<number | null>(null);
  const saveWorkspace = useCallback((ws: Workspace) => {
    setWorkspace(ws);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { putWorkspace(ws); }, 250);
  }, []);

  // Persist active state synchronously so a quick refresh doesn't lose it.
  useEffect(() => { saveActive(active); }, [active]);

  // Reflect active project to the URL hash so it's shareable / survives copy.
  useEffect(() => { setProjectHash(active.projectId); }, [active.projectId]);

  // Track external hash edits (back/forward, manual edit, paste of a deep link).
  useEffect(() => {
    function onHash() {
      const next = projectIdFromHash();
      setActive((a) => (a.projectId === next ? a : { ...a, projectId: next }));
    }
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Reconcile stored active state against actual data once both projects and
  // workspace have loaded — clears stale ids pointing at deleted projects /
  // closed tabs, falling back to the first available.
  useEffect(() => {
    if (!loaded) return;
    setActive((prev) => {
      let projectId = prev.projectId;
      const projectExists = projectId && projects.some((p) => p.id === projectId);
      if (!projectExists) projectId = projects[0]?.id ?? null;
      const tabs: Record<string, string | null> = {};
      for (const pid of Object.keys(prev.tabs)) {
        // Drop entries for projects that no longer exist.
        if (projects.some((p) => p.id === pid)) tabs[pid] = prev.tabs[pid];
      }
      // Validate / fallback the current project's active tab.
      if (projectId) {
        const list = workspace.projects[projectId]?.tabs ?? [];
        const stored = tabs[projectId] ?? null;
        const valid = stored && list.some((t) => t.id === stored);
        tabs[projectId] = valid ? stored : (list[0]?.id ?? null);
      }
      if (projectId === prev.projectId && JSON.stringify(tabs) === JSON.stringify(prev.tabs)) {
        return prev;
      }
      return { projectId, tabs };
    });
  }, [loaded, projects, workspace]);

  const activeProjectId = active.projectId;
  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );
  const projectWs = activeProjectId ? workspace.projects[activeProjectId] : undefined;
  const tabs: Tab[] = projectWs?.tabs ?? [];
  const activeTabId = activeProjectId ? (active.tabs[activeProjectId] ?? null) : null;
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const activeExport = useMemo(
    () => (activeTabId ? exportApiRef.current.get(activeTabId) ?? null : null),
    [activeTabId, exportApiVersion],
  );

  // Reflect the active project name into the browser tab title so users with
  // multiple windows open can tell them apart from the OS tab strip.
  useEffect(() => {
    document.title = activeProject ? `${activeProject.name} — Remote IDE` : 'Remote IDE';
  }, [activeProject]);

  function setActiveProject(id: string) {
    setActive((a) => ({ ...a, projectId: id }));
  }

  function setActiveTab(projectId: string, tabId: string | null) {
    setActive((a) => ({ ...a, tabs: { ...a.tabs, [projectId]: tabId } }));
  }

  function updateProjectTabs(projectId: string, nextTabs: Tab[]) {
    const current = workspace.projects[projectId] ?? { tabs: [] };
    saveWorkspace({
      ...workspace,
      projects: { ...workspace.projects, [projectId]: { ...current, tabs: nextTabs } },
    });
  }

  function openFileTab(filePath: string) {
    if (!activeProjectId) return;
    const existing = tabs.find((t) => t.type === 'file' && t.path === filePath);
    if (existing) {
      setActiveTab(activeProjectId, existing.id);
      return;
    }
    const tab: Tab = { id: randomId(), type: 'file', path: filePath };
    updateProjectTabs(activeProjectId, [...tabs, tab]);
    setActiveTab(activeProjectId, tab.id);
  }

  function openSessionTab(resumeId?: string, title?: string) {
    if (!activeProjectId) return;
    // Resume of an already-open session: activate the existing tab instead of
    // duplicating. Two tabs on the same sessionId share one server-side entry
    // and just confuse the user (typing in one updates state in the other).
    if (resumeId) {
      const existing = tabs.find((t) => t.type === 'session' && t.resumeId === resumeId);
      if (existing) {
        setActiveTab(activeProjectId, existing.id);
        return;
      }
    }
    const d = new Date();
    const defaultTitle = `Chat ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const tab: Tab = { id: randomId(), type: 'session', resumeId, title: title || defaultTitle };
    updateProjectTabs(activeProjectId, [...tabs, tab]);
    setActiveTab(activeProjectId, tab.id);
  }

  function openDevinTab(resumeId?: string, title?: string) {
    if (!activeProjectId) return;
    if (resumeId) {
      const existing = tabs.find((t) => t.type === 'devin' && t.resumeId === resumeId);
      if (existing) {
        setActiveTab(activeProjectId, existing.id);
        return;
      }
    }
    const d = new Date();
    const defaultTitle = `Devin ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const tab: Tab = { id: randomId(), type: 'devin', resumeId, title: title || defaultTitle };
    updateProjectTabs(activeProjectId, [...tabs, tab]);
    setActiveTab(activeProjectId, tab.id);
  }

  function activateTab(id: string) {
    if (!activeProjectId) return;
    setActiveTab(activeProjectId, id);
  }

  function closeTab(id: string) {
    if (!activeProjectId) return;
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const nextTabs = tabs.filter((t) => t.id !== id);
    updateProjectTabs(activeProjectId, nextTabs);
    if (activeTabId === id) {
      setActiveTab(activeProjectId, nextTabs[Math.min(idx, nextTabs.length - 1)]?.id ?? null);
    }
  }

  async function handleAddProject(path: string, name?: string) {
    try {
      const p = await addProject({ path, name });
      const ps = await listProjects();
      setProjects(ps);
      if (!workspace.projects[p.id]) {
        saveWorkspace({
          ...workspace,
          projects: { ...workspace.projects, [p.id]: { tabs: [] } },
        });
      }
      setActive((a) => ({ ...a, projectId: p.id }));
    } catch (e: any) {
      alert(`Failed: ${e.message}`);
    }
  }

  async function handleDeleteProject(id: string) {
    if (!confirm('Remove this project from the list? (files are not touched)')) return;
    await deleteProject(id);
    const ps = await listProjects();
    setProjects(ps);
    const newWs = { ...workspace };
    delete newWs.projects[id];
    saveWorkspace(newWs);
    setActive((a) => {
      const nextTabs = { ...a.tabs };
      delete nextTabs[id];
      const nextProject = a.projectId === id ? (ps[0]?.id ?? null) : a.projectId;
      return { projectId: nextProject, tabs: nextTabs };
    });
  }

  if (!authState) return <div className="loading">Loading…</div>;
  if (authState.required && !authState.authenticated) {
    return <Login onSuccess={() => window.location.reload()} />;
  }
  if (!loaded) return <div className="loading">Loading…</div>;

  return (
    <div className="app">
      {drawerOpen && <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />}

      <div className={`drawer ${drawerOpen ? 'open' : ''}`}>
        <div className="panel files-panel">
          <div className="panel-header">
            <ProjectPicker
              projects={projects}
              activeId={activeProjectId}
              onSelect={setActiveProject}
              onAdd={handleAddProject}
              onDelete={handleDeleteProject}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          </div>
          <div className="panel-body">
            {activeProject ? (
              <FileTree
                projectId={activeProject.id}
                onSelect={(p) => { openFileTab(p); setDrawerOpen(false); }}
                selectedPath={activeTab?.type === 'file' ? activeTab.path : null}
              />
            ) : (
              <div className="empty">Select or add a project</div>
            )}
          </div>
        </div>
      </div>

      <div className="panel main-panel">
        <TabBar
          onMenuClick={() => setDrawerOpen((v) => !v)}
          activeProjectName={activeProject?.name ?? null}
          onRefresh={
            activeTab
              ? () => setRefreshKey((r) => ({ ...r, [activeTab.id]: (r[activeTab.id] ?? 0) + 1 }))
              : undefined
          }
          onExport={activeExport?.open}
          canExport={activeExport?.canExport ?? false}
          tabs={tabs}
          activeTabId={activeTabId}
          onActivate={activateTab}
          onClose={closeTab}
          onNewSession={() => openSessionTab()}
          onResumeSession={
            activeProject
              ? async () => {
                  const list = await listResumableSessions(activeProject.id);
                  if (list.length === 0) {
                    alert('No resumable Claude sessions for this project');
                    return;
                  }
                  const items: PickerItem[] = list.map((s) => ({
                    id: s.uuid,
                    primary: s.preview || s.uuid.slice(0, 8),
                    secondary: s.uuid.slice(0, 8),
                    timestamp: s.mtime,
                  }));
                  setPicker({
                    title: 'Resume Claude session',
                    items,
                    onPick: (uuid) => {
                      const s = list.find((x) => x.uuid === uuid);
                      if (s) openSessionTab(s.uuid, s.preview.slice(0, 30) || s.uuid.slice(0, 8));
                      setPicker(null);
                    },
                  });
                }
              : undefined
          }
          onNewDevinSession={activeProject ? () => openDevinTab() : undefined}
          onResumeDevinSession={
            activeProject
              ? async () => {
                  const list = await listDevinSessions(activeProject.id);
                  if (list.length === 0) {
                    alert('No resumable Devin sessions for this project');
                    return;
                  }
                  const items: PickerItem[] = list.map((s) => ({
                    id: s.sessionId,
                    primary: s.title || s.sessionId,
                    secondary: s.sessionId,
                    timestamp: s.updatedAt ? new Date(s.updatedAt).getTime() : undefined,
                  }));
                  setPicker({
                    title: 'Resume Devin session',
                    items,
                    onPick: (sid) => {
                      const s = list.find((x) => x.sessionId === sid);
                      if (s) openDevinTab(s.sessionId, s.title || s.sessionId);
                      setPicker(null);
                    },
                  });
                }
              : undefined
          }
        />
        <div className="panel-body main-body">
          {activeProject ? (
            <>
              {tabs.map((tab) => {
                const isActive = tab.id === activeTabId;
                const rk = refreshKey[tab.id] ?? 0;
                const tabKey = `${tab.id}-${rk}`;
                const style: React.CSSProperties = isActive
                  ? { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }
                  : { display: 'none' };
                if (tab.type === 'file') {
                  return (
                    <div key={tabKey} style={style}>
                      <Viewer
                        projectId={activeProject.id}
                        file={{ path: tab.path }}
                        theme={settings.theme}
                      />
                    </div>
                  );
                }
                if (tab.type === 'devin') {
                  return (
                    <div key={tabKey} style={style}>
                      <DevinPanel
                        projectId={activeProject.id}
                        projectPath={activeProject.path}
                        resumeId={tab.resumeId}
                        sendKey={settings.sendKey}
                        theme={settings.theme}
                        defaultModel={settings.devinModel ?? ''}
                        onSetDefaultModel={(modelId) => updateSettings({ ...settings, devinModel: modelId })}
                        onTitle={(title) => {
                          if (!activeProjectId) return;
                          const updated = tabs.map((t) => (t.id === tab.id ? { ...t, title } : t));
                          updateProjectTabs(activeProjectId, updated);
                        }}
                        onSessionId={(sid) => {
                          if (!activeProjectId) return;
                          const next = sid || undefined;
                          if (tab.type === 'devin' && tab.resumeId === next) return;
                          const updated = tabs.map((t) =>
                            t.id === tab.id && t.type === 'devin' ? { ...t, resumeId: next } : t,
                          );
                          updateProjectTabs(activeProjectId, updated);
                        }}
                        onExportApi={(api) => registerExportApi(tab.id, api)}
                      />
                    </div>
                  );
                }
                // session (Claude)
                return (
                  <div key={tabKey} style={style}>
                    <ChatPanel
                      projectId={activeProject.id}
                      projectPath={activeProject.path}
                      resumeId={tab.resumeId}
                      sendKey={settings.sendKey}
                      theme={settings.theme}
                      onTitle={(title) => {
                        if (!activeProjectId) return;
                        const updated = tabs.map((t) => (t.id === tab.id ? { ...t, title } : t));
                        updateProjectTabs(activeProjectId, updated);
                      }}
                      onSessionId={(uuid) => {
                        if (!activeProjectId) return;
                        if (tab.type === 'session' && tab.resumeId === uuid) return;
                        const updated = tabs.map((t) =>
                          t.id === tab.id && t.type === 'session' ? { ...t, resumeId: uuid } : t,
                        );
                        updateProjectTabs(activeProjectId, updated);
                      }}
                      onExportApi={(api) => registerExportApi(tab.id, api)}
                    />
                  </div>
                );
              })}
              {!activeTab && (
                <div className="empty">Open a file or start an AI session</div>
              )}
            </>
          ) : (
            <div className="empty">No project selected</div>
          )}
        </div>
      </div>

      {settingsOpen && (
        <SettingsModal
          settings={settings}
          username={authState?.username}
          onChange={updateSettings}
          onClose={() => setSettingsOpen(false)}
          onSignOut={async () => {
            await logout();
            window.location.reload();
          }}
        />
      )}
      {picker && (
        <SessionPicker
          title={picker.title}
          items={picker.items}
          onPick={picker.onPick}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

