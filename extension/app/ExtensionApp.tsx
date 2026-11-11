import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TOOL_MODULES, getToolById } from '../../src/tools/registry';
import type { ToolModule } from '../../src/tools/types';
import { THEMES, applyTheme, nextTheme, type ThemeId } from '../../src/utils/theme';
import {
  DEFAULT_SETTINGS,
  getSettings,
  onSettingsChanged,
  patchSettings,
  takePendingInput,
  type ExtSettings,
  type PendingInput,
} from './ext-storage';
import { ONLINE_TOOL_IDS } from './ext-fetch-shim';
import { prefillTool } from './prefill';

/** Subsequence-style fuzzy score (0 = no match). Substring hits rank highest. */
function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 1;
  const idx = t.indexOf(q);
  if (idx >= 0) return 100 - Math.min(idx, 60);
  let ti = 0;
  let last = -2;
  let score = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return 0;
    score += found === last + 1 ? 5 : 1;
    last = found;
    ti = found + 1;
  }
  return (score / (q.length * 5)) * 50;
}

function rankModules(query: string): ToolModule[] {
  if (!query.trim()) return TOOL_MODULES;
  return TOOL_MODULES.map((m) => {
    const primary = fuzzyScore(query, `${m.code} ${m.shortTitle} ${m.title} ${m.badge}`);
    const secondary = fuzzyScore(query, `${m.capabilities.join(' ')} ${m.description}`) * 0.4;
    return { m, s: Math.max(primary, secondary) };
  })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.m);
}

function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    (el.tagName === 'INPUT' &&
      (el as HTMLInputElement).type !== 'checkbox' &&
      (el as HTMLInputElement).type !== 'range') ||
    el.tagName === 'TEXTAREA' ||
    el.isContentEditable
  );
}

type View = { kind: 'launcher' } | { kind: 'tool'; id: string };

interface Boot {
  settings: ExtSettings;
  pending: PendingInput | null;
}

// Run once per page load (also survives React StrictMode's double effect in dev).
let bootPromise: Promise<Boot> | null = null;
function boot(): Promise<Boot> {
  bootPromise ??= (async () => ({
    settings: await getSettings(),
    pending: await takePendingInput(),
  }))();
  return bootPromise;
}

const isPopup = document.documentElement.classList.contains('ext-popup');

export function ExtensionApp() {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<ExtSettings>(DEFAULT_SETTINGS);
  const [view, setView] = useState<View>({ kind: 'launcher' });
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [prefill, setPrefill] = useState<PendingInput | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const toolBodyRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => rankModules(query), [query]);

  // ---- boot: settings -> theme -> start view (pending context-menu input wins) ----
  useEffect(() => {
    let alive = true;
    void boot().then(({ settings: s, pending }) => {
      if (!alive) return;
      setSettings(s);
      applyTheme(s.theme);
      if (pending) {
        const target = getToolById(pending.toolId);
        if (target) {
          setView({ kind: 'tool', id: target.id });
          setPrefill(pending);
        } else {
          setQuery(pending.text.slice(0, 60));
        }
      } else if (s.startMode === 'default-tool' && getToolById(s.defaultToolId)) {
        setView({ kind: 'tool', id: s.defaultToolId as string });
      }
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // ---- live sync (popup <-> side panel) ----
  useEffect(
    () =>
      onSettingsChanged((s) => {
        setSettings(s);
        applyTheme(s.theme);
      }),
    []
  );

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1400);
  }, []);

  const update = useCallback(async (patch: Partial<ExtSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    await patchSettings(patch);
  }, []);

  const setTheme = useCallback(
    (id: ThemeId) => {
      applyTheme(id);
      void update({ theme: id });
    },
    [update]
  );

  const openTool = useCallback((id: string) => {
    setPrefill(null);
    setView({ kind: 'tool', id });
  }, []);

  const goLauncher = useCallback(() => {
    setView({ kind: 'launcher' });
    setQuery('');
    setSelected(0);
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }, []);

  const togglePin = useCallback(() => {
    if (view.kind !== 'tool') return;
    if (settings.defaultToolId === view.id) {
      void update({ defaultToolId: null, startMode: 'launcher' });
      flash('DEFAULT TOOL CLEARED');
    } else {
      void update({ defaultToolId: view.id, startMode: 'default-tool' });
      flash('PINNED AS DEFAULT');
    }
  }, [view, settings.defaultToolId, update, flash]);

  const openSidePanel = useCallback(async () => {
    if (typeof chrome === 'undefined' || !chrome.sidePanel) {
      flash('SIDE PANEL NOT SUPPORTED');
      return;
    }
    try {
      const win = await chrome.windows.getCurrent();
      await chrome.sidePanel.open({ windowId: win.id as number });
      if (isPopup) window.close();
    } catch {
      flash('COULD NOT OPEN SIDE PANEL');
    }
  }, [flash]);

  // ---- prefill from context menu once the tool has mounted ----
  useEffect(() => {
    if (!ready || view.kind !== 'tool' || !prefill || !toolBodyRef.current) return;
    const cancel = prefillTool(toolBodyRef.current, prefill.text, prefill.hint);
    return cancel;
  }, [ready, view, prefill]);

  // focus search on launcher
  useEffect(() => {
    if (ready && view.kind === 'launcher') searchRef.current?.focus();
  }, [ready, view.kind]);

  useEffect(() => setSelected(0), [query]);

  // ---- global keyboard handling ----
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const typing = isTextEntry(e.target);

      // Alt+T cycle theme, Alt+P pin, Alt+S side panel (never fires while typing)
      if (e.altKey && !e.ctrlKey && !e.metaKey && !typing) {
        if (e.code === 'KeyT') {
          e.preventDefault();
          setTheme(nextTheme(settings.theme));
          return;
        }
        if (e.code === 'KeyP' && view.kind === 'tool') {
          e.preventDefault();
          togglePin();
          return;
        }
        if (e.code === 'KeyS' && !e.shiftKey) {
          e.preventDefault();
          void openSidePanel();
          return;
        }
      }

      if (e.key === 'Escape') {
        if (typing && e.target instanceof HTMLElement && view.kind === 'tool') {
          e.preventDefault();
          e.target.blur(); // unlock single-key shortcuts first
          return;
        }
        if (view.kind === 'tool') {
          e.preventDefault();
          goLauncher();
        } else if (query) {
          e.preventDefault();
          setQuery('');
        }
        return;
      }

      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

      // Digits 1-9 jump straight to a module (launcher: when search is empty; tool: always)
      if (/^[1-9]$/.test(e.key) && (view.kind === 'tool' || !query)) {
        const m = TOOL_MODULES.find((t) => t.shortcut === e.key);
        if (m) {
          e.preventDefault();
          openTool(m.id);
        }
        return;
      }

      if (view.kind === 'launcher' && e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [view, query, settings.theme, setTheme, togglePin, openSidePanel, goLauncher, openTool]);

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = results[selected];
      if (pick) openTool(pick.id);
    } else if (/^[1-9]$/.test(e.key) && !query && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const m = TOOL_MODULES.find((t) => t.shortcut === e.key);
      if (m) {
        e.preventDefault();
        openTool(m.id);
      }
    }
  };

  if (!ready) return <div className="ext-root" />;

  const activeModule = view.kind === 'tool' ? getToolById(view.id) : undefined;
  const ActiveTool = activeModule?.Component;
  const pinnedId = settings.defaultToolId;

  return (
    <div className="ext-root">
      {/* ===== TOP NAV BAR ===== */}
      <header className="ext-topbar">
        <button
          type="button"
          className={`retro-header-btn ext-home-btn ${view.kind === 'launcher' ? 'ext-home-active' : ''}`}
          onClick={goLauncher}
          title="All tools [Esc]"
        >
          ⚓ TOOLS
        </button>

        {activeModule ? (
          <>
            <select
              className="pane-module-select ext-tool-select"
              aria-label="Switch tool"
              value={activeModule.id}
              onChange={(e) => {
                openTool(e.target.value);
                e.target.blur();
              }}
            >
              {TOOL_MODULES.map((m) => (
                <option key={m.id} value={m.id}>
                  [{m.shortcut}] {m.shortTitle}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={`retro-header-btn ${pinnedId === activeModule.id ? 'ext-pinned' : ''}`}
              onClick={togglePin}
              title="Pin as default tool [Alt+P]"
            >
              {pinnedId === activeModule.id ? '★ DEFAULT' : '☆ PIN'}
            </button>
          </>
        ) : (
          <span className="ext-title">TECHTOOLS // CIC DECK</span>
        )}

        <span className="ext-spacer" />

        {isPopup && typeof chrome !== 'undefined' && chrome.sidePanel && (
          <button
            type="button"
            className="retro-header-btn"
            onClick={() => void openSidePanel()}
            title="Open in docked side panel [Alt+S]"
          >
            ▥ PANEL
          </button>
        )}

        <div className="theme-switcher">
          <select
            className="theme-switcher-select"
            aria-label="Color theme"
            value={settings.theme}
            title="Theme [Alt+T]"
            onChange={(e) => {
              setTheme(e.target.value as ThemeId);
              e.target.blur();
            }}
          >
            {THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <span className="theme-switcher-key" aria-hidden="true">
            [Alt+T]
          </span>
        </div>

        <a
          className="retro-header-btn retro-header-link"
          href="https://techtools.subwrite.se"
          target="_blank"
          rel="noopener noreferrer"
          title="Open full web app"
        >
          ↗
        </a>
      </header>

      {toast && <div className="ext-toast">{toast}</div>}

      {/* ===== BODY ===== */}
      <main className="ext-body">
        {view.kind === 'launcher' || !ActiveTool || !activeModule ? (
          <div className="ext-launcher">
            <input
              ref={searchRef}
              className="navy-input ext-search"
              type="text"
              value={query}
              placeholder="Search…  (1-9 jump · ↑↓ · Enter)"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKeyDown}
              spellCheck={false}
              autoFocus
            />

            <ul className="ext-results" role="listbox">
              {results.length === 0 && <li className="ext-empty">No matching tool.</li>}
              {results.map((m, i) => (
                <li key={m.id} role="option" aria-selected={i === selected}>
                  <button
                    type="button"
                    className={`ext-result ${i === selected ? 'selected' : ''}`}
                    onClick={() => openTool(m.id)}
                    onMouseEnter={() => setSelected(i)}
                  >
                    <span className="ext-result-key">[{m.shortcut}]</span>
                    <span className="ext-result-main">
                      <strong>
                        {pinnedId === m.id ? '★ ' : ''}
                        {m.shortTitle}
                      </strong>
                      <small>{m.title}</small>
                    </span>
                    <span className={`ext-tag ${ONLINE_TOOL_IDS.has(m.id) ? 'online' : 'local'}`}>
                      {ONLINE_TOOL_IDS.has(m.id) ? 'ONLINE' : 'LOCAL'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            <div className="ext-settings clean-box">
              <span className="ext-settings-label">ON OPEN:</span>
              <label>
                <input
                  type="radio"
                  name="startMode"
                  checked={settings.startMode === 'launcher'}
                  onChange={() => void update({ startMode: 'launcher' })}
                />{' '}
                LAUNCHER
              </label>
              <label>
                <input
                  type="radio"
                  name="startMode"
                  checked={settings.startMode === 'default-tool'}
                  disabled={!pinnedId}
                  onChange={() => void update({ startMode: 'default-tool' })}
                />{' '}
                DEFAULT TOOL
              </label>
              <select
                className="pane-module-select"
                aria-label="Default tool"
                value={pinnedId ?? ''}
                onChange={(e) => {
                  const id = e.target.value || null;
                  void update({ defaultToolId: id, startMode: id ? 'default-tool' : 'launcher' });
                  e.target.blur();
                }}
              >
                <option value="">— none —</option>
                {TOOL_MODULES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.shortTitle}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <div className="ext-tool" ref={toolBodyRef}>
            <ActiveTool key={activeModule.id} />
          </div>
        )}
      </main>
    </div>
  );
}
