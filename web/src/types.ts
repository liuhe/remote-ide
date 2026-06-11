export type Project = {
  id: string;
  name: string;
  path: string;
  createdAt: number;
};

export type FileTab = { id: string; type: 'file'; path: string };
export type SessionTab = { id: string; type: 'session'; resumeId?: string; title?: string };
export type DevinTab = { id: string; type: 'devin'; resumeId?: string; title?: string };
export type Tab = FileTab | SessionTab | DevinTab;

export type ProjectWorkspace = {
  tabs: Tab[];
};

export type Workspace = {
  projects: Record<string, ProjectWorkspace>;
};

export type ResumableSession = {
  uuid: string;
  mtime: number;
  size: number;
  preview: string;
};

export type ResumableDevinSession = {
  sessionId: string;
  cwd?: string;
  title?: string;
  updatedAt?: string;
};

export type SendKey = 'enter' | 'cmd-enter' | 'shift-enter';
export type Theme = 'dark' | 'light' | 'dim';
export type FontScale = 'small' | 'normal' | 'large' | 'xlarge' | 'huge' | 'xhuge';
export type Settings = {
  sendKey: SendKey;
  theme: Theme;
  fontScale: FontScale;
  // claude CLI --model arg for new sessions. '' = no override.
  // Accepts aliases ('opus' | 'sonnet' | 'haiku') or full model IDs.
  model: string;
  // Devin (ACP) model id for new sessions. '' = let Devin pick its default.
  // Applied via session/set_config_option after session/new.
  devinModel?: string;
};
