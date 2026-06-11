import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SendKey, Theme } from '../types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { ExportMessage } from '../lib/export/types';

// See ChatPanel: the export pipeline only ships when the user opens ⤓.
const ExportDialog = lazy(() =>
  import('./ExportDialog').then((m) => ({ default: m.ExportDialog })),
);

// Devin-side chat panel. Mirrors ChatPanel in look but is intentionally
// separate: ACP semantics and Anthropic stream-json semantics don't overlap
// cleanly, and isolation lets either side break without taking the other down.

function MarkdownText({ text, theme }: { text: string; theme: Theme }) {
  const style = theme === 'light' ? oneLight : vscDarkPlus;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '');
          if (!match) return <code className={className} {...props}>{children}</code>;
          return (
            <SyntaxHighlighter
              PreTag="div"
              language={match[1]}
              style={style as any}
              customStyle={{ margin: '4px 0', borderRadius: 4, fontSize: 11, padding: '6px 8px' }}
            >
              {String(children).replace(/\n$/, '')}
            </SyntaxHighlighter>
          );
        },
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

function shortId() { return Math.random().toString(36).slice(2, 9); }

// Compress a tool call into one scannable line. ACP's `title` is usually
// already a human label ("Reading file src/x.ts"), so prefer that and fall
// back to digging into rawInput for the most-likely-useful field per kind.
// Devin's modes (accept-edits / ask / plan / bypass) ship a lucide icon name
// in ACP _meta. We don't pull in lucide-react; emoji are close enough and
// match the rest of the UI's style. Keyed by mode id for safety since names
// can be localised by the agent.
const MODE_ICON: Record<string, string> = {
  'accept-edits': '💻',
  'ask': '💬',
  'plan': '📋',
  'bypass': '🛡️',
};

// Bucket Devin model IDs into a small set of human-readable family labels.
// The native list ships ~75 items in implementation order; grouping makes
// scanning the picker tractable.
function devinModelFamily(v: string): string {
  if (v.startsWith('claude-opus-4-7')) return 'Claude Opus 4.7';
  if (v.startsWith('claude-opus-4-6')) return 'Claude Opus 4.6';
  if (v.startsWith('MODEL_CLAUDE_4_5_OPUS')) return 'Claude Opus 4.5';
  if (v.startsWith('claude-sonnet-4-6')) return 'Claude Sonnet 4.6';
  if (v === 'MODEL_PRIVATE_2' || v === 'MODEL_PRIVATE_3') return 'Claude Sonnet 4.5';
  if (v === 'MODEL_PRIVATE_11') return 'Claude Haiku 4.5';
  if (v.startsWith('gpt-5-5')) return 'GPT-5.5';
  if (v.startsWith('gpt-5-4-mini')) return 'GPT-5.4 Mini';
  if (v.startsWith('gpt-5-4')) return 'GPT-5.4';
  if (v.startsWith('gpt-5-3-codex')) return 'GPT-5.3 Codex';
  if (v.startsWith('MODEL_GPT_5_2')) return 'GPT-5.2';
  if (v.startsWith('gemini-3-1')) return 'Gemini 3.1';
  if (v.startsWith('MODEL_GOOGLE_GEMINI_3_0')) return 'Gemini 3.0';
  if (v.startsWith('swe-1-6') || v.startsWith('MODEL_SWE_1_5')) return 'SWE';
  if (v === 'kimi-k2-6') return 'Kimi';
  if (v === 'deepseek-v4') return 'DeepSeek';
  if (v === 'glm-5-1') return 'GLM';
  if (v === 'adaptive') return 'Adaptive';
  return 'Other';
}

// Stable display order for the family groups above. Anything not listed sinks
// to the bottom (alphabetical within "Other").
const FAMILY_ORDER = [
  'Claude Opus 4.7', 'Claude Opus 4.6', 'Claude Opus 4.5',
  'Claude Sonnet 4.6', 'Claude Sonnet 4.5', 'Claude Haiku 4.5',
  'GPT-5.5', 'GPT-5.4', 'GPT-5.4 Mini', 'GPT-5.3 Codex', 'GPT-5.2',
  'Gemini 3.1', 'Gemini 3.0',
  'SWE', 'Kimi', 'DeepSeek', 'GLM', 'Adaptive',
  'Other',
];

function summarizeDevinTool(kind: string, rawInput: any, title?: string): string {
  if (title && title.trim()) return title;
  if (!rawInput || typeof rawInput !== 'object') return '';
  const r = rawInput as Record<string, any>;
  switch (kind) {
    case 'read':
    case 'edit':
    case 'delete':
    case 'move':
      return r.file_path ?? r.path ?? r.target_file ?? r.source_path ?? '';
    case 'execute': {
      const cmd: string = r.command ?? r.cmd ?? '';
      const first = cmd.split('\n')[0] ?? '';
      return first.length > 80 ? first.slice(0, 80) + '…' : first;
    }
    case 'search':
      return r.query ?? r.pattern ?? r.search_term ?? '';
    case 'fetch':
      return r.url ?? '';
    case 'think':
      return r.thought ? String(r.thought).slice(0, 80) : '';
    default: {
      // Pick the first stringy field as a best-effort hint.
      for (const [k, v] of Object.entries(r)) {
        if (typeof v === 'string' && v.length > 0) {
          const s = v.length > 80 ? v.slice(0, 80) + '…' : v;
          return `${k}: ${s}`;
        }
      }
      return '';
    }
  }
}

function ToolFields({ input }: { input: any }) {
  if (!input || typeof input !== 'object') {
    return <pre className="tool-field-value">{String(input)}</pre>;
  }
  return (
    <>
      {Object.entries(input).map(([k, v]) => (
        <div key={k} className="tool-field">
          <div className="tool-field-key">{k}</div>
          <pre className="tool-field-value">
            {typeof v === 'string' ? v : JSON.stringify(v, null, 2)}
          </pre>
        </div>
      ))}
    </>
  );
}

// One row in the visible chat. ACP doesn't draw a hard line between "assistant
// message" and "thought"; we keep them as separate Msg flavors so the user can
// fold the thinking train if it gets noisy.
type Msg =
  | { id: string; role: 'user'; text: string; images?: string[] }
  | { id: string; role: 'assistant'; text: string }
  | { id: string; role: 'thought'; text: string }
  | { id: string; role: 'system'; text: string }
  | {
      id: string;
      role: 'tool';
      toolCallId: string;
      title: string;
      kind: string;
      status: 'pending' | 'in_progress' | 'completed' | 'failed';
      rawInput?: any;
      output?: string;
    };

type Mode = { id: string; name?: string };
type ConfigOption = {
  id: string;
  name?: string;
  description?: string;
  category?: string;
  type?: string;
  currentValue?: string;
  options?: Array<{ value: string; name?: string }>;
};

type Status = 'connecting' | 'replaying' | 'ready' | 'thinking' | 'reconnecting' | 'closed';

function sendKeyHint(k: SendKey): string {
  switch (k) {
    case 'cmd-enter': return 'Ask Devin… (⌘/Ctrl+Enter to send)';
    case 'shift-enter': return 'Ask Devin… (Shift+Enter to send)';
    case 'enter': return 'Ask Devin… (Enter to send)';
  }
}

// Pick a printable label for a single ACP content block in a streaming chunk.
function chunkText(content: any): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (content.type === 'text') return content.text ?? '';
  if (content.type === 'resource_link' && content.uri) return `🔗 ${content.uri}`;
  if (content.type === 'resource' && content.resource?.uri) return `📎 ${content.resource.uri}`;
  return '';
}

// Flatten ACP tool-call content array into a single printable string.
function toolOutputText(content: any[]): string {
  if (!Array.isArray(content)) return '';
  const pieces: string[] = [];
  for (const c of content) {
    if (c?.type === 'content') pieces.push(chunkText(c.content));
    else if (c?.type === 'diff') {
      const old = typeof c.oldText === 'string' ? c.oldText : '';
      const neu = typeof c.newText === 'string' ? c.newText : '';
      pieces.push(`--- ${c.path}\n+++ ${c.path}\n${old}\n→\n${neu}`);
    } else if (c?.type === 'terminal') {
      pieces.push(`[terminal ${c.terminalId}]`);
    }
  }
  return pieces.join('\n');
}

// Build Msg[] from the HTTP transcript API (sessions.db). Mirrors ChatPanel's
// buildFromEvents() — lets us render history before the WS is even open.
function buildFromDevinTranscript(events: any[]): { msgs: Msg[]; model?: string } {
  const msgs: Msg[] = [];
  const toolMsgByCallId = new Map<string, Msg & { role: 'tool' }>();
  let model: string | undefined;
  for (const ev of events) {
    if (ev.role === 'user') {
      msgs.push({ id: shortId(), role: 'user', text: ev.content ?? '', images: ev.images });
    } else if (ev.role === 'assistant') {
      if (ev.content) msgs.push({ id: shortId(), role: 'assistant', text: ev.content });
      if (ev.model) model = ev.model;
    } else if (ev.role === 'tool_call') {
      const toolMsg: Msg & { role: 'tool' } = {
        id: shortId(),
        role: 'tool',
        toolCallId: ev.toolCallId,
        title: ev.title ?? '',
        kind: ev.kind ?? 'other',
        status: 'completed',
        rawInput: ev.rawInput,
      };
      msgs.push(toolMsg);
      toolMsgByCallId.set(ev.toolCallId, toolMsg);
    } else if (ev.role === 'tool_result') {
      const target = toolMsgByCallId.get(ev.toolCallId);
      if (target) {
        target.output = ev.content;
        if (ev.toolKind) target.kind = ev.toolKind;
      }
    }
  }
  return { msgs, model };
}

function modelLabel(opt: ConfigOption | null | undefined): string {
  if (!opt) return '';
  const cur = opt.currentValue;
  if (!cur) return '';
  const match = opt.options?.find((o) => o.value === cur);
  return match?.name ?? cur;
}

export function DevinPanel({
  projectId,
  resumeId,
  sendKey,
  theme,
  defaultModel,
  onTitle,
  onSessionId,
  onSetDefaultModel,
  onExportApi,
}: {
  projectId: string;
  resumeId?: string;
  sendKey: SendKey;
  theme: Theme;
  defaultModel?: string;
  onTitle?: (title: string) => void;
  onSessionId?: (sessionId: string) => void;
  onSetDefaultModel?: (modelId: string) => void;
  onExportApi?: (api: { open: () => void; canExport: boolean } | null) => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<Status>('connecting');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [modes, setModes] = useState<Mode[]>([]);
  const [currentModeId, setCurrentModeId] = useState<string | null>(null);
  const [configOptions, setConfigOptions] = useState<ConfigOption[]>([]);
  const [permissionPrompt, setPermissionPrompt] = useState<{
    id: number | string;
    toolCall: { title?: string; kind?: string; rawInput?: any };
    options: Array<{ optionId: string; name?: string; kind?: string }>;
  } | null>(null);
  const [pendingImages, setPendingImages] = useState<Array<{
    id: string; dataUrl: string; mediaType: string; base64: string;
  }>>([]);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [toolPopout, setToolPopout] = useState<Msg | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [oldestIdx, setOldestIdx] = useState<number>(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  useEffect(() => {
    if (!onExportApi) return;
    onExportApi({ open: () => setExportOpen(true), canExport: msgs.length > 0 });
    return () => onExportApi(null);
  }, [onExportApi, msgs.length]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadOlderRef = useRef<HTMLButtonElement>(null);
  const beforePrependRef = useRef<{ height: number; top: number } | null>(null);

  const toastTimer = useRef<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const titleSetFromMsg = useRef(false);
  const initialResumeIdRef = useRef(resumeId);
  const activeSessionIdRef = useRef<string | undefined>(resumeId);
  const closedByUsRef = useRef(false);
  const sessionExitedRef = useRef(false);
  // Set by load_failed to tell the subsequent exit handler "don't block
  // reconnection — we want to spawn a fresh session".
  const wantFreshSpawnRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const isReconnectingRef = useRef(false);
  // Count consecutive WS connect attempts that never got onopen (401 / network
  // failures). After a threshold we stop reconnecting — most likely the auth
  // session expired.
  const failedConnectsRef = useRef(0);
  const MAX_FAILED_CONNECTS = 3;
  // Heartbeat liveness. Updated on every inbound WS message (including
  // server-sent {type:'pong'}). If no message arrives within HEARTBEAT_DEAD_MS
  // we treat the socket as zombie and force a reconnect — see openWs().
  const lastMessageAtRef = useRef(Date.now());
  const heartbeatTimerRef = useRef<number | null>(null);
  const PING_INTERVAL_MS = 25_000;
  const HEARTBEAT_DEAD_MS = 60_000;
  // On visibilitychange→visible we proactively recycle the WS if it's been
  // quiet — handles laptop-sleep / backgrounded-tab cases where the TCP died
  // silently long before any send would have surfaced the failure.
  const VISIBILITY_STALE_MS = 30_000;
  const stickyBottomRef = useRef(true);
  // Current streaming message id by sessionUpdate kind, so successive
  // *_message_chunk notifications append to the same bubble until a different
  // kind interrupts. 'user' is included so multi-block prompts (text + image)
  // coalesce instead of spawning a bubble per chunk.
  const streamingMsgIdRef = useRef<{ kind: 'assistant' | 'thought' | 'user'; id: string } | null>(null);
  // Has this tab's resumeId been persisted to workspace? Resume tabs start
  // true (the id was already saved). Fresh-spawn tabs start false: Devin
  // doesn't write a session row to its sqlite store until the first user
  // prompt arrives, so persisting the id before that creates phantom slugs
  // that fail "session not found" on subsequent refresh.
  const sessionIdPersistedRef = useRef<boolean>(!!resumeId);
  // True while the WS is replaying history (session/load or ring-buffer
  // attach). Content notifications are skipped — the DB pre-fetch already
  // has them. Metadata (config/mode) is still processed. Cleared when the
  // session transitions to ready.
  const replayingRef = useRef(!!resumeId);

  function showToast(text: string, durationMs = 2500) {
    setToast(text);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), durationMs);
  }

  function send(obj: unknown) {
    try { wsRef.current?.send(JSON.stringify(obj)); } catch {}
  }

  async function refetchTranscript(slug: string) {
    try {
      const r = await fetch(`/api/projects/${projectId}/devin-sessions/${slug}/transcript?limit=60`);
      if (!r.ok) return;
      const { events, startIndex } = await r.json();
      const { msgs: built, model: m } = buildFromDevinTranscript(events);
      setMsgs(built);
      setOldestIdx(startIndex ?? 0);
      if (m) {
        // Surface the model from the DB so the status bar isn't blank before
        // the WS configOptions arrive.
        setConfigOptions((prev) => prev.map((c) =>
          c.id === 'model' ? { ...c, currentValue: m } : c,
        ));
      }
      const firstUser = built.find((msg) => msg.role === 'user');
      if (firstUser && !titleSetFromMsg.current && onTitle) {
        onTitle(firstUser.text.slice(0, 40));
        titleSetFromMsg.current = true;
      }
    } catch {}
  }

  async function loadOlder() {
    const slug = activeSessionIdRef.current ?? initialResumeIdRef.current;
    if (!slug || loadingMore || oldestIdx <= 0) return;
    setLoadingMore(true);
    try {
      const r = await fetch(
        `/api/projects/${projectId}/devin-sessions/${slug}/transcript?before=${oldestIdx}&limit=60`,
      );
      if (!r.ok) return;
      const { events, startIndex } = await r.json();
      const el = scrollRef.current;
      if (el) beforePrependRef.current = { height: el.scrollHeight, top: el.scrollTop };
      const { msgs: older } = buildFromDevinTranscript(events);
      setMsgs((prev) => [...older, ...prev]);
      setOldestIdx(startIndex ?? 0);
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    let aborted = false;
    closedByUsRef.current = false;
    sessionExitedRef.current = false;
    reconnectAttemptRef.current = 0;

    function openWs() {
      const resume = activeSessionIdRef.current ?? initialResumeIdRef.current;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const params = new URLSearchParams({ project: projectId });
      if (resume) params.set('resume', resume);
      const ws = new WebSocket(`${proto}://${location.host}/ws/devin?${params}`);
      wsRef.current = ws;
      let opened = false;
      ws.onopen = () => {
        opened = true;
        failedConnectsRef.current = 0;
        reconnectAttemptRef.current = 0;
        lastMessageAtRef.current = Date.now();
        // Heartbeat: send an app-level ping every PING_INTERVAL_MS. Browsers
        // don't expose WS ping frames to JS, so we use a JSON message and the
        // server replies with {type:'pong'}. If no message arrives in
        // HEARTBEAT_DEAD_MS, the underlying TCP is presumed dead — close the
        // socket so onclose → scheduleReconnect fires.
        if (heartbeatTimerRef.current) window.clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = window.setInterval(() => {
          if (Date.now() - lastMessageAtRef.current > HEARTBEAT_DEAD_MS) {
            try { ws.close(); } catch {}
            return;
          }
          try { ws.send(JSON.stringify({ type: 'ping' })); } catch {}
        }, PING_INTERVAL_MS);
        if (isReconnectingRef.current) {
          isReconnectingRef.current = false;
          showToast('Reconnected');
        }
      };
      ws.onmessage = (ev) => {
        lastMessageAtRef.current = Date.now();
        const data = JSON.parse(ev.data);
        // Swallow server pongs — they exist only to keep lastMessageAtRef fresh.
        if (data?.type === 'pong') return;
        handleWsMsg(data);
      };
      ws.onerror = () => {};
      ws.onclose = () => {
        if (heartbeatTimerRef.current) {
          window.clearInterval(heartbeatTimerRef.current);
          heartbeatTimerRef.current = null;
        }
        if (closedByUsRef.current || sessionExitedRef.current) {
          setStatus('closed');
          return;
        }
        if (!opened) {
          failedConnectsRef.current++;
          if (failedConnectsRef.current >= MAX_FAILED_CONNECTS) {
            setStatus('closed');
            setMsgs((prev) => [...prev, {
              id: shortId(),
              role: 'system',
              text: 'Connection failed — session may have expired. Please refresh the page.',
            }]);
            return;
          }
        }
        scheduleReconnect();
      };
    }

    function scheduleReconnect() {
      const attempt = reconnectAttemptRef.current++;
      const delay = Math.min(500 * 2 ** attempt, 10_000);
      setStatus('reconnecting');
      isReconnectingRef.current = true;
      reconnectTimerRef.current = window.setTimeout(async () => {
        reconnectTimerRef.current = null;
        if (closedByUsRef.current) return;
        // Re-fetch transcript from DB before reconnecting WS — mirrors
        // ChatPanel's approach so the user sees content immediately.
        const sid = activeSessionIdRef.current;
        if (sid) {
          await refetchTranscript(sid);
          replayingRef.current = true;
        }
        if (closedByUsRef.current) return;
        openWs();
      }, delay);
    }

    // Like ChatPanel.start(): pre-fetch transcript before WS, so the user
    // sees history immediately instead of a blank pane.
    async function start() {
      const initialResume = initialResumeIdRef.current;
      if (initialResume) {
        setStatus('replaying');
        await refetchTranscript(initialResume);
        if (aborted) return;
      }
      openWs();
    }

    // When this tab/window becomes visible again, the WS may have been killed
    // by NAT/OS sleep without us noticing. If we haven't heard from the server
    // recently, recycle the socket to trigger a clean reconnect (with a fresh
    // DB transcript refetch in scheduleReconnect).
    function onVisibilityChange() {
      if (document.visibilityState !== 'visible') return;
      const ws = wsRef.current;
      if (!ws) return;
      if (closedByUsRef.current || sessionExitedRef.current) return;
      const stale = Date.now() - lastMessageAtRef.current > VISIBILITY_STALE_MS;
      if (stale || ws.readyState !== WebSocket.OPEN) {
        try { ws.close(); } catch {}
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    start();
    return () => {
      aborted = true;
      closedByUsRef.current = true;
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (heartbeatTimerRef.current) {
        window.clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }
      document.removeEventListener('visibilitychange', onVisibilityChange);
      try { wsRef.current?.close(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function append(m: Msg) {
    setMsgs((prev) => [...prev, m]);
  }

  function updateTool(toolCallId: string, patch: Partial<Extract<Msg, { role: 'tool' }>>) {
    setMsgs((prev) => prev.map((m) =>
      m.role === 'tool' && m.toolCallId === toolCallId ? { ...m, ...patch } as Msg : m,
    ));
  }

  function appendToStreaming(kind: 'assistant' | 'thought', text: string) {
    if (!text) return;
    const cur = streamingMsgIdRef.current;
    if (cur && cur.kind === kind) {
      const id = cur.id;
      setMsgs((prev) => prev.map((m) =>
        m.id === id && (m.role === 'assistant' || m.role === 'thought')
          ? { ...m, text: m.text + text }
          : m,
      ));
      return;
    }
    const id = shortId();
    streamingMsgIdRef.current = { kind, id };
    append({ id, role: kind, text });
  }

  function handleAcpUpdate(sessionId: string, update: any) {
    // During replay (session/load or ring-buffer attach), skip content — the
    // DB pre-fetch already has it. Metadata (config/mode/title) still passes.
    if (replayingRef.current) {
      const kind = update?.sessionUpdate;
      if (kind === 'agent_message_chunk' || kind === 'thought_message_chunk' ||
          kind === 'user_message_chunk' || kind === 'tool_call' ||
          kind === 'tool_call_update' || kind === 'plan') {
        return;
      }
    }

    switch (update?.sessionUpdate) {
      case 'agent_message_chunk':
        appendToStreaming('assistant', chunkText(update.content));
        return;
      case 'thought_message_chunk':
        appendToStreaming('thought', chunkText(update.content));
        return;
      case 'user_message_chunk': {
        // Two paths reach here: session/load replay (Devin emits historical
        // chunks one per content block), and synthetic chunks the server
        // injects for the current turn's submissions. Either way we want to
        // coalesce consecutive chunks into a single bubble.
        const c = update.content;
        if (!c) return;
        const cur = streamingMsgIdRef.current;
        const isImage = c.type === 'image' && c.data && c.mimeType;
        const url = isImage ? `data:${c.mimeType};base64,${c.data}` : null;
        const textPiece = c.type === 'text' ? (c.text ?? '') : '';
        if (cur?.kind === 'user') {
          const id = cur.id;
          setMsgs((prev) => prev.map((m) => {
            if (m.id !== id || m.role !== 'user') return m;
            const next: any = { ...m };
            if (textPiece) next.text = (m.text ?? '') + textPiece;
            if (url) next.images = [...(m.images ?? []), url];
            return next;
          }));
        } else {
          const id = shortId();
          streamingMsgIdRef.current = { kind: 'user', id };
          append({
            id,
            role: 'user',
            text: textPiece,
            images: url ? [url] : undefined,
          });
        }
        if (!titleSetFromMsg.current && onTitle && textPiece) {
          onTitle(textPiece.slice(0, 40));
          titleSetFromMsg.current = true;
        }
        return;
      }
      case 'tool_call':
        streamingMsgIdRef.current = null;
        append({
          id: shortId(),
          role: 'tool',
          toolCallId: update.toolCallId,
          title: update.title ?? '',
          kind: update.kind ?? 'other',
          status: update.status ?? 'pending',
          rawInput: update.rawInput,
        });
        return;
      case 'tool_call_update': {
        const patch: any = {};
        if (typeof update.status === 'string') patch.status = update.status;
        if (typeof update.title === 'string') patch.title = update.title;
        if (Array.isArray(update.content)) patch.output = toolOutputText(update.content);
        if (update.rawInput) patch.rawInput = update.rawInput;
        updateTool(update.toolCallId, patch);
        return;
      }
      case 'plan': {
        const lines = (update.entries ?? []).map((e: any) => {
          const mark = e.status === 'completed' ? '✅' : e.status === 'in_progress' ? '🚀' : '·';
          return `${mark} ${e.content}`;
        }).join('\n');
        append({ id: shortId(), role: 'system', text: `Plan:\n${lines}` });
        return;
      }
      case 'session_info_update':
        if (typeof update.title === 'string' && onTitle) {
          onTitle(update.title);
          titleSetFromMsg.current = true;
        }
        return;
      case 'current_mode_update':
        if (typeof update.currentModeId === 'string') setCurrentModeId(update.currentModeId);
        return;
      case 'config_option_update':
        if (Array.isArray(update.configOptions)) setConfigOptions(update.configOptions);
        return;
      default:
        // Unknown sessionUpdate variant — log to console for diagnostics but
        // don't surface to the user; ACP grows new variants over time.
        // eslint-disable-next-line no-console
        console.debug('[devin] unhandled sessionUpdate', update?.sessionUpdate, update);
    }
  }

  function handleAcpMessage(data: any) {
    // 1) RPC response (has id + result/error)
    if (typeof data?.id !== 'undefined' && (data.result || data.error)) {
      // Any RPC response may carry an updated configOptions snapshot —
      // session/new and session/load do, and so does session/set_config_option
      // (per ACP spec). Pull it out unconditionally so the picker stays in
      // sync after programmatic config changes.
      if (Array.isArray(data.result?.configOptions)) {
        setConfigOptions(data.result.configOptions);
      }
      // session/new or session/load response carries modes + configOptions
      if (data.result?.sessionId) {
        const sid = data.result.sessionId;
        const wasFresh = !activeSessionIdRef.current;
        activeSessionIdRef.current = sid;
        // Only persist to workspace if we know the session is real:
        // already-persisted from a prior submit, or this is a resume of an
        // existing session. Fresh new sessions wait until first submit so
        // we don't store phantom slugs.
        if (sessionIdPersistedRef.current) {
          onSessionId?.(sid);
        }
        if (data.result.modes) {
          if (Array.isArray(data.result.modes.availableModes)) {
            setModes(data.result.modes.availableModes);
          }
          if (typeof data.result.modes.currentModeId === 'string') {
            setCurrentModeId(data.result.modes.currentModeId);
          }
        }
        if (Array.isArray(data.result.configOptions)) {
          setConfigOptions(data.result.configOptions);
        }
        // Apply the user's default model only for brand-new sessions — resumed
        // sessions keep whatever model they were created with.
        if (wasFresh && defaultModel) {
          const modelCfg = data.result.configOptions?.find?.((c: any) => c.id === 'model');
          if (modelCfg && modelCfg.currentValue !== defaultModel) {
            // changeConfig handles both the WS send and the optimistic UI
            // update so the picker doesn't lag the actual model switch.
            changeConfig('model', defaultModel);
          }
        }
        setStatus('ready');
        // Replay phase is over — live events from here on should be rendered.
        replayingRef.current = false;
      }
      // session/prompt response (has stopReason)
      if (data.result?.stopReason) {
        streamingMsgIdRef.current = null;
        setStatus('ready');
        if (data.result.stopReason !== 'end_turn') {
          showToast(`stop: ${data.result.stopReason}`);
        }
      }
      if (data.error) {
        append({ id: shortId(), role: 'system', text: `RPC error: ${data.error.message ?? JSON.stringify(data.error)}` });
      }
      return;
    }
    // 2) Notification (has method, no id)
    if (typeof data?.method === 'string' && typeof data?.id === 'undefined') {
      if (data.method === 'session/update') {
        const params = data.params ?? {};
        handleAcpUpdate(params.sessionId, params.update);
      }
      return;
    }
    // 3) Agent→client RPC request. Server forwards session/request_permission;
    //    fs/* / terminal/* are auto-rejected before we see them.
    if (typeof data?.method === 'string' && typeof data?.id !== 'undefined') {
      if (data.method === 'session/request_permission') {
        const params = data.params ?? {};
        setPermissionPrompt({
          id: data.id,
          toolCall: params.toolCall ?? {},
          options: Array.isArray(params.options) ? params.options : [],
        });
        return;
      }
      // eslint-disable-next-line no-console
      console.debug('[devin] agent rpc request (auto-rejected by server):', data.method, data.params);
    }
  }

  function handleWsMsg(msg: any) {
    if (msg.type === 'started') {
      if (msg.sessionId) {
        activeSessionIdRef.current = msg.sessionId;
        onSessionId?.(msg.sessionId);
      }
      if (Array.isArray(msg.configOptions)) setConfigOptions(msg.configOptions);
      if (typeof msg.currentModeId === 'string') setCurrentModeId(msg.currentModeId);
      if (msg.promptPending) setStatus('thinking');
      else setStatus(msg.attached ? 'ready' : 'connecting');
      // For resumed sessions the DB pre-fetch already rendered history —
      // don't clear. For fresh sessions (no resume), start blank.
      if (!replayingRef.current) {
        setMsgs([]);
      }

      streamingMsgIdRef.current = null;
      return;
    }
    if (msg.type === 'replay_done') {
      replayingRef.current = false;
      return;
    }
    if (msg.type === 'acp') {
      handleAcpMessage(msg.data);
      return;
    }
    if (msg.type === 'exit') {
      // If we're expecting to spawn fresh (load_failed cleared the resumeId),
      // don't block reconnection — let onclose → scheduleReconnect fire.
      if (wantFreshSpawnRef.current) {
        wantFreshSpawnRef.current = false;
        return;
      }
      sessionExitedRef.current = true;
      append({ id: shortId(), role: 'system', text: `Devin exited (code ${msg.code ?? '?'})` });
      setStatus('closed');
      return;
    }
    if (msg.type === 'stderr') {
      // Devin's stderr (chisel logs) is verbose; only surface clear errors.
      const text = String(msg.data ?? '');
      if (/error|panic|failed/i.test(text)) {
        append({ id: shortId(), role: 'system', text: `[stderr] ${text.trim()}` });
      }
      return;
    }
    if (msg.type === 'error') {
      append({ id: shortId(), role: 'system', text: `Error: ${msg.message}` });
      return;
    }
    if (msg.type === 'permission_timeout') {
      // Server auto-rejected because we never answered. Hide the modal if
      // it's still up — the agent's already received the cancelled outcome.
      setPermissionPrompt((cur) => (cur && cur.id === msg.id ? null : cur));
      showToast('Permission request expired');
      return;
    }
    if (msg.type === 'load_failed') {
      // The sessionId we tried to resume doesn't exist in Devin's local store
      // (a phantom slug from a previous tab where the user never sent a
      // message — Devin doesn't commit a session row until there's content).
      // Drop the stale resumeId, fall back to opening a fresh session.
      const errMsg = msg?.error?.message ?? 'session not found';
      append({ id: shortId(), role: 'system', text: `${errMsg} — starting a fresh Devin session` });
      activeSessionIdRef.current = undefined;
      initialResumeIdRef.current = undefined;
      sessionIdPersistedRef.current = false;
      titleSetFromMsg.current = false;
      // Tell the exit handler (which fires next when server kills the proc)
      // not to block reconnection.
      wantFreshSpawnRef.current = true;
      // Wipe the workspace's stale id too so the user doesn't keep hitting
      // this on every refresh.
      onSessionId?.('');
      // The current ws is about to be closed by the server (we killed the
      // devin proc on the server side). Wait for onclose → scheduleReconnect.
      // Since closedByUsRef.current is false and sessionExitedRef is false,
      // the next openWs() will run with both refs cleared above and open
      // /ws/devin without resume → spawn fresh session.
      return;
    }
  }

  function answerPermission(optionId: string | null) {
    if (!permissionPrompt) return;
    send({ type: 'permission_response', id: permissionPrompt.id, optionId });
    setPermissionPrompt(null);
  }

  async function addFiles(files: FileList | File[]) {
    const arr = Array.from(files).filter((f) => f.type.startsWith('image/'));
    for (const f of arr) {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(f);
      }).catch(() => '');
      if (!dataUrl) continue;
      const comma = dataUrl.indexOf(',');
      if (comma < 0) continue;
      const meta = dataUrl.slice(5, comma); // e.g. "image/png;base64"
      const mediaType = meta.split(';')[0] || f.type || 'image/png';
      const base64 = dataUrl.slice(comma + 1);
      setPendingImages((prev) => [...prev, { id: shortId(), dataUrl, mediaType, base64 }]);
    }
  }

  function submit() {
    const text = input.trim();
    if (!text && pendingImages.length === 0) return;
    if (status === 'closed' || status === 'reconnecting' || status === 'connecting' || status === 'replaying') return;
    const images = pendingImages.map((p) => ({ mediaType: p.mediaType, data: p.base64 }));
    send({ type: 'user', text, images });
    append({
      id: shortId(),
      role: 'user',
      text,
      images: pendingImages.length ? pendingImages.map((p) => p.dataUrl) : undefined,
    });
    setInput('');
    setPendingImages([]);
    setStatus('thinking');
    streamingMsgIdRef.current = null;
    if (!titleSetFromMsg.current && onTitle && text) {
      onTitle(text.slice(0, 40));
      titleSetFromMsg.current = true;
    }
    // First user prompt commits the session in Devin's store. Persist the
    // resumeId to workspace now so a refresh can find it.
    const sid = activeSessionIdRef.current;
    if (sid && !sessionIdPersistedRef.current) {
      sessionIdPersistedRef.current = true;
      onSessionId?.(sid);
    }
  }

  function stop() {
    send({ type: 'cancel' });
    showToast('Cancel requested');
  }

  function changeMode(modeId: string) {
    send({ type: 'set_mode', modeId });
    setCurrentModeId(modeId);
  }

  function changeConfig(configId: string, value: string) {
    send({ type: 'set_config', configId, value });
    // Optimistic local update; the agent will broadcast a config_option_update
    // shortly that corrects this if rejected.
    setConfigOptions((prev) => prev.map((c) =>
      c.id === configId ? { ...c, currentValue: value } : c,
    ));
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // All-thoughts toggle: collapse if any thought is open, otherwise expand all.
  function toggleAllThoughts() {
    const thoughtIds = msgs.filter((m) => m.role === 'thought').map((m) => m.id);
    if (thoughtIds.length === 0) return;
    const anyOpen = thoughtIds.some((id) => expanded.has(id));
    setExpanded((prev) => {
      const next = new Set(prev);
      if (anyOpen) for (const id of thoughtIds) next.delete(id);
      else for (const id of thoughtIds) next.add(id);
      return next;
    });
  }
  const thoughtCount = msgs.filter((m) => m.role === 'thought').length;
  const anyThoughtOpen = msgs.some((m) => m.role === 'thought' && expanded.has(m.id));

  // Esc closes the modal layered on top (popout / model picker / lightbox /
  // permission modal). Order matters: deepest layer first.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (toolPopout) { setToolPopout(null); return; }
      if (modelPickerOpen) { setModelPickerOpen(false); return; }
      if (lightbox) { setLightbox(null); return; }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toolPopout, modelPickerOpen, lightbox]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const wantsCmd = sendKey === 'cmd-enter';
    const wantsShift = sendKey === 'shift-enter';
    const isEnter = e.key === 'Enter';
    if (!isEnter) return;
    if (wantsCmd && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); return; }
    if (wantsShift && e.shiftKey) { e.preventDefault(); submit(); return; }
    if (sendKey === 'enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); submit(); return; }
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickyBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  // Auto-load older messages when the button scrolls into view.
  useEffect(() => {
    const el = loadOlderRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) loadOlder();
    }, { root: scrollRef.current, threshold: 0 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [oldestIdx, loadingMore]);

  // Restore scroll position after prepending older messages (same as ChatPanel).
  useLayoutEffect(() => {
    const snap = beforePrependRef.current;
    const el = scrollRef.current;
    if (snap && el) {
      el.scrollTop = snap.top + (el.scrollHeight - snap.height);
      beforePrependRef.current = null;
    }
  }, [msgs]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickyBottomRef.current = (el.scrollHeight - el.scrollTop - el.clientHeight) < 50;
  }

  const modelOption = configOptions.find((c) => c.id === 'model') ?? null;
  const modelCurrent = modelOption?.currentValue ?? '';
  const modelDisplay = (() => {
    if (!modelOption) return '';
    const m = modelOption.options?.find((o) => o.value === modelCurrent);
    return m?.name ?? modelCurrent;
  })();
  // Devin's native model order groups by internal family ID with no obvious
  // UX meaning. Sort alphabetically by display name so the picker is
  // scannable; current value stays selected regardless of order.
  const sortedModelOptions = (modelOption?.options ?? []).slice().sort(
    (a, b) => (a.name ?? a.value).localeCompare(b.name ?? b.value, undefined, { sensitivity: 'base' }),
  );

  // Available modes can come from two sources: session/new|load's `result.modes`
  // (cached in the `modes` state), or the "mode" config option that ships in
  // every configOptions snapshot. Prefer configOptions because it's broadcast
  // on attach/resume too — the `result.modes` path only fires once.
  const modeConfigOption = configOptions.find((c) => c.id === 'mode') ?? null;
  const availableModes: Mode[] =
    modes.length > 0
      ? modes
      : (modeConfigOption?.options ?? []).map((o) => ({ id: o.value, name: o.name }));
  const effectiveModeId =
    currentModeId ?? modeConfigOption?.currentValue ?? null;

  const statusLabel = (() => {
    if (toast) return toast;
    switch (status) {
      case 'ready': return 'Ready';
      case 'connecting': return 'Connecting…';
      case 'replaying': return 'Loading history…';
      case 'reconnecting': return 'Reconnecting…';
      case 'closed': return 'Disconnected';
      case 'thinking': return '';
      default: return status;
    }
  })();

  const inputDisabled = status === 'closed';
  const sendDisabled =
    inputDisabled || status === 'connecting' || status === 'reconnecting' || status === 'replaying' ||
    (!input.trim() && pendingImages.length === 0);

  return (
    <div className="chat">
      <div className="chat-messages" ref={scrollRef} onScroll={onScroll}>
        {oldestIdx > 0 && (
          <button
            ref={loadOlderRef}
            className="load-older"
            onClick={loadOlder}
            disabled={loadingMore}
          >
            {loadingMore ? 'Loading…' : 'Load older messages'}
          </button>
        )}
        {msgs.map((m) => {
          if (m.role === 'user') {
            return (
              <div key={m.id} className="msg msg-user">
                {m.images && m.images.length > 0 && (
                  <div className="msg-images">
                    {m.images.map((src, i) => (
                      <img key={i} src={src} className="msg-image" alt="" onClick={() => setLightbox(src)} />
                    ))}
                  </div>
                )}
                {m.text && <div>{m.text}</div>}
              </div>
            );
          }
          if (m.role === 'assistant') {
            return (
              <div key={m.id} className="msg msg-assistant">
                <MarkdownText text={m.text} theme={theme} />
              </div>
            );
          }
          if (m.role === 'thought') {
            const isOpen = expanded.has(m.id);
            return (
              <div key={m.id} className={`msg msg-tool msg-thought ${isOpen ? 'open' : ''}`}>
                <div className="tool-header" onClick={() => toggleExpanded(m.id)}>
                  <span className="tool-chevron">{isOpen ? '▾' : '▸'}</span>
                  <span className="tool-name">thinking</span>
                  <span className="tool-summary">{m.text.slice(0, 80)}</span>
                </div>
                {isOpen && (
                  <div className="tool-detail">
                    <pre className="tool-field-value">{m.text}</pre>
                  </div>
                )}
              </div>
            );
          }
          if (m.role === 'system') {
            return <div key={m.id} className="msg msg-system">{m.text}</div>;
          }
          // tool
          const isOpen = expanded.has(m.id);
          const pending = m.status === 'pending' || m.status === 'in_progress';
          const failed = m.status === 'failed';
          const summary = summarizeDevinTool(m.kind, m.rawInput, m.title);
          return (
            <div key={m.id} className={`msg msg-tool ${isOpen ? 'open' : ''}`}>
              <div className="tool-header" onClick={() => toggleExpanded(m.id)}>
                <span className="tool-chevron">{isOpen ? '▾' : '▸'}</span>
                <span className="tool-name">{m.kind}</span>
                {summary && <span className="tool-summary">{summary}</span>}
                {pending && <span className="tool-pending">…</span>}
                {failed && <span className="tool-pending" title="failed">✗</span>}
                <button
                  className="tool-popout-btn"
                  onClick={(e) => { e.stopPropagation(); setToolPopout(m); }}
                  title="Open full details"
                  aria-label="Open full details"
                >⛶</button>
              </div>
              {isOpen && (
                <div className="tool-detail">
                  <ToolFields input={m.rawInput} />
                  {m.output !== undefined && (
                    <div className="tool-field">
                      <div className="tool-field-key">output</div>
                      <pre className="tool-field-value">{m.output}</pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {status === 'thinking' && (
          <div className="msg msg-thinking" aria-label="Devin is thinking">
            <span className="thinking-dot" />
            <span className="thinking-dot" />
            <span className="thinking-dot" />
          </div>
        )}
      </div>

      {(status !== 'thinking' || toast || modelDisplay || availableModes.length > 0) && (
        <div className={`chat-status status-${status}`}>
          <span>{statusLabel}</span>
          <div className="chat-status-model-wrap">
            {thoughtCount > 0 && (
              <button
                className="chat-status-model"
                onClick={toggleAllThoughts}
                title={anyThoughtOpen ? 'Collapse all thoughts' : `Expand all thoughts (${thoughtCount})`}
                type="button"
              >
                {anyThoughtOpen ? '▾' : '▸'} thoughts·{thoughtCount}
              </button>
            )}
            {availableModes.length > 0 && (
              <select
                className="chat-status-model chat-status-mode"
                value={effectiveModeId ?? ''}
                onChange={(e) => changeMode(e.target.value)}
                title="Mode"
              >
                {availableModes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {(MODE_ICON[m.id] ?? '') + ' ' + (m.name ?? m.id)}
                  </option>
                ))}
              </select>
            )}
            {modelOption && (
              <>
                <button
                  className="chat-status-model"
                  onClick={() => setModelPickerOpen((v) => !v)}
                  title={`Model — ${modelDisplay}`}
                  type="button"
                >{modelDisplay || 'model'}</button>
                {modelPickerOpen && (
                  <>
                    <div className="model-picker-backdrop" onClick={() => setModelPickerOpen(false)} />
                    <div className="model-picker model-picker-grouped">
                      {(() => {
                        const groups = new Map<string, typeof sortedModelOptions>();
                        for (const o of sortedModelOptions) {
                          const fam = devinModelFamily(o.value);
                          if (!groups.has(fam)) groups.set(fam, [] as any);
                          groups.get(fam)!.push(o);
                        }
                        const ordered: string[] = [
                          ...FAMILY_ORDER.filter((f) => groups.has(f)),
                          ...[...groups.keys()].filter((f) => !FAMILY_ORDER.includes(f)).sort(),
                        ];
                        const defaultId = defaultModel ?? '';
                        return ordered.map((fam) => (
                          <div key={fam} className="model-picker-group">
                            <div className="model-picker-group-label">{fam}</div>
                            {groups.get(fam)!.map((o) => (
                              <button
                                key={o.value}
                                className={`model-picker-item ${o.value === modelCurrent ? 'current' : ''}`}
                                onClick={() => {
                                  changeConfig('model', o.value);
                                  setModelPickerOpen(false);
                                }}
                                type="button"
                              >
                                <span>
                                  {o.value === defaultId && <span className="model-picker-star" title="Default for new sessions">★ </span>}
                                  {o.name ?? o.value}
                                </span>
                                <code className="model-picker-id">{o.value}</code>
                              </button>
                            ))}
                          </div>
                        ));
                      })()}
                      {onSetDefaultModel && modelCurrent && modelCurrent !== (defaultModel ?? '') && (
                        <button
                          className="model-picker-footer-action"
                          onClick={() => {
                            onSetDefaultModel(modelCurrent);
                            setModelPickerOpen(false);
                          }}
                          type="button"
                        >★ Set current as default for new sessions</button>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {pendingImages.length > 0 && (
        <div className="chat-pending-images">
          {pendingImages.map((img) => (
            <div key={img.id} className="pending-thumb">
              <img src={img.dataUrl} alt="" onClick={() => setLightbox(img.dataUrl)} />
              <button
                className="pending-thumb-del"
                onClick={() => setPendingImages((prev) => prev.filter((p) => p.id !== img.id))}
                title="Remove"
              >×</button>
            </div>
          ))}
        </div>
      )}
      <div className="chat-input">
        <button
          className="chat-attach"
          onClick={() => fileInputRef.current?.click()}
          title="Attach image"
          disabled={inputDisabled}
        >📎</button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            const files: File[] = [];
            for (const item of Array.from(items)) {
              if (item.kind === 'file' && item.type.startsWith('image/')) {
                const f = item.getAsFile();
                if (f) files.push(f);
              }
            }
            if (files.length) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          placeholder={
            status === 'closed' ? 'closed'
            : status === 'thinking' ? 'Devin is working — type to queue / send another'
            : status === 'connecting' || status === 'reconnecting' || status === 'replaying' ? status
            : sendKeyHint(sendKey)
          }
          disabled={inputDisabled}
        />
        <button onClick={submit} disabled={sendDisabled}>Send</button>
        {status === 'thinking' && (
          <button className="chat-stop" onClick={stop} title="Interrupt current turn">Stop</button>
        )}
      </div>

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" onClick={(e) => e.stopPropagation()} />
          <button className="lightbox-close" onClick={() => setLightbox(null)} aria-label="Close">×</button>
        </div>
      )}

      {toolPopout && toolPopout.role === 'tool' && (
        <div className="tool-popout-backdrop" onClick={() => setToolPopout(null)}>
          <div className="tool-popout-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tool-popout-header">
              <span className="tool-name">{toolPopout.kind}</span>
              <span className="tool-summary">
                {summarizeDevinTool(toolPopout.kind, toolPopout.rawInput, toolPopout.title)}
              </span>
              <button
                className="tool-popout-close"
                onClick={() => setToolPopout(null)}
                aria-label="Close"
              >×</button>
            </div>
            <div className="tool-popout-body">
              <ToolFields input={toolPopout.rawInput} />
              {toolPopout.output !== undefined && (
                <div className="tool-field">
                  <div className="tool-field-key">output</div>
                  <pre className="tool-field-value tool-field-value-full">{toolPopout.output}</pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {permissionPrompt && (
        <div className="permission-backdrop" onClick={() => answerPermission(null)}>
          <div className="permission-modal" onClick={(e) => e.stopPropagation()}>
            <div className="permission-header">
              <span className="permission-kind">[{permissionPrompt.toolCall.kind ?? 'tool'}]</span>
              <span className="permission-title">{permissionPrompt.toolCall.title ?? 'Permission required'}</span>
            </div>
            {permissionPrompt.toolCall.rawInput && (
              <pre className="permission-input">
                {JSON.stringify(permissionPrompt.toolCall.rawInput, null, 2)}
              </pre>
            )}
            <div className="permission-actions">
              {permissionPrompt.options.map((o) => (
                <button
                  key={o.optionId}
                  className={`permission-option permission-${o.kind ?? 'other'}`}
                  onClick={() => answerPermission(o.optionId)}
                >
                  {o.name ?? o.optionId}
                </button>
              ))}
              <button className="permission-option permission-cancel" onClick={() => answerPermission(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {exportOpen && (
        <Suspense fallback={null}>
          <ExportDialog
            projectId={projectId}
            messages={devinMsgsToExport(msgs)}
            source="devin"
            theme={theme}
            onClose={() => setExportOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}

// Map DevinPanel's internal Msg variants to ExportMessage. Devin's tool has
// (kind, title, rawInput) — fold those into the unified shape so the export
// layer can stay agent-agnostic.
function devinMsgsToExport(msgs: Msg[]): ExportMessage[] {
  return msgs.map((m): ExportMessage => {
    if (m.role === 'user') return { kind: 'user', text: m.text, images: m.images };
    if (m.role === 'assistant') return { kind: 'assistant', text: m.text };
    if (m.role === 'thought') return { kind: 'thought', text: m.text };
    if (m.role === 'system') return { kind: 'system', text: m.text };
    return { kind: 'tool', name: m.kind, title: m.title, input: m.rawInput, output: m.output };
  });
}
