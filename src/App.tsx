import { useState, useEffect, useCallback } from 'react';
import { TOOL_MODULES, getToolById } from './tools/registry';
import { CommandDeck } from './components/CommandDeck';
import { APP_VERSION } from './version';
import { sound } from './utils/audio';
import './App.css';

function parseHashToolId(): string | null {
  if (typeof window === 'undefined') return null;
  const raw = window.location.hash.replace(/^#\/?/, '').trim();
  return getToolById(raw) ? raw : null;
}

export function App() {
  const [activeToolId, setActiveToolId] = useState<string | null>(() => parseHashToolId());
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => sound.isEnabled());
  const [quickIp, setQuickIp] = useState<string | null>(null);

  const selectTool = useCallback((toolId: string | null) => {
    setActiveToolId(toolId);
    if (typeof window !== 'undefined') {
      if (toolId) {
        window.history.replaceState(null, '', `#/${toolId}`);
      } else {
        window.history.replaceState(null, '', window.location.pathname);
      }
    }
  }, []);

  // Sync browser back/forward hash navigation
  useEffect(() => {
    const onHashChange = () => {
      setActiveToolId(parseHashToolId());
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

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

  // Global keyboard shortcuts:
  // - ESC in text input -> blur input (unlocks single-letter shortcuts)
  // - ESC outside text input -> return to Command Deck
  // - [1..9] -> Jump to Module
  // - [S] -> Toggle SFX
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
          selectTool(null);
          return;
        }
      }

      if (isTextEntry || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        setSoundEnabled(sound.toggle());
        return;
      }

      // On the Command Deck, [1..N] only SELECTS (handled by CommandDeck; ENTER launches).
      // Inside an open tool, [1..N] switches directly between modules.
      if (activeToolId === null) return;

      const matched = TOOL_MODULES.find((m) => m.shortcut === e.key);
      if (matched) {
        e.preventDefault();
        sound.playBlip();
        selectTool(matched.id);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeToolId, selectTool]);

  const activeModule = getToolById(activeToolId);
  const ActiveToolComponent = activeModule?.Component;

  return (
    <div className="c64-viewport">
      <div className="crt-overlay" aria-hidden="true" />
      <div className="crt-vignette" aria-hidden="true" />

      <div className="c64-screen-frame">
        {/* TOP NAVAL COMMAND BAR */}
        <header className="c64-top-bar">
          <div className="c64-branding">
            <span className="naval-emblem">⚓</span>
            <button
              type="button"
              className="brand-home-btn"
              onClick={() => {
                sound.playClick();
                selectTool(null);
              }}
              title="Return to Command Deck [ESC]"
            >
              techtools.subwrite.se
            </button>
            <span className="kernel-tag">
              R136 HMS VÄSTERVIK {activeModule ? `/ ${activeModule.code}: ${activeModule.shortTitle}` : '/ CIC DECK'}
            </span>
          </div>

          <div className="top-bar-controls">
            {activeModule && (
              <button
                type="button"
                className="retro-header-btn"
                onClick={() => {
                  sound.playClick();
                  selectTool(null);
                }}
                title="Back to Command Deck [ESC]"
              >
                ◄ DECK [ESC]
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

        {/* SUB-ROW MODULE SWITCHER (Shown when a module is open, without redundant DECK button) */}
        {activeModule && (
          <nav className="module-switcher-bar c64-box" aria-label="Diagnostic Modules">
            {TOOL_MODULES.map((mod) => (
              <button
                key={mod.id}
                type="button"
                className={`mod-nav-btn ${activeToolId === mod.id ? 'active' : ''}`}
                onClick={() => {
                  sound.playBlip();
                  selectTool(mod.id);
                }}
              >
                <span className="mod-key">[{mod.shortcut}]</span> {mod.shortTitle}
              </button>
            ))}
          </nav>
        )}

        {/* MAIN VIEWPORT: COMMAND DECK OR ACTIVE TOOL */}
        <main className="c64-main-stage">
          {ActiveToolComponent && activeModule ? (
            <div className="active-tool-shell">
              <div className="active-tool-banner c64-box">
                <div>
                  <span className="tool-banner-code">{activeModule.code}</span>
                  <h2 className="tool-banner-title">{activeModule.title}</h2>
                </div>
                <span className="module-badge">{activeModule.badge}</span>
              </div>
              <ActiveToolComponent />
            </div>
          ) : (
            <CommandDeck
              modules={TOOL_MODULES}
              onSelectTool={(id) => selectTool(id)}
              quickIp={quickIp}
            />
          )}
        </main>

        {/* FOOTER CREDITS */}
        <footer className="c64-footer c64-box">
          <div className="footer-left">
            <span>[ESC] DECK</span> | <span>[1–{TOOL_MODULES.length}] MODULES</span> |{' '}
            <span>[TAB] SELECT + [C] COPY</span> | <span>[S] AUDIO</span> |{' '}
            <span className="text-gold">{APP_VERSION}</span>
          </div>
          <div className="footer-right">
            Provided by{' '}
            <a
              href="https://github.com/sgt-nylle/techtools"
              target="_blank"
              rel="noopener noreferrer"
              className="provider-link"
            >
              Sgt.Moon
            </a>{' '}
            •{' '}
            <a
              href="https://subwrite.se"
              target="_blank"
              rel="noopener noreferrer"
              className="provider-link"
            >
              subwrite.se
            </a>
          </div>
        </footer>

        {/* ABOUT / CONCEPT FOOTER (Command Deck starter page only) */}
        {!activeModule && (
          <footer className="c64-box about-footer" aria-label="About TechTools">
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
              is a free toolbox of everyday IT troubleshooting utilities wrapped in a navy retro systems aesthetic.
              Constructed as a sister ship to{' '}
              <a href="https://subwrite.se" className="provider-link" target="_blank" rel="noopener noreferrer">
                subwrite.se
              </a>
              , it features a keyboard-first workflow, one-key copying of every result, and a modular framework ready
              to deploy new tools on the fly.
            </p>
            <ul className="about-list">
              <li>
                <strong>Password &amp; Token Generator</strong> — secure passwords, passphrases, UUIDs, hex keys and API
                tokens generated locally in your browser.
              </li>
              <li>
                <strong>DNS &amp; WHOIS Lookup</strong> — A, AAAA, MX, NS, TXT, SOA, CAA and PTR records, SPF and DMARC
                checks, and domain registration info, queried via Google, Cloudflare or a custom DNS server.
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
              . No accounts, no tracking of the data you analyze.
            </p>
          </footer>
        )}
      </div>
    </div>
  );
}

export default App;
