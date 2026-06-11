import { useRef, useState } from 'react';
import type { Settings, SendKey, Theme, FontScale } from '../types';
import { usePwaInstall } from '../usePwaInstall';

const SEND_KEY_OPTIONS: { value: SendKey; label: string; hint: string }[] = [
  { value: 'cmd-enter', label: 'Cmd/Ctrl + Enter', hint: 'Enter inserts newline; ⌘/Ctrl + Enter sends' },
  { value: 'shift-enter', label: 'Shift + Enter', hint: 'Enter inserts newline; Shift + Enter sends' },
  { value: 'enter', label: 'Enter', hint: 'Enter sends; Shift + Enter inserts newline' },
];

const THEME_OPTIONS: { value: Theme; label: string; hint: string }[] = [
  { value: 'dark', label: 'Dark', hint: 'VSCode-like dark palette (default)' },
  { value: 'light', label: 'Light', hint: 'Clean light palette' },
  { value: 'dim', label: 'Dim', hint: 'Softer dark (GitHub Dim-ish)' },
];

// Curated model list (knowledge cutoff Jan 2026). The CLI accepts aliases
// (auto-resolve to family's latest) and full IDs (lock specific snapshot).
const MODEL_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: '', label: 'Default', hint: 'Whatever claude CLI picks' },
  { value: 'opus', label: 'Opus (latest)', hint: 'Alias — auto-upgrade on new releases' },
  { value: 'sonnet', label: 'Sonnet (latest)', hint: 'Alias — auto-upgrade on new releases' },
  { value: 'haiku', label: 'Haiku (latest)', hint: 'Alias — auto-upgrade on new releases' },
  { value: 'claude-opus-4-7[1m]', label: 'Opus 4.7 · 1M context', hint: 'Large context window' },
  { value: 'claude-opus-4-7', label: 'Opus 4.7', hint: 'Standard context' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6', hint: 'Specific snapshot' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', hint: 'Specific snapshot' },
];

// Devin exposes ~75 model IDs via ACP; this curated set covers the practical
// picks. Empty value defers to Devin's own default (swe-1-6-fast at the time
// of writing). Mid-session switching is available via the model picker.
const DEVIN_MODEL_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: '', label: 'Default', hint: "Whatever Devin picks" },
  { value: 'claude-opus-4-7-medium', label: 'Claude Opus 4.7 · Medium', hint: 'Balanced reasoning' },
  { value: 'claude-opus-4-7-high', label: 'Claude Opus 4.7 · High', hint: 'More reasoning, slower' },
  { value: 'claude-opus-4-6-thinking', label: 'Claude Opus 4.6 Thinking', hint: 'Previous flagship + thinking' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', hint: 'Faster, less expensive' },
  { value: 'claude-sonnet-4-6-thinking', label: 'Claude Sonnet 4.6 Thinking', hint: 'Sonnet + thinking' },
  { value: 'gpt-5-5-medium', label: 'GPT-5.5 · Medium', hint: 'OpenAI mid tier' },
  { value: 'gpt-5-5-high', label: 'GPT-5.5 · High', hint: 'OpenAI high tier' },
  { value: 'gemini-3-1-pro-high', label: 'Gemini 3.1 Pro · High', hint: 'Google high tier' },
  { value: 'adaptive', label: 'Adaptive', hint: 'Devin auto-balances quality/cost' },
];

const FONT_SCALE_OPTIONS: { value: FontScale; label: string; hint: string }[] = [
  { value: 'small', label: 'Small', hint: 'Compact — more content per screen' },
  { value: 'normal', label: 'Normal', hint: 'Default reading size' },
  { value: 'large', label: 'Large', hint: '1.18×' },
  { value: 'xlarge', label: 'Extra Large', hint: '1.35×' },
  { value: 'huge', label: 'Huge', hint: '1.65×' },
  { value: 'xhuge', label: 'Extra Huge', hint: '2.0× — accessibility / projection' },
];

export function Settings({
  settings,
  username,
  onChange,
  onClose,
  onSignOut,
}: {
  settings: Settings;
  username?: string;
  onChange: (s: Settings) => void;
  onClose: () => void;
  onSignOut: () => void;
}) {
  // Auto-saved indicator. Settings persist on every change; we flash a
  // "Saved" badge so the user has feedback (no explicit Save button means
  // people often wonder if their click took effect).
  const [savedFlash, setSavedFlash] = useState(false);
  const flashTimer = useRef<number | null>(null);
  const pwa = usePwaInstall();
  function commit(next: Settings) {
    onChange(next);
    setSavedFlash(true);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setSavedFlash(false), 1200);
  }
  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span>Settings</span>
          <span className="settings-saved-flash" data-on={savedFlash ? '1' : '0'}>Saved ✓</span>
          <button className="settings-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="settings-body">
          <div className="settings-section">
            <div className="settings-label">Theme</div>
            {THEME_OPTIONS.map((opt) => (
              <label key={opt.value} className="settings-option">
                <input
                  type="radio"
                  name="theme"
                  checked={settings.theme === opt.value}
                  onChange={() => commit({ ...settings, theme: opt.value })}
                />
                <div className="settings-option-text">
                  <div>{opt.label}</div>
                  <div className="settings-option-hint">{opt.hint}</div>
                </div>
              </label>
            ))}
          </div>
          <div className="settings-section">
            <div className="settings-label">Default Claude model (new sessions)</div>
            {MODEL_OPTIONS.map((opt) => (
              <label key={opt.value || 'default'} className="settings-option">
                <input
                  type="radio"
                  name="model"
                  checked={(settings.model ?? '') === opt.value}
                  onChange={() => commit({ ...settings, model: opt.value })}
                />
                <div className="settings-option-text">
                  <div>{opt.label} {opt.value && <code className="settings-mono">{opt.value}</code>}</div>
                  <div className="settings-option-hint">{opt.hint}</div>
                </div>
              </label>
            ))}
            <div className="settings-option-hint" style={{ marginTop: 4 }}>
              Mid-session switching: click the model name in the status bar.
            </div>
          </div>
          <div className="settings-section">
            <div className="settings-label">Default Devin model (new sessions)</div>
            {DEVIN_MODEL_OPTIONS.map((opt) => (
              <label key={opt.value || 'devin-default'} className="settings-option">
                <input
                  type="radio"
                  name="devinModel"
                  checked={(settings.devinModel ?? '') === opt.value}
                  onChange={() => commit({ ...settings, devinModel: opt.value })}
                />
                <div className="settings-option-text">
                  <div>{opt.label} {opt.value && <code className="settings-mono">{opt.value}</code>}</div>
                  <div className="settings-option-hint">{opt.hint}</div>
                </div>
              </label>
            ))}
            <div className="settings-option-hint" style={{ marginTop: 4 }}>
              Devin's full list (~75 models) is available mid-session via the model picker.
            </div>
          </div>
          <div className="settings-section">
            <div className="settings-label">Font size</div>
            {FONT_SCALE_OPTIONS.map((opt) => (
              <label key={opt.value} className="settings-option">
                <input
                  type="radio"
                  name="fontScale"
                  checked={settings.fontScale === opt.value}
                  onChange={() => commit({ ...settings, fontScale: opt.value })}
                />
                <div className="settings-option-text">
                  <div>{opt.label}</div>
                  <div className="settings-option-hint">{opt.hint}</div>
                </div>
              </label>
            ))}
          </div>
          <div className="settings-section">
            <div className="settings-label">Send message with</div>
            {SEND_KEY_OPTIONS.map((opt) => (
              <label key={opt.value} className="settings-option">
                <input
                  type="radio"
                  name="sendKey"
                  checked={settings.sendKey === opt.value}
                  onChange={() => commit({ ...settings, sendKey: opt.value })}
                />
                <div className="settings-option-text">
                  <div>{opt.label}</div>
                  <div className="settings-option-hint">{opt.hint}</div>
                </div>
              </label>
            ))}
          </div>
          <div className="settings-section">
            <div className="settings-label">Install as app</div>
            {pwa.isInstalled ? (
              <div className="settings-option-hint">Already installed on this device.</div>
            ) : pwa.canInstall ? (
              <div className="settings-account-row">
                <div className="settings-option-text">
                  <div>Pin Remote IDE to your home screen / launcher.</div>
                  <div className="settings-option-hint">Standalone window, no browser chrome.</div>
                </div>
                <button className="settings-signout" onClick={() => pwa.install()}>Install app</button>
              </div>
            ) : (
              <div className="settings-option-hint">
                Browser hasn't offered installation yet — interact with the app for a bit then reopen Settings, or use the browser menu (Chrome: ⋮ → Install / Add to Home Screen; iOS Safari: Share → Add to Home Screen).
              </div>
            )}
          </div>
          {username && (
            <div className="settings-section">
              <div className="settings-label">Account</div>
              <div className="settings-account-row">
                <div className="settings-option-text">
                  <div>Signed in as <code className="settings-mono">{username}</code></div>
                </div>
                <button className="settings-signout" onClick={onSignOut}>Sign out</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
