import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CopyableIntelSection } from '../components/CopyableIntelSection';
import { sound } from '../utils/audio';
import { useIsPaneActive } from '../utils/paneContext';

type LogDir = 'I' | 'C' | 'S' | 'TLS' | 'OK' | 'WARN' | 'ERR';

interface LogLine {
  t: number;
  dir: LogDir;
  host: string | null;
  text: string;
}

interface CheckRow {
  id: string;
  label: string;
  weight: number;
  status: 'pass' | 'warn' | 'fail' | 'skip';
  detail?: string;
}

interface CertInfo {
  subject: string;
  issuer: string;
  serialNumber: string;
  fingerprint256: string;
  validFrom: string;
  validTo: string;
  daysRemaining: number;
  isExpired: boolean;
  isNotYetValid: boolean;
  hostnameMatch: boolean;
  matchedIdentity: string | null;
  sans: string[];
  isSelfSigned: boolean;
  keyStrength: { label: string; ok: boolean | null };
  trust: { trusted: boolean; status: string; details?: string };
  wireChainCount: number;
  chainSummary: Array<{ depth: number; subject: string; issuer: string; validTo: string; isSelfSigned: boolean }>;
}

interface HostResult {
  host: string;
  ip: string;
  ipVersion: string;
  priority: number | null;
  port: number;
  tcp: { ok: boolean; ms: number | null; error: string | null };
  banner: string | null;
  ehloCapabilities: string[];
  ehloTlsCapabilities: string[];
  starttlsAdvertised: boolean | null;
  tls: {
    protocol: string;
    cipher: { name: string; standardName: string; version: string } | null;
    keyExchange: string | null;
    handshakeMs: number;
    authorizationError: string | null;
  } | null;
  certificate: CertInfo | null;
  error: string | null;
  checks: CheckRow[];
  score: number | null;
  grade: string;
  durationMs: number;
}

interface PolicyInfo {
  mtaSts: {
    record: string | null;
    policy: { version: string | null; mode: string | null; maxAge: number | null; mx: string[] } | null;
    fetch: { ok: boolean; status?: number | null; error?: string | null } | null;
    mxCoverage: Array<{ host: string; covered: boolean }>;
  } | null;
  tlsRpt: { record: string | null; rua: string | null } | null;
  dane: Array<{ host: string; name: string; records: string[]; dnssecAd: boolean }>;
}

interface Summary {
  target: string;
  port: number;
  mode: 'MX' | 'DIRECT_HOST';
  mx: Array<{ priority: number; exchange: string }>;
  nullMx: boolean;
  implicitMx: boolean;
  hosts: HostResult[];
  skippedHosts: Array<{ host: string; reason: string }>;
  policy: PolicyInfo | null;
  overall: { score: number | null; grade: string; basis: string } | null;
  egressBlocked: boolean;
  durationMs: number;
}

const PORTS: Array<{ port: number; label: string; hint: string }> = [
  { port: 25, label: '25 MX', hint: 'Inbound MX delivery (STARTTLS)' },
  { port: 587, label: '587 SUBMIT', hint: 'Client submission (STARTTLS)' },
  { port: 465, label: '465 SMTPS', hint: 'Implicit TLS' },
];

const DIR_LABEL: Record<LogDir, string> = { I: '···', C: 'C:', S: 'S:', TLS: 'TLS', OK: ' ✓ ', WARN: ' ⚠ ', ERR: ' ✕ ' };

function gradeClass(grade: string | undefined): string {
  if (!grade) return '';
  if (grade === 'N/A') return 'mtls-grade-na';
  if (grade.startsWith('A')) return 'mtls-grade-a';
  if (grade === 'B' || grade === 'C') return 'mtls-grade-c';
  return 'mtls-grade-f';
}

function shortDn(dn: string | undefined): string {
  if (!dn) return '—';
  const cn = dn.match(/CN=([^\n,]+)/);
  const o = dn.match(/O=([^\n,]+)/);
  return [cn?.[1], o && o[1] !== cn?.[1] ? o[1] : null].filter(Boolean).join(' • ') || dn.replace(/\n/g, ', ');
}

function formatLogLine(l: LogLine): string {
  return `[${(l.t / 1000).toFixed(3).padStart(7, ' ')}] ${DIR_LABEL[l.dir].padEnd(3, ' ')} ${l.text}`;
}

export const MailTlsTool: React.FC = () => {
  const isPaneActive = useIsPaneActive();
  const [target, setTarget] = useState<string>('');
  const [port, setPort] = useState<number>(25);
  const [direct, setDirect] = useState<boolean>(false);
  const [running, setRunning] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [hosts, setHosts] = useState<HostResult[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [copiedTranscript, setCopiedTranscript] = useState<boolean>(false);
  const [followTail, setFollowTail] = useState<boolean>(true);

  const inputRef = useRef<HTMLInputElement>(null);
  const termRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll the live terminal unless the operator scrolled up to read.
  useEffect(() => {
    const el = termRef.current;
    if (el && followTail) el.scrollTop = el.scrollHeight;
  }, [lines, followTail]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const runTest = useCallback(async () => {
    const t = target.trim();
    if (!t) {
      setError('Enter a mail domain, e-mail address, or mail server host.');
      sound.playError();
      inputRef.current?.focus();
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    setError(null);
    setLines([]);
    setHosts([]);
    setSummary(null);
    setFollowTail(true);
    sound.playRadarPing();

    const qs = new URLSearchParams({ domain: t, port: String(port) });
    if (direct) qs.set('direct', '1');

    try {
      const res = await fetch(`/api/mailtls?${qs.toString()}`, { signal: ctrl.signal, headers: { Accept: 'text/event-stream' } });
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        setError((json as { error?: string }).error || `Mail TLS probe failed (HTTP ${res.status}).`);
        sound.playError();
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let pendingLines: LogLine[] = [];
      let flushTimer: number | null = null;
      const flush = () => {
        flushTimer = null;
        if (!pendingLines.length) return;
        const batch = pendingLines;
        pendingLines = [];
        setLines((prev) => [...prev, ...batch]);
      };

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const evt = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const dataLine = evt.split('\n').find((l) => l.startsWith('data: '));
          if (!dataLine) continue;
          let msg: { type: string } & Record<string, unknown>;
          try {
            msg = JSON.parse(dataLine.slice(6));
          } catch {
            continue;
          }
          if (msg.type === 'log') {
            pendingLines.push(msg as unknown as LogLine);
            if (flushTimer === null) flushTimer = window.setTimeout(flush, 40);
          } else if (msg.type === 'host-result') {
            flush();
            setHosts((prev) => [...prev, msg.host as HostResult]);
          } else if (msg.type === 'summary') {
            flush();
            const sum = msg as unknown as Summary;
            setSummary(sum);
            setHosts(sum.hosts);
          }
        }
      }
      if (flushTimer !== null) window.clearTimeout(flushTimer);
      flush();
      sound.playBlip();
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setLines((prev) => [...prev, { t: prev.length ? prev[prev.length - 1].t : 0, dir: 'WARN', host: null, text: 'Probe aborted by operator.' }]);
      } else {
        setError('Lost connection to the mail TLS probe stream.');
        sound.playError();
      }
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setRunning(false);
    }
  }, [target, port, direct]);

  const abortTest = useCallback(() => {
    if (abortRef.current) {
      sound.playClick();
      abortRef.current.abort();
    }
  }, []);

  const transcriptText = useMemo(() => lines.map(formatLogLine).join('\n'), [lines]);

  const copyTranscript = useCallback(async () => {
    if (!transcriptText) return;
    try {
      await navigator.clipboard.writeText(transcriptText);
      sound.playCopy();
      setCopiedTranscript(true);
      window.setTimeout(() => setCopiedTranscript(false), 1600);
    } catch {
      sound.playError();
    }
  }, [transcriptText]);

  const reportText = useMemo(() => {
    if (!summary) return '';
    const out = [
      `=== MAIL TLS REPORT — ${summary.target} (port ${summary.port}, ${summary.mode === 'MX' ? 'MX lookup' : 'direct host'}) ===`,
      `Overall: ${summary.overall ? `${summary.overall.grade} (${summary.overall.score == null ? summary.overall.basis : `${summary.overall.score}/100, ${summary.overall.basis}`})` : 'n/a'}`,
    ];
    if (summary.mx.length) out.push(`MX: ${summary.mx.map((m) => `${m.priority} ${m.exchange}`).join(', ')}`);
    if (summary.egressBlocked) out.push('NOTE: outbound TCP/25 appears blocked at the probe network — results inconclusive.');
    summary.hosts.forEach((h) => {
      out.push('', `--- ${h.host} [${h.ip}] — ${h.grade}${h.score == null ? '' : ` (${h.score}/100)`}`);
      h.checks.filter((c) => c.status !== 'skip').forEach((c) => out.push(`  [${c.status.toUpperCase().padEnd(4)}] ${c.label}${c.detail ? ` — ${c.detail}` : ''}`));
      if (h.tls) out.push(`  TLS: ${h.tls.protocol} • ${h.tls.cipher?.standardName || h.tls.cipher?.name || '?'}${h.tls.keyExchange ? ` • ${h.tls.keyExchange}` : ''}`);
      if (h.certificate) {
        out.push(`  Cert: ${shortDn(h.certificate.subject)} ← ${shortDn(h.certificate.issuer)} • expires ${h.certificate.validTo} (${h.certificate.daysRemaining} d)`);
        out.push(`  SHA-256: ${h.certificate.fingerprint256}`);
      }
      if (h.error) out.push(`  Error: ${h.error}`);
    });
    const p = summary.policy;
    if (p) {
      out.push('', '--- DOMAIN TRANSPORT POLICY');
      out.push(`  MTA-STS: ${p.mtaSts?.record ? `${p.mtaSts.policy ? `mode=${p.mtaSts.policy.mode}` : 'policy fetch failed'}` : 'not published'}`);
      out.push(`  TLS-RPT: ${p.tlsRpt?.record || 'not published'}`);
      p.dane.forEach((d) => out.push(`  DANE ${d.name}: ${d.records.length ? `${d.records.length} TLSA${d.dnssecAd ? ' (DNSSEC)' : ''}` : 'none'}`));
    }
    return out.join('\n');
  }, [summary]);

  const copyReport = useCallback(async () => {
    if (!reportText) return;
    try {
      await navigator.clipboard.writeText(reportText);
      sound.playCopy();
    } catch {
      sound.playError();
    }
  }, [reportText]);

  // Keyboard shortcuts scoped to the active pane
  useEffect(() => {
    if (!isPaneActive) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const typing =
        (el?.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'checkbox' && (el as HTMLInputElement).type !== 'radio') ||
        el?.tagName === 'TEXTAREA' ||
        el?.isContentEditable;
      if (typing) return;
      const k = e.key.toLowerCase();
      if (k === 'q' || k === '/') {
        e.preventDefault();
        sound.playClick();
        inputRef.current?.focus();
        inputRef.current?.select();
      } else if (k === 'r') {
        e.preventDefault();
        if (!running) void runTest();
      } else if (k === 'a') {
        e.preventDefault();
        abortTest();
      } else if (k === 'p') {
        e.preventDefault();
        if (!running) {
          sound.playClick();
          setPort((p) => PORTS[(PORTS.findIndex((x) => x.port === p) + 1) % PORTS.length].port);
        }
      } else if (k === 'd') {
        e.preventDefault();
        if (!running) {
          sound.playClick();
          setDirect((v) => !v);
        }
      } else if (k === 't') {
        e.preventDefault();
        void copyTranscript();
      } else if (k === 'c' && reportText) {
        e.preventDefault();
        void copyReport();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPaneActive, running, runTest, abortTest, copyTranscript, copyReport, reportText]);

  const overall = summary?.overall ?? null;
  const policy = summary?.policy ?? null;

  return (
    <div className="tool-panel mail-tls-panel">
      {/* QUERY BAR */}
      <form
        className="query-bar clean-box"
        onSubmit={(e) => {
          e.preventDefault();
          if (!running) void runTest();
        }}
      >
        <div className="query-input-group">
          <span className="prompt-chevron" title="Press [Q] to focus input">
            MAIL [Q]&gt;
          </span>
          <input
            ref={inputRef}
            type="text"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={direct ? 'Mail server host or IP (e.g. smtp.gmail.com)' : 'Domain or e-mail address (e.g. subwrite.se, user@company.com) — ESC unlocks shortcuts'}
            className="navy-input"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          {running ? (
            <button type="button" className="navy-btn btn-danger" onClick={abortTest}>
              ■ ABORT [A]
            </button>
          ) : (
            <button type="submit" className="navy-btn btn-primary">
              ► RUN TLS TEST [R]
            </button>
          )}
        </div>
        <div className="mtls-options">
          <span className="tele-lbl">PORT [P]:</span>
          {PORTS.map((p) => (
            <button
              key={p.port}
              type="button"
              disabled={running}
              title={p.hint}
              className={`navy-btn btn-xs ${port === p.port ? 'btn-active' : ''}`}
              onClick={() => {
                sound.playClick();
                setPort(p.port);
              }}
            >
              {p.label}
            </button>
          ))}
          <label className="mtls-direct-toggle" title="Skip the MX lookup and connect straight to the host you enter">
            <input type="checkbox" checked={direct} disabled={running} onChange={(e) => setDirect(e.target.checked)} /> DIRECT HOST [D]
          </label>
          <span className="dim-note mtls-no-mail-note">No mail is sent — the probe stops after EHLO over TLS and QUITs.</span>
        </div>
      </form>

      {error && <div className="alert-banner status-err clean-box">⚠ {error}</div>}

      {summary?.egressBlocked && (
        <div className="alert-banner status-warn clean-box">
          ⚠ Every MX timed out on TCP/25. Outbound SMTP port 25 appears to be blocked at the TechTools probe network (a
          common hosting anti-spam default), so these results are inconclusive — not necessarily a fault on{' '}
          <strong>{summary.target}</strong>. Try port 587/465 with DIRECT HOST.
        </div>
      )}

      {/* VERDICT + MX OVERVIEW */}
      {(summary || hosts.length > 0) && (
        <div className="mtls-overview">
          <div className={`mtls-verdict clean-box ${gradeClass(overall?.grade)}`}>
            <span className="tele-lbl">OVERALL TLS CONFIDENCE</span>
            <span className="mtls-grade">{overall ? overall.grade : running ? '…' : '—'}</span>
            <div className="mtls-scorebar" aria-hidden="true">
              <i style={{ width: `${overall?.score ?? 0}%` }} />
            </div>
            <span className="mtls-score-text">
              {overall ? (overall.score == null ? overall.basis : `${overall.score}/100 • ${overall.basis}`) : running ? 'probing…' : summary?.nullMx ? 'NULL MX — accepts no mail' : 'no host tested'}
            </span>
          </div>
          <div className="mtls-mx-table-wrap clean-box">
            <table className="headers-table mtls-mx-table">
              <thead>
                <tr>
                  <th>PRI</th>
                  <th>MAIL HOST</th>
                  <th>TCP</th>
                  <th>STARTTLS</th>
                  <th>TLS</th>
                  <th>CERT</th>
                  <th>GRADE</th>
                </tr>
              </thead>
              <tbody>
                {hosts.map((h) => (
                  <tr key={`${h.host}-${h.ip}`}>
                    <td>{h.priority ?? '—'}</td>
                    <td>
                      <code className="text-cyan">{h.host}</code>
                      <div className="dim-note">{h.ip}</div>
                    </td>
                    <td className={h.tcp.ok ? 'status-ok' : 'status-err'}>{h.tcp.ok ? `${h.tcp.ms} ms` : 'FAIL'}</td>
                    <td className={h.starttlsAdvertised === null ? '' : h.starttlsAdvertised ? 'status-ok' : 'status-err'}>
                      {h.port === 465 ? 'IMPLICIT' : h.starttlsAdvertised ? 'YES' : h.banner ? 'NO' : '—'}
                    </td>
                    <td className={h.tls ? (/TLSv1\.[23]/.test(h.tls.protocol) ? 'status-ok' : 'status-warn') : ''}>{h.tls?.protocol || '—'}</td>
                    <td
                      className={
                        !h.certificate ? '' : h.certificate.trust.trusted && h.certificate.hostnameMatch ? 'status-ok' : h.certificate.isSelfSigned ? 'status-err' : 'status-warn'
                      }
                    >
                      {!h.certificate
                        ? h.tls
                          ? 'NONE'
                          : '—'
                        : h.certificate.isSelfSigned
                          ? 'SELF-SIGNED'
                          : h.certificate.trust.trusted
                            ? h.certificate.hostnameMatch
                              ? 'TRUSTED'
                              : 'NAME MISMATCH'
                            : h.certificate.trust.status}
                    </td>
                    <td>
                      <span className={`mtls-grade-pill ${gradeClass(h.grade)}`}>{h.grade}</span>
                    </td>
                  </tr>
                ))}
                {running && (
                  <tr>
                    <td colSpan={7} className="dim-note">
                      ◎ probing…
                    </td>
                  </tr>
                )}
                {summary?.skippedHosts.map((s) => (
                  <tr key={`skip-${s.host}`}>
                    <td>—</td>
                    <td>
                      <code>{s.host}</code>
                    </td>
                    <td colSpan={5} className="dim-note">
                      skipped: {s.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* LIVE NEGOTIATION TERMINAL */}
      <div className="mtls-terminal-box clean-box">
        <div className="mtls-terminal-hdr">
          <span className="tele-lbl">
            ► LIVE SMTP / TLS NEGOTIATION FEED {running && <span className="mtls-rec">● REC</span>}
          </span>
          <div className="section-header-right">
            {!followTail && lines.length > 0 && (
              <button type="button" className="navy-btn btn-xs" onClick={() => setFollowTail(true)}>
                ▼ FOLLOW
              </button>
            )}
            <button
              type="button"
              className={`navy-btn btn-xs ${copiedTranscript ? 'btn-copied' : ''}`}
              disabled={!lines.length}
              onClick={() => void copyTranscript()}
            >
              {copiedTranscript ? '✓ COPIED' : '📋 TRANSCRIPT [T]'}
            </button>
          </div>
        </div>
        <div
          ref={termRef}
          className="mtls-terminal"
          role="log"
          aria-live="polite"
          tabIndex={0}
          onScroll={(e) => {
            const el = e.currentTarget;
            const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
            if (atBottom !== followTail) setFollowTail(atBottom);
          }}
        >
          {lines.length === 0 && !running && (
            <div className="mtls-term-idle">
              <span className="mtls-dir">···</span> Standing by. Enter a domain and press <strong>[R]</strong> to resolve its MX hosts and
              negotiate TLS live.
            </div>
          )}
          {lines.map((l, i) => (
            <div key={i} className={`mtls-line mtls-${l.dir.toLowerCase()}`}>
              <span className="mtls-ts">[{(l.t / 1000).toFixed(3).padStart(7, '\u00a0')}]</span>
              <span className="mtls-dir">{DIR_LABEL[l.dir]}</span>
              <span className="mtls-text">{l.text}</span>
            </div>
          ))}
          {running && <span className="mtls-cursor">█</span>}
        </div>
      </div>

      {/* PER-HOST DETAIL */}
      {hosts.map((h) => {
        const hostCopy = [
          `=== ${h.host} [${h.ip}] port ${h.port} — ${h.grade}${h.score == null ? '' : ` (${h.score}/100)`} ===`,
          ...h.checks.filter((c) => c.status !== 'skip').map((c) => `[${c.status.toUpperCase()}] ${c.label}${c.detail ? ` — ${c.detail}` : ''}`),
          h.certificate ? `Subject: ${h.certificate.subject.replace(/\n/g, ', ')}` : '',
          h.certificate ? `Issuer: ${h.certificate.issuer.replace(/\n/g, ', ')}` : '',
          h.certificate ? `SANs: ${h.certificate.sans.join(', ')}` : '',
        ]
          .filter(Boolean)
          .join('\n');
        return (
          <CopyableIntelSection
            key={`detail-${h.host}-${h.ip}`}
            title={`► ${h.host} — ${h.port === 465 ? 'SMTPS' : 'STARTTLS'} REPORT`}
            badge={`${h.grade}${h.score == null ? '' : ` • ${h.score}/100`} • ${h.durationMs} ms`}
            copyPayload={hostCopy}
          >
            <div className="mtls-detail-grid">
              <div>
                <div className="sub-card-hdr">COMPLIANCE CHECKS</div>
                <ul className="mtls-checks">
                  {h.checks
                    .filter((c) => c.status !== 'skip')
                    .map((c) => (
                      <li key={c.id}>
                        <span className={`mtls-badge mtls-badge-${c.status}`}>{c.status.toUpperCase()}</span>
                        <span className="mtls-check-label">{c.label}</span>
                        {c.detail && <span className="dim-note mtls-check-detail">{c.detail}</span>}
                      </li>
                    ))}
                </ul>
                {h.error && <div className="mtls-host-error status-err">✕ {h.error}</div>}
              </div>
              <div className="whois-grid">
                <div className="whois-item">
                  <span className="tele-lbl">TLS PROTOCOL / CIPHER</span>
                  <span className="tele-val text-cyan">
                    {h.tls ? `${h.tls.protocol} • ${h.tls.cipher?.standardName || h.tls.cipher?.name || '?'}` : '—'}
                  </span>
                </div>
                <div className="whois-item">
                  <span className="tele-lbl">KEY EXCHANGE / HANDSHAKE</span>
                  <span className="tele-val">{h.tls ? `${h.tls.keyExchange || '—'} • ${h.tls.handshakeMs} ms` : '—'}</span>
                </div>
                <div className="whois-item">
                  <span className="tele-lbl">CERTIFICATE SUBJECT</span>
                  <span className="tele-val text-gold">{shortDn(h.certificate?.subject)}</span>
                </div>
                <div className="whois-item">
                  <span className="tele-lbl">ISSUER</span>
                  <span className="tele-val">{h.certificate ? (h.certificate.isSelfSigned ? 'SELF-SIGNED' : shortDn(h.certificate.issuer)) : '—'}</span>
                </div>
                <div className="whois-item">
                  <span className="tele-lbl">TRUST</span>
                  <span className={`tele-val ${h.certificate?.trust.trusted ? 'status-ok' : h.certificate ? 'status-err' : ''}`}>
                    {h.certificate ? (h.certificate.trust.trusted ? 'EXTERNALLY TRUSTED' : h.certificate.trust.status) : '—'}
                  </span>
                </div>
                <div className="whois-item">
                  <span className="tele-lbl">EXPIRES</span>
                  <span className={`tele-val ${h.certificate && h.certificate.daysRemaining < 14 ? 'status-warn' : ''}`}>
                    {h.certificate ? `${h.certificate.validTo} (${h.certificate.daysRemaining} d)` : '—'}
                  </span>
                </div>
                <div className="whois-item">
                  <span className="tele-lbl">PUBLIC KEY / CHAIN</span>
                  <span className="tele-val">{h.certificate ? `${h.certificate.keyStrength.label} • ${h.certificate.wireChainCount} cert(s) sent` : '—'}</span>
                </div>
                <div className="whois-item">
                  <span className="tele-lbl">SAN NAMES</span>
                  <span className="tele-val code-wrap-inline">{h.certificate?.sans.length ? h.certificate.sans.slice(0, 8).join(', ') : '—'}</span>
                </div>
              </div>
            </div>
            {(h.ehloCapabilities.length > 0 || h.ehloTlsCapabilities.length > 0) && (
              <div className="mtls-caps mt-8">
                {h.ehloCapabilities.length > 0 && (
                  <div>
                    <span className="tele-lbl">EHLO (PLAINTEXT):</span>{' '}
                    {h.ehloCapabilities.map((c) => (
                      <code key={`p-${c}`} className={`mtls-cap ${/^STARTTLS/i.test(c) ? 'mtls-cap-hot' : ''}`}>
                        {c}
                      </code>
                    ))}
                  </div>
                )}
                {h.ehloTlsCapabilities.length > 0 && (
                  <div>
                    <span className="tele-lbl">EHLO (OVER TLS):</span>{' '}
                    {h.ehloTlsCapabilities.map((c) => (
                      <code key={`t-${c}`} className="mtls-cap">
                        {c}
                      </code>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CopyableIntelSection>
        );
      })}

      {/* DOMAIN TRANSPORT SECURITY POLICY */}
      {policy && (
        <CopyableIntelSection
          title="► DOMAIN TRANSPORT POLICY (MTA-STS • TLS-RPT • DANE)"
          badge={policy.mtaSts?.policy?.mode ? `MTA-STS: ${policy.mtaSts.policy.mode.toUpperCase()}` : 'MTA-STS: NONE'}
          copyPayload={reportText}
        >
          <div className="whois-grid">
            <div className="whois-item">
              <span className="tele-lbl">MTA-STS (RFC 8461)</span>
              <span className={`tele-val ${policy.mtaSts?.policy?.mode === 'enforce' ? 'status-ok' : policy.mtaSts?.record ? 'status-warn' : ''}`}>
                {!policy.mtaSts?.record
                  ? 'Not published'
                  : policy.mtaSts.policy
                    ? `mode=${policy.mtaSts.policy.mode} • max_age=${policy.mtaSts.policy.maxAge}`
                    : `TXT found, policy fetch failed (${policy.mtaSts.fetch?.error || `HTTP ${policy.mtaSts.fetch?.status}`})`}
              </span>
            </div>
            <div className="whois-item">
              <span className="tele-lbl">MTA-STS MX COVERAGE</span>
              <span className="tele-val">
                {policy.mtaSts?.mxCoverage.length
                  ? policy.mtaSts.mxCoverage.map((c) => `${c.covered ? '✓' : '✕'} ${c.host}`).join(' • ')
                  : '—'}
              </span>
            </div>
            <div className="whois-item">
              <span className="tele-lbl">TLS-RPT (RFC 8460)</span>
              <span className={`tele-val ${policy.tlsRpt?.record ? 'status-ok' : ''}`}>{policy.tlsRpt?.rua || (policy.tlsRpt?.record ? 'published' : 'Not published')}</span>
            </div>
            <div className="whois-item">
              <span className="tele-lbl">DANE TLSA (RFC 7672)</span>
              <span className={`tele-val ${policy.dane.some((d) => d.records.length && d.dnssecAd) ? 'status-ok' : ''}`}>
                {policy.dane.length
                  ? policy.dane
                      .map((d) => `${d.host}: ${d.records.length ? `${d.records.length} TLSA${d.dnssecAd ? ' ✓DNSSEC' : ' (no DNSSEC)'}` : 'none'}`)
                      .join(' • ')
                  : '—'}
              </span>
            </div>
          </div>
        </CopyableIntelSection>
      )}

      {summary && (
        <div className="dim-note geo-attribution">
          Probe origin: techtools.subwrite.se • EHLO name <code>techtools.subwrite.se</code> • {summary.durationMs} ms total. Results reflect what an
          external MTA sees from this network. [C] copies the full report, [T] the raw transcript.
        </div>
      )}
    </div>
  );
};

export default MailTlsTool;
