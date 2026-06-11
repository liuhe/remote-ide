import { useEffect, useRef, useState } from 'react';
import type { Tab } from '../types';

function tabLabel(tab: Tab): string {
  if (tab.type === 'file') {
    const parts = tab.path.split('/');
    return parts[parts.length - 1] || tab.path;
  }
  // session (claude) and devin share this shape: resumeId + title
  const idPart = tab.resumeId ? tab.resumeId.slice(0, 8) : '';
  const fallback = tab.type === 'devin' ? 'Devin session' : 'AI session';
  if (tab.title && idPart) return `${idPart} · ${tab.title}`;
  return tab.title || idPart || fallback;
}

function tabIcon(tab: Tab): string {
  if (tab.type === 'file') return '📄';
  if (tab.type === 'devin') return '🧬';
  return '🤖';
}

function tabTitle(tab: Tab): string {
  if (tab.type === 'file') return tab.path;
  return tab.type === 'devin' ? 'Devin session' : 'AI session';
}

export function TabBar({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  onNewSession,
  onResumeSession,
  onNewDevinSession,
  onResumeDevinSession,
  onMenuClick,
  onRefresh,
  onExport,
  canExport,
  activeProjectName,
}: {
  tabs: Tab[];
  activeTabId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNewSession: () => void;
  onResumeSession?: () => void;
  onNewDevinSession?: () => void;
  onResumeDevinSession?: () => void;
  onMenuClick?: () => void;
  onRefresh?: () => void;
  onExport?: () => void;
  canExport?: boolean;
  activeProjectName?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function toggleMenu() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setMenuPos({ top: r.bottom + 2, right: Math.max(4, window.innerWidth - r.right) });
    }
    setOpen((v) => !v);
  }

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent | TouchEvent) {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open]);

  return (
    <div className="tab-bar">
      {onMenuClick && (
        <button className="tab-menu" onClick={onMenuClick} title={activeProjectName ?? 'Menu'}>☰</button>
      )}
      {(() => {
        const active = tabs.find((t) => t.id === activeTabId);
        return (
          <div className="tab-current">
            {!active && <span className="tab-current-empty">No tab</span>}
            {active && (
              <>
                <span className="tab-icon">{tabIcon(active)}</span>
                <span className="tab-current-label" title={tabTitle(active)}>
                  {tabLabel(active)}
                </span>
                <button
                  className="tab-close"
                  onClick={() => onClose(active.id)}
                  title="Close"
                >×</button>
              </>
            )}
          </div>
        );
      })()}
      <div className="tab-list">
        {tabs.map((t) => (
          <div
            key={t.id}
            className={`tab ${t.id === activeTabId ? 'active' : ''} tab-${t.type}`}
            onClick={() => onActivate(t.id)}
            title={tabTitle(t)}
          >
            <span className="tab-icon">{tabIcon(t)}</span>
            <span className="tab-label">{tabLabel(t)}</span>
            <button
              className="tab-close"
              onClick={(e) => { e.stopPropagation(); onClose(t.id); }}
              title="Close"
            >×</button>
          </div>
        ))}
      </div>
      <div className="tab-overflow">
        <button ref={btnRef} className="tab-overflow-btn" onClick={toggleMenu} aria-label="Tab menu">⋮</button>
        {open && (
          <div
            ref={menuRef}
            className="tab-overflow-menu"
            style={{ top: menuPos.top, right: menuPos.right }}
          >
            {onRefresh && activeTabId && (
              <button
                className="overflow-action"
                onClick={() => { setOpen(false); onRefresh(); }}
              >↻ Refresh tab</button>
            )}
            {onExport && activeTabId && (
              <button
                className="overflow-action"
                onClick={() => { setOpen(false); onExport(); }}
                disabled={!canExport}
              >⤓ Export session</button>
            )}
            {((onRefresh && activeTabId) || (onExport && activeTabId)) && (
              <div className="overflow-divider" />
            )}
            <button
              className="overflow-action"
              onClick={() => { setOpen(false); onNewSession(); }}
            >+ New Claude session</button>
            {onResumeSession && (
              <button
                className="overflow-action"
                onClick={() => { setOpen(false); onResumeSession(); }}
              >↻ Resume Claude session</button>
            )}
            {onNewDevinSession && (
              <button
                className="overflow-action"
                onClick={() => { setOpen(false); onNewDevinSession(); }}
              >+ New Devin session</button>
            )}
            {onResumeDevinSession && (
              <button
                className="overflow-action"
                onClick={() => { setOpen(false); onResumeDevinSession(); }}
              >↻ Resume Devin session</button>
            )}
            {tabs.length > 0 && <div className="overflow-divider" />}
            {tabs.map((t) => (
              <div
                key={t.id}
                className={`overflow-tab ${t.id === activeTabId ? 'active' : ''}`}
                onClick={() => { setOpen(false); onActivate(t.id); }}
              >
                <span className="tab-icon">{tabIcon(t)}</span>
                <span className="overflow-tab-label">{tabLabel(t)}</span>
                <button
                  className="tab-close"
                  onClick={(e) => { e.stopPropagation(); onClose(t.id); }}
                  title="Close"
                >×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
