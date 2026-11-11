import { useState, useEffect, useCallback, useRef } from 'react';
import { TOOL_MODULES, getToolById } from './tools/registry';
import { CommandDeck } from './components/CommandDeck';
import { APP_VERSION } from './version';
import { sound } from './utils/audio';
import { THEMES, applyTheme, loadTheme, nextTheme, saveTheme, type ThemeId } from './utils/theme';
import { PaneActiveContext } from './utils/paneContext';
import './App.css';

interface ParsedHashRoute {
  primaryId: string | null;
  secondaryId: string | null;
}

function parseHashRoute(): ParsedHashRoute {
  if (typeof window === 'undefined') return { primaryId: null, secondaryId: null };
  const raw = window.location.hash.replace(/^#\/?/, '').trim();
  if (!raw) return { primaryId: null, secondaryId: null };

  const [mainPart, queryPart] = raw.split('?');
  const primaryId = getToolById(mainPart) ? mainPart : null;
  let secondaryId: string | null = null;

  if (queryPart) {
    const params = new URLSearchParams(queryPart);
    const splitParam = params.get('split');
    if (splitParam && getToolById(splitParam)) {
      secondaryId = splitParam;
    }
  }
  return { primaryId, secondaryId };
}

function syncUrlHash(primaryId: string | null, secondaryId: string | null): void {
  if (typeof window === 'undefined') return;
  if (!primaryId) {
    window.history.replaceState(null, '', window.location.pathname);
    return;
  }
  const suffix = secondaryId ? `?split=${encodeURIComponent(secondaryId)}` : '';
  window.history.replaceState(null, '', `#/${primaryId}${suffix}`);
}

function pickDefaultSecondaryToolId(primaryId: string | null): string {
  const fallbackOrder = ['subnet-calculator', 'dns-inspector', 'auth-inspector', 'security-headers', 'password-generator'];
  for (const candidate of fallbackOrder) {
    if (candidate !== primaryId && getToolById(candidate)) {
      return candidate;
    }
  }
  return TOOL_MODULES[0].id;
}

export function App() {
  const initialRoute = parseHashRoute();
  const [activeToolId, setActiveToolId] = useState<string | null>(initialRoute.primaryId);
  const [secondaryToolId, setSecondaryToolId] = useState<string | null>(initialRoute.secondaryId);
  const [focusedPane, setFocusedPane] = useState<'primary' | 'secondary'>('primary');
  const [splitRatio, setSplitRatio] = useState<number>(50);
  const [isDraggingDivider, setIsDraggingDivider] = useState<boolean>(false);
  const [isDesktopViewport, setIsDesktopViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );

  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => sound.isEnabled());
  const [theme, setTheme] = useState<ThemeId>(() => loadTheme());
  const [quickIp, setQuickIp] = useState<string | null>(null);

  const splitContainerRef = useRef<HTMLDivElement>(null);
  const paneARef = useRef<HTMLDivElement>(null);
  const paneBRef = useRef<HTMLDivElement>(null);

  const switchFocusedPane = useCallback((targetPane: 'primary' | 'secondary') => {
    setFocusedPane((prev) => {
      if (prev !== targetPane) {
        sound.playClick();
      }
      return targetPane;
    });
    const activeEl = document.activeElement as HTMLElement | null;
    if (activeEl) {
      const inPaneA = paneARef.current?.contains(activeEl);
      const inPaneB = paneBRef.current?.contains(activeEl);
      if ((targetPane === 'primary' && inPaneB) || (targetPane === 'secondary' && inPaneA)) {
        activeEl.blur();
      }
    }
  }, []);

  // Track viewport width to enable Dual-Pane mode strictly on Desktop (>= 1024px)
  useEffect(() => {
    const onResize = () => {
      const desktop = window.innerWidth >= 1024;
      setIsDesktopViewport(desktop);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const isSplitActive = Boolean(activeToolId && secondaryToolId && isDesktopViewport);

  const selectPrimaryTool = useCallback(
    (toolId: string | null) => {
      setActiveToolId(toolId);
      if (!toolId) {
        setSecondaryToolId(null);
        setFocusedPane('primary');
        syncUrlHash(null, null);
      } else {
        syncUrlHash(toolId, secondaryToolId);
      }
    },
    [secondaryToolId]
  );

  const selectToolForActivePane = useCallback(
    (toolId: string) => {
      if (isSplitActive && focusedPane === 'secondary') {
        setSecondaryToolId(toolId);
        syncUrlHash(activeToolId, toolId);
      } else {
        setActiveToolId(toolId);
        syncUrlHash(toolId, secondaryToolId);
      }
    },
    [isSplitActive, focusedPane, activeToolId, secondaryToolId]
  );

  const toggleSplitView = useCallback(() => {
    if (!isDesktopViewport) return;
    sound.playBlip();

    if (!activeToolId) {
      // If triggered from Command Deck, open MOD-01 and MOD-07 side-by-side
      const pId = TOOL_MODULES[0].id;
      const sId = pickDefaultSecondaryToolId(pId);
      setActiveToolId(pId);
      setSecondaryToolId(sId);
      setFocusedPane('secondary');
      setSplitRatio(50);
      syncUrlHash(pId, sId);
      return;
    }

    if (secondaryToolId) {
      // Close secondary pane -> return to single-module view
      setSecondaryToolId(null);
      setFocusedPane('primary');
      syncUrlHash(activeToolId, null);
    } else {
      const nextSecondary = pickDefaultSecondaryToolId(activeToolId);
      setSecondaryToolId(nextSecondary);
      setFocusedPane('secondary');
      setSplitRatio(50);
      syncUrlHash(activeToolId, nextSecondary);
    }
  }, [isDesktopViewport, activeToolId, secondaryToolId]);

  const closePrimaryPane = useCallback(() => {
    sound.playClick();
    if (secondaryToolId) {
      // Promote secondary pane to single active module
      const promoted = secondaryToolId;
      setActiveToolId(promoted);
      setSecondaryToolId(null);
      setFocusedPane('primary');
      syncUrlHash(promoted, null);
    } else {
      selectPrimaryTool(null);
    }
  }, [secondaryToolId, selectPrimaryTool]);

  const closeSecondaryPane = useCallback(() => {
    sound.playClick();
    setSecondaryToolId(null);
    setFocusedPane('primary');
    syncUrlHash(activeToolId, null);
  }, [activeToolId]);

  // Sync browser back/forward hash navigation
  useEffect(() => {
    const onHashChange = () => {
      const parsed = parseHashRoute();
      setActiveToolId(parsed.primaryId);
      setSecondaryToolId(parsed.secondaryId);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Dragging divider logic for resizable 50/50 split
  useEffect(() => {
    if (!isDraggingDivider) return;

    const onMouseMove = (e: MouseEvent) => {
      const container = splitContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) return;
      const relX = e.clientX - rect.left;
      const pct = Math.max(32, Math.min(68, Math.round((relX / rect.width) * 100)));
      setSplitRatio(pct);
    };

    const onMouseUp = () => {
      setIsDraggingDivider(false);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isDraggingDivider]);

  // Fetch lightweight client public IP badge once on boot
  useEffect(() => {
    let active = true;
    fetch('/api/ip')
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (active && json?.ip) {
          setQuickIp(String(json.ip));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Theme: apply + persist on change (cookie with localStorage fallback)
  useEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
  }, [theme]);

  const changeTheme = useCallback(
    (id: ThemeId) => {
      if (id === theme) return;
      sound.playClick();
      setTheme(id);
    },
    [theme]
  );

  const cycleTheme = useCallback(() => {
    sound.playClick();
    setTheme((prev) => nextTheme(prev));
  }, []);

  // Global keyboard shortcuts:
  // - Ctrl+Shift+D -> Toggle Desktop Split-Screen / Dual-Pane Mode
  // - ESC in text input -> blur input (unlocks single-letter shortcuts)
  // - ESC outside text input -> return to Command Deck
  // - [1..9] -> Jump to Module (routes to currently focused pane in Split View)
  // - [S] -> Toggle SFX
  // - [Alt+T] -> Cycle themes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Desktop Split-Screen shortcut: Ctrl+Shift+D
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'd' || e.key === 'D')) {
        if (window.innerWidth >= 1024) {
          e.preventDefault();
          toggleSplitView();
        }
        return;
      }

      const target = e.target as HTMLElement | null;
      const isTextEntry =
        (target?.tagName === 'INPUT' &&
          (target as HTMLInputElement).type !== 'checkbox' &&
          (target as HTMLInputElement).type !== 'range') ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;

      if (e.key === 'Escape') {
        if (isTextEntry && target) {
          e.preventDefault();
          sound.playClick();
          target.blur();
          return;
        }
        if (activeToolId !== null) {
          e.preventDefault();
          sound.playClick();
          selectPrimaryTool(null);
          return;
        }
      }

      // Theme cycle: Alt+T (Option+T on macOS). Guarded: never fires while typing in
      // inputs / textareas / contenteditable. Alt is used because [T] is already a
      // per-module shortcut (PassGen, URL Probe).
      if (!isTextEntry && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyT') {
        e.preventDefault();
        cycleTheme();
        return;
      }

      if (isTextEntry || e.metaKey || e.ctrlKey || e.altKey) return;

      // In Split View, ArrowLeft / ArrowRight (and ArrowUp / ArrowDown when not in a <select>)
      // switches active focus between Pane A and Pane B so [1..9] and single-letter shortcuts
      // immediately target the selected window.
      if (isSplitActive && target?.tagName !== 'SELECT') {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          switchFocusedPane('primary');
          return;
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          switchFocusedPane('secondary');
          return;
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          switchFocusedPane(focusedPane === 'primary' ? 'secondary' : 'primary');
          return;
        }
      }

      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        setSoundEnabled(sound.toggle());
        return;
      }

      // On the Command Deck, [1..N] only SELECTS (handled by CommandDeck; ENTER launches).
      // Inside an open tool, [1..N] switches directly between modules in the focused pane.
      if (activeToolId === null) return;

      const matched = TOOL_MODULES.find((m) => m.shortcut === e.key);
      if (matched) {
        e.preventDefault();
        sound.playBlip();
        selectToolForActivePane(matched.id);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeToolId,
    isSplitActive,
    focusedPane,
    selectPrimaryTool,
    selectToolForActivePane,
    toggleSplitView,
    switchFocusedPane,
    cycleTheme,
  ]);

  const activeModule = getToolById(activeToolId);
  const ActiveToolComponent = activeModule?.Component;

  const secondaryModule = isSplitActive ? getToolById(secondaryToolId) : undefined;
  const SecondaryToolComponent = secondaryModule?.Component;

  const highlightedNavToolId =
    isSplitActive && focusedPane === 'secondary' ? secondaryToolId : activeToolId;

  return (
    <div className="clean-viewport">
      <div className="crt-overlay" aria-hidden="true" />
      <div className="crt-vignette" aria-hidden="true" />

      <div className={`clean-screen-frame ${isSplitActive ? 'clean-screen-frame-split' : ''}`}>
        {/* TOP NAVAL COMMAND BAR */}
        <header className="clean-top-bar">
          <div className="clean-branding">
            <span className="naval-emblem">⚓</span>
            <button
              type="button"
              className="brand-home-btn"
              onClick={() => {
                sound.playClick();
                selectPrimaryTool(null);
              }}
              title="Return to Command Deck [ESC]"
            >
              techtools.subwrite.se
            </button>
            <span className="kernel-tag">
              R136 HMS VÄSTERVIK{' '}
              {activeModule
                ? isSplitActive && secondaryModule
                  ? `/ DUAL CIC [${activeModule.code} || ${secondaryModule.code}]`
                  : `/ ${activeModule.code}: ${activeModule.shortTitle}`
                : '/ CIC DECK'}
            </span>
          </div>

          <div className="top-bar-controls">
            {activeModule && (
              <button
                type="button"
                className="retro-header-btn"
                onClick={() => {
                  sound.playClick();
                  selectPrimaryTool(null);
                }}
                title="Back to Command Deck [ESC]"
              >
                ◄ DECK [ESC]
              </button>
            )}
            {isDesktopViewport && (
              <button
                type="button"
                className={`retro-header-btn split-toggle-btn ${isSplitActive ? 'split-btn-active' : ''}`}
                onClick={toggleSplitView}
                title="Toggle Desktop Side-by-Side Split View [Ctrl+Shift+D]"
              >
                {isSplitActive ? '◫ SPLIT VIEW: ON [Ctrl+Shift+D]' : '◫ SPLIT VIEW [Ctrl+Shift+D]'}
              </button>
            )}
            <a
              href="https://subwrite.se"
              target="_blank"
              rel="noopener noreferrer"
              className="retro-header-btn retro-header-link"
              title="Open SubWrite Typing Challenge"
            >
              ⌨ SUBWRITE.SE ↗
            </a>
            <div className="theme-switcher">
              <span className="theme-switcher-label" aria-hidden="true">
                THEME
              </span>
              <select
                className="theme-switcher-select"
                aria-label="Color theme"
                value={theme}
                title={`Active theme: ${THEMES.find((t) => t.id === theme)?.title ?? theme}`}
                onChange={(e) => {
                  changeTheme(e.target.value as ThemeId);
                  e.target.blur();
                }}
              >
                {THEMES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              <span className="theme-switcher-key" title="Cycle theme: Alt+T" aria-hidden="true">
                [Alt+T]
              </span>
            </div>
            <button
              type="button"
              className="retro-header-btn"
              onClick={() => setSoundEnabled(sound.toggle())}
              title="Toggle Console Audio [S]"
            >
              {soundEnabled ? '🔊 SFX [S]' : '🔇 MUTE [S]'}
            </button>
          </div>
        </header>

        {/* PERSISTENT 9-MODULE SWITCHER BAR (3x3 / 9-column responsive layout) */}
        {activeModule && (
          <nav className="module-switcher-bar clean-box" aria-label="Diagnostic Modules">
            {TOOL_MODULES.map((mod) => {
              const isPrimary = activeToolId === mod.id;
              const isSecondary = isSplitActive && secondaryToolId === mod.id;
              const isCurrentFocusedTarget = highlightedNavToolId === mod.id;
              return (
                <button
                  key={mod.id}
                  type="button"
                  className={`mod-nav-btn ${isCurrentFocusedTarget ? 'active' : ''} ${
                    isSplitActive && (isPrimary || isSecondary) && !isCurrentFocusedTarget ? 'mod-open-other-pane' : ''
                  }`}
                  onClick={() => {
                    sound.playBlip();
                    selectToolForActivePane(mod.id);
                  }}
                  title={
                    isSplitActive
                      ? `Load ${mod.code}: ${mod.title} into active ${focusedPane.toUpperCase()} pane [${mod.shortcut}]`
                      : `Switch to ${mod.code}: ${mod.title} [${mod.shortcut}]`
                  }
                >
                  <span className="mod-key">[{mod.shortcut}]</span> {mod.shortTitle}
                </button>
              );
            })}
          </nav>
        )}

        {/* MAIN VIEWPORT: COMMAND DECK, SINGLE TOOL, OR DESKTOP DUAL-PANE SPLIT */}
        <main className="clean-main-stage">
          {ActiveToolComponent && activeModule ? (
            isSplitActive && SecondaryToolComponent && secondaryModule ? (
              <div
                ref={splitContainerRef}
                className={`dual-pane-stage ${isDraggingDivider ? 'is-resizing' : ''}`}
                style={{
                  gridTemplateColumns: `minmax(0, ${splitRatio}fr) 14px minmax(0, ${100 - splitRatio}fr)`,
                }}
              >
                {/* PANE A (LEFT / PRIMARY) */}
                <PaneActiveContext.Provider value={focusedPane === 'primary'}>
                  <div
                    ref={paneARef}
                    className={`active-tool-shell split-pane-shell ${
                      focusedPane === 'primary' ? 'pane-focused' : 'pane-unfocused'
                    }`}
                    onMouseDownCapture={() => setFocusedPane('primary')}
                    onFocusCapture={() => setFocusedPane('primary')}
                  >
                    <div className="active-tool-banner split-pane-banner clean-box">
                      <div className="pane-banner-left">
                        <span className="tool-banner-code">
                          PANE A [◄] {focusedPane === 'primary' ? '● ACTIVE WINDOW' : '○ PRESS [◄] TO FOCUS'} //{' '}
                          {activeModule.code}
                        </span>
                        <h2 className="tool-banner-title">{activeModule.title}</h2>
                      </div>
                      <div className="pane-banner-controls">
                        <button
                          type="button"
                          className={`navy-btn btn-xs pane-focus-btn ${
                            focusedPane === 'primary' ? 'btn-active' : ''
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            switchFocusedPane('primary');
                          }}
                          title="Activate Pane A (Left Window) [◄ Left Arrow]"
                        >
                          {focusedPane === 'primary' ? '● ACTIVE [◄]' : '◄ FOCUS [◄]'}
                        </button>
                        <label className="sr-only" htmlFor="pane-a-select">
                          Select Module for Pane A
                        </label>
                        <select
                          id="pane-a-select"
                          className="pane-module-select"
                          value={activeModule.id}
                          onChange={(e) => {
                            sound.playBlip();
                            const nextId = e.target.value;
                            setActiveToolId(nextId);
                            syncUrlHash(nextId, secondaryToolId);
                          }}
                        >
                          {TOOL_MODULES.map((m) => (
                            <option key={m.id} value={m.id}>
                              [{m.shortcut}] {m.code}: {m.shortTitle}
                            </option>
                          ))}
                        </select>
                        <span className="module-badge">{activeModule.badge}</span>
                        <button
                          type="button"
                          className="pane-close-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            closePrimaryPane();
                          }}
                          title="Close Pane A and return to single-module view"
                          aria-label="Close Pane A"
                        >
                          [X]
                        </button>
                      </div>
                    </div>
                    <ActiveToolComponent key={`pane-a-${activeModule.id}`} />
                  </div>
                </PaneActiveContext.Provider>

                {/* TERMINAL DIVIDER HANDLE (50/50 RESET ON DOUBLE-CLICK, DRAGGABLE, CLICK TO SWITCH PANE) */}
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize split screen panes (double-click to reset 50/50)"
                  title="Drag to resize split panes • Double-click to reset 50/50"
                  className="split-pane-divider"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setIsDraggingDivider(true);
                  }}
                  onDoubleClick={() => {
                    sound.playClick();
                    setSplitRatio(50);
                  }}
                >
                  <button
                    type="button"
                    className="divider-switch-btn"
                    title={`Switch active window to ${focusedPane === 'primary' ? 'Pane B [►]' : 'Pane A [◄]'}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      switchFocusedPane(focusedPane === 'primary' ? 'secondary' : 'primary');
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    {focusedPane === 'primary' ? '►' : '◄'}
                  </button>
                  <span className="divider-grip">║</span>
                </div>

                {/* PANE B (RIGHT / SECONDARY) */}
                <PaneActiveContext.Provider value={focusedPane === 'secondary'}>
                  <div
                    ref={paneBRef}
                    className={`active-tool-shell split-pane-shell ${
                      focusedPane === 'secondary' ? 'pane-focused' : 'pane-unfocused'
                    }`}
                    onMouseDownCapture={() => setFocusedPane('secondary')}
                    onFocusCapture={() => setFocusedPane('secondary')}
                  >
                    <div className="active-tool-banner split-pane-banner clean-box">
                      <div className="pane-banner-left">
                        <span className="tool-banner-code">
                          PANE B [►] {focusedPane === 'secondary' ? '● ACTIVE WINDOW' : '○ PRESS [►] TO FOCUS'} //{' '}
                          {secondaryModule.code}
                        </span>
                        <h2 className="tool-banner-title">{secondaryModule.title}</h2>
                      </div>
                      <div className="pane-banner-controls">
                        <button
                          type="button"
                          className={`navy-btn btn-xs pane-focus-btn ${
                            focusedPane === 'secondary' ? 'btn-active' : ''
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            switchFocusedPane('secondary');
                          }}
                          title="Activate Pane B (Right Window) [► Right Arrow]"
                        >
                          {focusedPane === 'secondary' ? '● ACTIVE [►]' : 'FOCUS [►] ►'}
                        </button>
                        <label className="sr-only" htmlFor="pane-b-select">
                          Select Module for Pane B
                        </label>
                        <select
                          id="pane-b-select"
                          className="pane-module-select"
                          value={secondaryModule.id}
                          onChange={(e) => {
                            sound.playBlip();
                            const nextId = e.target.value;
                            setSecondaryToolId(nextId);
                            syncUrlHash(activeToolId, nextId);
                          }}
                        >
                          {TOOL_MODULES.map((m) => (
                            <option key={m.id} value={m.id}>
                              [{m.shortcut}] {m.code}: {m.shortTitle}
                            </option>
                          ))}
                        </select>
                        <span className="module-badge">{secondaryModule.badge}</span>
                        <button
                          type="button"
                          className="pane-close-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            closeSecondaryPane();
                          }}
                          title="Close Pane B and return to single-module view"
                          aria-label="Close Pane B"
                        >
                          [X]
                        </button>
                      </div>
                    </div>
                    <SecondaryToolComponent key={`pane-b-${secondaryModule.id}`} />
                  </div>
                </PaneActiveContext.Provider>
              </div>
            ) : (
              <PaneActiveContext.Provider value={true}>
                <div className="active-tool-shell">
                  <div className="active-tool-banner clean-box">
                    <div>
                      <span className="tool-banner-code">{activeModule.code}</span>
                      <h2 className="tool-banner-title">{activeModule.title}</h2>
                    </div>
                    <div className="pane-banner-controls">
                      <span className="module-badge">{activeModule.badge}</span>
                      {isDesktopViewport && (
                        <button
                          type="button"
                          className="navy-btn btn-xs"
                          onClick={toggleSplitView}
                          title="Launch a second module alongside this one [Ctrl+Shift+D]"
                        >
                          ◫ + SPLIT PANE [Ctrl+Shift+D]
                        </button>
                      )}
                    </div>
                  </div>
                  <ActiveToolComponent key={`single-${activeModule.id}`} />
                </div>
              </PaneActiveContext.Provider>
            )
          ) : (
            <CommandDeck
              modules={TOOL_MODULES}
              onSelectTool={(id) => selectPrimaryTool(id)}
              quickIp={quickIp}
            />
          )}
        </main>

        {/* FOOTER CREDITS */}
        <footer className="clean-footer clean-box">
          <div className="footer-left">
            <span>[ESC] DECK</span> | <span>[1–{TOOL_MODULES.length}] MODULES</span> |{' '}
            <span>[CTRL+SHIFT+D] SPLIT</span> |{' '}
            {isSplitActive && (
              <>
                <span className="text-cyan">[◄/►] SWITCH PANE</span> |{' '}
              </>
            )}
            <span>[TAB] SELECT + [C] COPY</span> | <span>[S] AUDIO</span> |{' '}
            <span className="text-gold">{APP_VERSION}</span>
          </div>
          <div className="footer-right">
            <span className="footer-credit-item">
              Provided by{' '}
              <a
                href="https://github.com/sgt-nylle/techtools"
                target="_blank"
                rel="noopener noreferrer"
                className="provider-link"
              >
                Sgt.Moon
              </a>
            </span>
            <span className="footer-sep" aria-hidden="true">
              •
            </span>
            <span className="footer-credit-item">
              <a
                href="https://subwrite.se"
                target="_blank"
                rel="noopener noreferrer"
                className="provider-link"
              >
                subwrite.se
              </a>
            </span>
            <span className="footer-sep" aria-hidden="true">
              •
            </span>
            <span className="footer-credit-item">
              contact:{' '}
              <a href="mailto:sysop@subwrite.se" className="provider-link">
                sysop@subwrite.se
              </a>
            </span>
          </div>
        </footer>

        {/* ABOUT / CONCEPT FOOTER (Command Deck starter page only) */}
        {!activeModule && (
          <footer className="clean-box about-footer" aria-label="About TechTools">
            <h2 className="about-title">⚓ ABOUT TECHTOOLS</h2>
            <p>
              Built for sysadmins, developers, and support engineers who need fast answers without the bloat,{' '}
              <a
                href="https://techtools.subwrite.se"
                className="provider-link"
                target="_blank"
                rel="noopener noreferrer"
              >
                techtools.subwrite.se
              </a>{' '}
              is a free 9-module toolbox of everyday IT troubleshooting utilities wrapped in a navy retro systems
              aesthetic. Constructed as a sister ship to{' '}
              <a href="https://subwrite.se" className="provider-link" target="_blank" rel="noopener noreferrer">
                subwrite.se
              </a>
              , it features a keyboard-first workflow, optional desktop dual-pane split-screen mode (
              <code>Ctrl+Shift+D</code>), one-key copying of every result, and a modular framework ready to deploy new
              tools on the fly.
            </p>
            <ul className="about-list">
              <li>
                <strong>Password &amp; Token Generator</strong> — secure passwords (with <code>64BIT (16)</code> &amp;{' '}
                <code>NO CONFUSE</code> enabled by default), multi-branch passphrases, UUIDs, hex keys and API tokens{' '}
                <strong>generated 100% locally in your browser and never on the server</strong>.
              </li>
              <li>
                <strong>DNS &amp; WHOIS Lookup</strong> — A, AAAA, MX, NS, TXT, SOA, CAA and PTR records, DNSSEC zone
                key (<code>DNSKEY</code> &amp; <code>DS</code> chain of trust) inspection, SPF and DMARC checks, and
                domain registration info, queried via Google, Cloudflare or a custom DNS server.
              </li>
              <li>
                <strong>What&apos;s My IP</strong> — your public IP address with reverse DNS, ASN, BGP prefix and IP range
                owner details.
              </li>
              <li>
                <strong>Certificate &amp; CSR Analyzer</strong> — decode X.509 certificates, CSRs and public keys: subject,
                SAN names, expiry, trust status and full chain export. Private keys are never processed.
              </li>
              <li>
                <strong>Email Header Analyzer</strong> — trace message hops and delays and audit SPF, DKIM, DMARC and
                ARC results.
              </li>
              <li>
                <strong>URL Tester (External Endpoint &amp; TLS Probe)</strong> — test public corporate URLs, ICMP sonar
                ping, and custom TCP ports (default 443) from outside internal firewalls, with HTTP response telemetry
                and live SSL/TLS certificate inspection.
              </li>
              <li>
                <strong>Subnet &amp; Supernetting Calculator (IPv4 / IPv6)</strong> — 100% client-side CIDR network
                calculator with netmask, wildcard, usable host range, bitwise binary representation, reverse DNS PTR
                generator (<code>in-addr.arpa</code> / <code>ip6.arpa</code>), and interactive subnet carving.
              </li>
              <li>
                <strong>JWT, OIDC &amp; SAML Auth Inspector</strong> — 100% client-side token decoder with human-readable{' '}
                <code>iat</code>/<code>nbf</code>/<code>exp</code> status badges, Microsoft Entra ID claim highlighting (
                <code>upn</code>, <code>oid</code>, <code>tid</code>, <code>roles</code>, <code>groups</code>,{' '}
                <code>wids</code>), and SAML 2.0 XML formatting.
              </li>
              <li>
                <strong>HTTP Security Headers &amp; CSP Evaluator</strong> — audit and score target URL security headers
                (<code>Strict-Transport-Security</code>, <code>Content-Security-Policy</code> with{' '}
                <code>unsafe-inline</code> / <code>unsafe-eval</code> / wildcard warnings, <code>X-Frame-Options</code>,{' '}
                <code>X-Content-Type-Options: nosniff</code>, <code>Referrer-Policy</code>, and{' '}
                <code>Permissions-Policy</code>).
              </li>
            </ul>
            <p className="dim-note">
              Open source on{' '}
              <a
                href="https://github.com/sgt-nylle/techtools"
                className="provider-link"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub
              </a>
              . No accounts, no tracking of the data you analyze. Contact:{' '}
              <a href="mailto:sysop@subwrite.se" className="provider-link">
                sysop@subwrite.se
              </a>
            </p>
          </footer>
        )}
      </div>
    </div>
  );
}

export default App;
