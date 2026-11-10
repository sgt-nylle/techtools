import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { CopyableIntelSection } from '../components/CopyableIntelSection';
import { sound } from '../utils/audio';
import { useIsPaneActive } from '../utils/paneContext';

type ProbeViewTab = 'all' | 'http' | 'tls' | 'headers';
type ProbeMethod = 'GET' | 'HEAD';
type ProbeTlsMode = 'auto' | 'tls' | 'plain';

interface ProbeChainCertSummary {
  depth: number;
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  isCa: boolean;
  isSelfSigned: boolean;
  fingerprint256: string;
}

interface ProbeLiveCertificate {
  subject: string;
  issuer: string;
  serialNumber: string;
  fingerprint256: string;
  validFrom: string;
  validTo: string;
  daysRemaining: number;
  isExpired: boolean;
  isNotYetValid: boolean;
  validityStatus: 'ACTIVE' | 'EXPIRED' | 'NOT_YET_VALID';
  hostnameMatch: boolean;
  matchedIdentity: string | null;
  sans: string[];
  extendedKeyUsage: string[];
  keyUsage: string[];
  isCa: boolean;
  isSelfSigned: boolean;
  publicKey: {
    type: string;
    details: {
      modulusLength?: number;
      namedCurve?: string;
    } | null;
  };
  trust: {
    trusted: boolean;
    status: string;
    details: string;
  };
  wireChainCount: number;
  aiaCompletedChain: boolean;
  chainSummary: ProbeChainCertSummary[];
  leafPem: string;
  fullChainPem: string;
}

interface ProbeRedirectHop {
  hop: number;
  url: string;
  hostname: string;
  resolvedIp: string | null;
  port: number;
  reachability: string;
  statusCode: number | null;
  statusMessage: string | null;
  location: string | null;
  tlsProtocol: string | null;
  durationMs: number;
}

interface UrlProbePayload {
  requestedInput: string;
  requestedPort: number;
  method: ProbeMethod;
  followRedirects: boolean;
  tlsMode: ProbeTlsMode;
  finalUrl: string;
  hostname: string;
  port: number;
  path: string;
  reachability: 'HTTP_OK' | 'TCP_OPEN' | 'TLS_FAILED' | 'TCP_FAILED' | 'DNS_FAILED';
  dns: {
    dnsMs: number;
    resolvedIp: string | null;
    ipv4: string[];
    ipv6: string[];
  };
  icmp: {
    alive: boolean;
    status: string;
    transmitted: number;
    received: number;
    packetLossPct: number;
    minMs: number | null;
    avgMs: number | null;
    maxMs: number | null;
    ttl: number | null;
    summary: string;
  } | null;
  tcp: {
    connected: boolean;
    connectMs: number | null;
    errorCode: string | null;
    errorMessage: string | null;
  };
  tls: {
    attempted: boolean;
    connected: boolean;
    handshakeMs: number | null;
    errorCode: string | null;
    errorMessage: string | null;
    protocol: string | null;
    cipher: {
      name: string;
      standardName: string;
      version: string;
    } | null;
    authorizedByNode: boolean;
    authorizationError: string | null;
    certificate: ProbeLiveCertificate | null;
  } | null;
  http: {
    httpVersion: string;
    statusCode: number;
    statusMessage: string;
    ttfbMs: number;
    totalHttpMs: number;
    headers: Array<{ name: string; value: string }>;
    contentType: string | null;
    server: string | null;
    location: string | null;
    pageTitle: string | null;
    bodySnippet: string | null;
    sampledBytes: number;
    securityHeaders: {
      hsts: string | null;
      csp: string | null;
      xFrameOptions: string | null;
      xContentTypeOptions: string | null;
      referrerPolicy: string | null;
    };
  } | null;
  protocolDetected: string | null;
  banner: string | null;
  httpError: string | null;
  tlsFallbackNote: string | null;
  redirectChain: ProbeRedirectHop[];
  redirectWarning: string | null;
  totalDurationMs: number;
}

const PORT_PRESETS: Array<{ port: string; label: string }> = [
  { port: '443', label: '443 HTTPS' },
  { port: '80', label: '80 HTTP' },
  { port: '8443', label: '8443 ALT-TLS' },
  { port: '8080', label: '8080 ALT-HTTP' },
  { port: '587', label: '587 SMTP' },
  { port: '22', label: '22 SSH' },
];

function formatDistinguishedName(dn: string): string {
  return dn ? dn.replace(/\n/g, ', ') : '—';
}

function extractInlinePortOrSchemeDefault(raw: string): { explicitPort: string | null; scheme: 'http' | 'https' | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { explicitPort: null, scheme: null };

  let scheme: 'http' | 'https' | null = null;
  if (/^https:\/\//i.test(trimmed)) scheme = 'https';
  else if (/^http:\/\//i.test(trimmed)) scheme = 'http';

  try {
    const parsed = new URL(scheme ? trimmed : `https://${trimmed}`);
    if (parsed.port) {
      return { explicitPort: parsed.port, scheme };
    }
  } catch {
    // Ignore incomplete URL while typing
  }
  return { explicitPort: null, scheme };
}

export const UrlProbeTool: React.FC = () => {
  const isPaneActive = useIsPaneActive();
  const [urlInput, setUrlInput] = useState<string>('');
  const [portInput, setPortInput] = useState<string>('443');
  const [portManuallyEdited, setPortManuallyEdited] = useState<boolean>(false);
  const [method, setMethod] = useState<ProbeMethod>('GET');
  const [followRedirects, setFollowRedirects] = useState<boolean>(true);
  const [tlsMode, setTlsMode] = useState<ProbeTlsMode>('auto');

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<UrlProbePayload | null>(null);
  const [activeTab, setActiveTab] = useState<ProbeViewTab>('all');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const urlInputRef = useRef<HTMLInputElement>(null);
  const portInputRef = useRef<HTMLInputElement>(null);

  const copyValue = useCallback(async (val: string, key: string) => {
    if (!val) return;
    try {
      await navigator.clipboard.writeText(val);
      sound.playCopy();
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 1500);
    } catch {
      sound.playError();
    }
  }, []);

  const handleTileKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, val: string, key: string) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'c' || e.key === 'C' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      void copyValue(val, key);
    }
  };

  const handleUrlChange = (nextVal: string) => {
    setUrlInput(nextVal);
    const { explicitPort, scheme } = extractInlinePortOrSchemeDefault(nextVal);
    if (explicitPort) {
      setPortInput(explicitPort);
      setPortManuallyEdited(false);
    } else if (!portManuallyEdited) {
      if (scheme === 'http') setPortInput('80');
      else if (scheme === 'https') setPortInput('443');
    }
  };

  const runProbe = useCallback(
    async (overrides?: {
      url?: string;
      port?: string;
      method?: ProbeMethod;
      followRedirects?: boolean;
      tlsMode?: ProbeTlsMode;
    }) => {
      const targetUrl = (overrides?.url ?? urlInput).trim();
      const targetPortStr = (overrides?.port ?? portInput).trim() || '443';
      const reqMethod = overrides?.method ?? method;
      const reqFollow = overrides?.followRedirects ?? followRedirects;
      const reqTlsMode = overrides?.tlsMode ?? tlsMode;

      if (!targetUrl) {
        setError('Enter a public URL or hostname to test (e.g. https://subwrite.se).');
        sound.playError();
        urlInputRef.current?.focus();
        return;
      }

      const parsedPort = Number(targetPortStr);
      if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
        setError('Port must be a valid TCP port number between 1 and 65535.');
        sound.playError();
        portInputRef.current?.focus();
        return;
      }

      setLoading(true);
      setError(null);
      sound.playRadarPing();

      try {
        const res = await fetch('/api/probe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: targetUrl,
            port: parsedPort,
            method: reqMethod,
            followRedirects: reqFollow,
            tlsMode: reqTlsMode,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          setError(json.error || 'External endpoint probe failed.');
          sound.playError();
        } else {
          setData(json as UrlProbePayload);
        }
      } catch {
        setError('Network error communicating with diagnostic probe backend.');
        sound.playError();
      } finally {
        setLoading(false);
      }
    },
    [urlInput, portInput, method, followRedirects, tlsMode]
  );

  const selectPortPreset = (p: string) => {
    sound.playClick();
    setPortInput(p);
    setPortManuallyEdited(true);
  };

  // Keyboard-first single-letter shortcuts
  useEffect(() => {
    if (!isPaneActive) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const isTextInput =
        (target?.tagName === 'INPUT' &&
          (target as HTMLInputElement).type !== 'checkbox' &&
          (target as HTMLInputElement).type !== 'range') ||
        target?.tagName === 'TEXTAREA';
      if (isTextInput) return;

      const k = e.key.toLowerCase();

      if (k === 'q' || k === '/') {
        e.preventDefault();
        sound.playClick();
        urlInputRef.current?.focus();
        urlInputRef.current?.select();
        return;
      }

      if (k === 'p') {
        e.preventDefault();
        sound.playClick();
        portInputRef.current?.focus();
        portInputRef.current?.select();
        return;
      }

      if (k === 'r') {
        e.preventDefault();
        if (!loading) void runProbe();
        return;
      }

      if (k === 'm') {
        e.preventDefault();
        sound.playClick();
        setMethod((prev) => (prev === 'GET' ? 'HEAD' : 'GET'));
        return;
      }

      if (k === 'f') {
        e.preventDefault();
        sound.playClick();
        setFollowRedirects((prev) => !prev);
        return;
      }

      if (k === 'l') {
        e.preventDefault();
        sound.playClick();
        setTlsMode((prev) => (prev === 'auto' ? 'tls' : prev === 'tls' ? 'plain' : 'auto'));
        return;
      }

      if (!data) return;

      if (k === 'a') {
        e.preventDefault();
        sound.playClick();
        setActiveTab('all');
      } else if (k === 'h') {
        e.preventDefault();
        sound.playClick();
        setActiveTab('http');
      } else if (k === 't') {
        e.preventDefault();
        sound.playClick();
        setActiveTab('tls');
      } else if (k === 'd') {
        e.preventDefault();
        sound.playClick();
        setActiveTab('headers');
      } else if (k === 'x' && data.tls?.certificate?.fullChainPem) {
        e.preventDefault();
        void copyValue(data.tls.certificate.fullChainPem, 'full-chain-pem');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPaneActive, data, loading, runProbe, copyValue]);

  const sectionPayloads = useMemo(() => {
    if (!data) {
      return { connectivity: '', tls: '', headers: '' };
    }

    const connLines: string[] = [
      `=== EXTERNAL ENDPOINT & CONNECTIVITY PROBE ===`,
      `Target Input: ${data.requestedInput} (Port ${data.requestedPort})`,
      `Final Endpoint: ${data.finalUrl}`,
      `Reachability Verdict: ${data.reachability}`,
      `Resolved WAN IP: ${data.dns.resolvedIp || 'Unresolved'} (DNS ${data.dns.dnsMs} ms)`,
    ];
    if (data.dns.ipv4.length > 0) connLines.push(`Public IPv4 (A): ${data.dns.ipv4.join(', ')}`);
    if (data.dns.ipv6.length > 0) connLines.push(`Public IPv6 (AAAA): ${data.dns.ipv6.join(', ')}`);
    if (data.icmp) {
      connLines.push(`Sonar ICMP Ping: ${data.icmp.summary}`);
    }
    connLines.push(
      `TCP Socket (Port ${data.port}): ${
        data.tcp.connected
          ? `CONNECTED (${data.tcp.connectMs} ms)`
          : `FAILED — ${data.tcp.errorMessage || data.tcp.errorCode}`
      }`
    );
    if (data.tls) {
      connLines.push(
        `TLS Handshake: ${
          data.tls.connected
            ? `${data.tls.protocol} / ${data.tls.cipher?.name || 'Cipher'} (${data.tls.handshakeMs} ms)`
            : `FAILED — ${data.tls.errorMessage || data.tls.errorCode}`
        }`
      );
    }
    if (data.http) {
      connLines.push(
        `HTTP Response: HTTP/${data.http.httpVersion} ${data.http.statusCode} ${data.http.statusMessage} (TTFB ${data.http.ttfbMs} ms)`
      );
      if (data.http.pageTitle) connLines.push(`HTML Title: ${data.http.pageTitle}`);
      if (data.http.location) connLines.push(`Redirect Location: ${data.http.location}`);
    } else if (data.banner) {
      connLines.push(`Service Banner: ${data.banner}`);
    } else if (data.httpError) {
      connLines.push(`Protocol Note: ${data.httpError}`);
    }
    if (data.redirectChain.length > 1) {
      connLines.push('', '--- REDIRECT HOP TRACE ---');
      for (const hop of data.redirectChain) {
        connLines.push(
          `Hop #${hop.hop}: [${hop.statusCode || hop.reachability}] ${hop.url} (${hop.resolvedIp || 'no-ip'}:${hop.port}) -> ${hop.location || 'FINAL'} (${hop.durationMs} ms)`
        );
      }
    }
    if (data.redirectWarning) {
      connLines.push(`Redirect Warning: ${data.redirectWarning}`);
    }
    connLines.push(`Total Probe Time: ${data.totalDurationMs} ms`);

    const tlsLines: string[] = [];
    if (data.tls?.certificate) {
      const c = data.tls.certificate;
      tlsLines.push(`=== LIVE SSL / TLS CERTIFICATE REPORT (${data.hostname}:${data.port}) ===`);
      tlsLines.push(`Protocol & Cipher: ${data.tls.protocol} • ${data.tls.cipher?.standardName || data.tls.cipher?.name || '—'}`);
      tlsLines.push(`Trust Verdict: ${c.trust.status} — ${c.trust.details}`);
      tlsLines.push(
        `Hostname Match (${data.hostname}): ${
          c.hostnameMatch ? `MATCHED (${c.matchedIdentity || data.hostname})` : 'MISMATCH!'
        }`
      );
      tlsLines.push(`Subject: ${formatDistinguishedName(c.subject)}`);
      tlsLines.push(`Issuer: ${formatDistinguishedName(c.issuer)}`);
      tlsLines.push(`Valid From: ${c.validFrom}`);
      tlsLines.push(`Valid Until: ${c.validTo} (${c.daysRemaining} days remaining • ${c.validityStatus})`);
      tlsLines.push(`SANs (${c.sans.length}): ${c.sans.join(', ') || 'None'}`);
      tlsLines.push(
        `Public Key: ${c.publicKey.type}${
          c.publicKey.details?.modulusLength
            ? ` ${c.publicKey.details.modulusLength}-bit`
            : c.publicKey.details?.namedCurve
            ? ` (${c.publicKey.details.namedCurve})`
            : ''
        }`
      );
      tlsLines.push(`Serial Number: ${c.serialNumber}`);
      tlsLines.push(`SHA-256 Fingerprint: ${c.fingerprint256}`);
      tlsLines.push(`Server-Sent Chain Depth: ${c.wireChainCount} certificate(s)`);
    } else if (data.tls) {
      tlsLines.push(`=== SSL / TLS HANDSHAKE (${data.hostname}:${data.port}) ===`);
      tlsLines.push(`Status: FAILED — ${data.tls.errorMessage || data.tls.errorCode || 'Handshake aborted'}`);
    }

    const hdrLines: string[] = [];
    if (data.http) {
      hdrLines.push(`=== HTTP RESPONSE HEADERS (${data.finalUrl}) ===`);
      hdrLines.push(`HTTP/${data.http.httpVersion} ${data.http.statusCode} ${data.http.statusMessage}`);
      for (const h of data.http.headers) {
        hdrLines.push(`${h.name}: ${h.value}`);
      }
    }

    return {
      connectivity: connLines.join('\n'),
      tls: tlsLines.join('\n'),
      headers: hdrLines.join('\n'),
    };
  }, [data]);

  // Status badge color & text helpers
  const renderPrimaryVerdict = () => {
    if (!data) return { label: 'IDLE', cls: 'text-cyan' };
    if (data.reachability === 'DNS_FAILED') return { label: 'DNS NXDOMAIN', cls: 'text-red' };
    if (data.reachability === 'TCP_FAILED') {
      return {
        label: data.tcp.errorCode === 'ECONNREFUSED' ? 'PORT CLOSED (RST)' : 'TIMEOUT / FILTERED',
        cls: 'text-red',
      };
    }
    if (data.reachability === 'TLS_FAILED') return { label: 'TLS HANDSHAKE ERR', cls: 'text-red' };
    if (data.http) {
      const code = data.http.statusCode;
      const cls =
        code >= 200 && code < 300
          ? 'text-green'
          : code >= 300 && code < 400
          ? 'text-cyan'
          : code === 401 || code === 403
          ? 'text-gold'
          : 'text-red';
      return { label: `${code} ${data.http.statusMessage || 'HTTP'}`, cls };
    }
    return { label: `TCP ${data.port} OPEN`, cls: 'text-green' };
  };

  const renderTlsVerdict = () => {
    if (!data || !data.tls) return { label: 'PLAIN (NO SSL)', cls: 'text-gold' };
    if (!data.tls.connected) return { label: 'HANDSHAKE FAILED', cls: 'text-red' };
    const cert = data.tls.certificate;
    if (!cert) return { label: `${data.tls.protocol || 'TLS'} OPEN`, cls: 'text-cyan' };
    if (cert.isExpired) return { label: `EXPIRED (${Math.abs(cert.daysRemaining)}d ago)`, cls: 'text-red' };
    if (!cert.hostnameMatch) return { label: 'HOST MISMATCH', cls: 'text-red' };
    if (!cert.trust.trusted) return { label: cert.trust.status, cls: 'text-gold' };
    const daysCls = cert.daysRemaining <= 14 ? 'text-gold' : 'text-green';
    return { label: `${data.tls.protocol} • OK (${cert.daysRemaining}d)`, cls: daysCls };
  };

  const renderIcmpVerdict = () => {
    if (!data || !data.icmp) return { label: 'N/A', cls: 'dim-inline' };
    if (data.icmp.alive) {
      const avg = data.icmp.avgMs !== null ? ` (${data.icmp.avgMs.toFixed(1)} ms)` : '';
      return { label: `PING OK${avg}`, cls: 'text-green' };
    }
    if (data.tcp.connected) {
      return { label: 'ICMP FILTERED', cls: 'text-gold' };
    }
    return { label: data.icmp.status, cls: 'text-red' };
  };

  const verdict = renderPrimaryVerdict();
  const tlsVerdict = renderTlsVerdict();
  const icmpVerdict = renderIcmpVerdict();

  return (
    <div className="tool-panel">
      {/* EXTERNAL PROBE INPUT BAR */}
      <form
        className="query-bar clean-box"
        onSubmit={(e) => {
          e.preventDefault();
          void runProbe();
        }}
      >
        <div className="query-input-group probe-url-row">
          <span className="prompt-chevron" title="Press [Q] to focus URL input">
            URL [Q]&gt;
          </span>
          <input
            ref={urlInputRef}
            type="text"
            value={urlInput}
            onChange={(e) => handleUrlChange(e.target.value)}
            placeholder="https://portal.company.com/health or hostname (ESC unlocks shortcuts)"
            className="navy-input probe-url-input"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <div className="probe-port-box">
            <label htmlFor="probe-port-field" className="prompt-chevron" title="Press [P] to focus Port">
              PORT [P]:
            </label>
            <input
              id="probe-port-field"
              ref={portInputRef}
              type="number"
              min={1}
              max={65535}
              value={portInput}
              onChange={(e) => {
                setPortInput(e.target.value);
                setPortManuallyEdited(true);
              }}
              className="navy-input probe-port-input"
              aria-label="Target TCP Port"
            />
          </div>
          <button type="submit" disabled={loading} className="navy-btn btn-primary">
            {loading ? 'PROBING...' : '► PROBE [R]'}
          </button>
        </div>

        {/* PORT PRESETS + PROBE OPTIONS */}
        <div className="dns-resolver-row">
          <span className="quick-lbl">PORTS:</span>
          <div className="preset-buttons">
            {PORT_PRESETS.map((preset) => (
              <button
                key={preset.port}
                type="button"
                className={`navy-chip-btn ${portInput.trim() === preset.port ? 'chip-active' : ''}`}
                onClick={() => selectPortPreset(preset.port)}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <span className="spec-sep">|</span>

          <div className="preset-buttons">
            <button
              type="button"
              className="navy-btn btn-xs"
              onClick={() => {
                sound.playClick();
                setMethod((m) => (m === 'GET' ? 'HEAD' : 'GET'));
              }}
              title="Toggle HTTP Method [M]"
            >
              METHOD: <span className="text-gold">{method}</span> [M]
            </button>
            <button
              type="button"
              className={`navy-btn btn-xs ${followRedirects ? 'btn-active' : ''}`}
              onClick={() => {
                sound.playClick();
                setFollowRedirects((f) => !f);
              }}
              title="Follow HTTP 3xx Redirects [F]"
            >
              FOLLOW 3XX: {followRedirects ? 'ON' : 'OFF'} [F]
            </button>
            <button
              type="button"
              className="navy-btn btn-xs"
              onClick={() => {
                sound.playClick();
                setTlsMode((t) => (t === 'auto' ? 'tls' : t === 'tls' ? 'plain' : 'auto'));
              }}
              title="Cycle SSL/TLS Handshake Mode [L]"
            >
              SSL: <span className="text-cyan">{tlsMode.toUpperCase()}</span> [L]
            </button>
          </div>
        </div>
      </form>

      {error && <div className="alert-banner status-err clean-box">⚠ {error}</div>}

      {!data && !loading && !error && (
        <div className="empty-prompt clean-box">
          Test how any public corporate URL, reverse proxy, or custom TCP port responds from the{' '}
          <strong className="text-gold">external internet</strong> — including active sonar{' '}
          <strong className="text-cyan">ICMP PING</strong>, TCP/HTTP response, and live SSL/TLS certificate inspection.
          Enter a URL (<kbd>Q</kbd>), set port (<kbd>P</kbd>, default <code>443</code>), and press <kbd>ENTER</kbd> or{' '}
          <kbd>R</kbd>.
        </div>
      )}

      {loading && (
        <div className="loading-radar clean-box">
          <span className="radar-spinner">◎</span> SENDING SONAR PING &amp; PROBING EXTERNAL ENDPOINT (
          {urlInput.trim() || '...'} : {portInput.trim() || '443'})...
        </div>
      )}

      {data && !loading && (
        <>
          {/* SUMMARY TELEMETRY STRIP */}
          <div className="telemetry-strip clean-box">
            <div className="tele-cell">
              <span className="tele-lbl">SONAR PING (ICMP)</span>
              <span className={`tele-val ${icmpVerdict.cls}`}>{icmpVerdict.label}</span>
            </div>
            <div className="tele-cell">
              <span className="tele-lbl">EXTERNAL RESPONSE</span>
              <span className={`tele-val ${verdict.cls}`}>{verdict.label}</span>
            </div>
            <div className="tele-cell">
              <span className="tele-lbl">RESOLVED WAN IP : PORT</span>
              <span className="tele-val text-cyan">
                {data.dns.resolvedIp ? `${data.dns.resolvedIp}:${data.port}` : `UNRESOLVED : ${data.port}`}
              </span>
            </div>
            <div className="tele-cell">
              <span className="tele-lbl">SSL / TLS STATUS</span>
              <span className={`tele-val ${tlsVerdict.cls}`}>{tlsVerdict.label}</span>
            </div>
            <div className="tele-cell">
              <span className="tele-lbl">TOTAL PROBE TIME</span>
              <span className="tele-val text-gold">
                {data.totalDurationMs} ms
                {data.redirectChain.length > 1 ? ` (${data.redirectChain.length} hops)` : ''}
              </span>
            </div>
          </div>

          {/* VIEW FILTER TABS */}
          <div className="dns-tabs-bar">
            <button
              type="button"
              className={`navy-tab-btn ${activeTab === 'all' ? 'active' : ''}`}
              onClick={() => setActiveTab('all')}
            >
              ALL INTEL [A]
            </button>
            <button
              type="button"
              className={`navy-tab-btn ${activeTab === 'http' ? 'active' : ''}`}
              onClick={() => setActiveTab('http')}
            >
              CONNECTIVITY &amp; HTTP [H]
            </button>
            <button
              type="button"
              className={`navy-tab-btn ${activeTab === 'tls' ? 'active' : ''}`}
              onClick={() => setActiveTab('tls')}
            >
              SSL / TLS CERTIFICATE [T]
            </button>
            <button
              type="button"
              className={`navy-tab-btn ${activeTab === 'headers' ? 'active' : ''}`}
              onClick={() => setActiveTab('headers')}
            >
              HEADERS ({data.http?.headers.length ?? 0}) [D]
            </button>
          </div>

          {/* 1. EXTERNAL CONNECTIVITY, TIMING & REDIRECT CHAIN */}
          {(activeTab === 'all' || activeTab === 'http') && (
            <CopyableIntelSection
              title="1. EXTERNAL REACHABILITY, LATENCY & RESPONSE"
              badge={`${data.method} • PORT ${data.port}`}
              copyPayload={sectionPayloads.connectivity}
            >
              {/* PHASE TIMING PILLS */}
              <div className="probe-timing-strip">
                <div className="timing-stage-pill">
                  <span className="timing-lbl">SONAR ICMP</span>
                  <span className={`timing-ms ${icmpVerdict.cls}`}>
                    {!data.icmp
                      ? '—'
                      : data.icmp.alive
                      ? `PING OK${data.icmp.avgMs !== null ? ` (${data.icmp.avgMs.toFixed(1)} ms)` : ''}`
                      : 'NO ECHO'}
                  </span>
                </div>
                <span className="timing-arrow">•</span>
                <div className="timing-stage-pill">
                  <span className="timing-lbl">1. PUBLIC DNS</span>
                  <span className={`timing-ms ${data.dns.resolvedIp ? 'text-cyan' : 'text-red'}`}>
                    {data.dns.dnsMs} ms
                  </span>
                </div>
                <span className="timing-arrow">►</span>
                <div className="timing-stage-pill">
                  <span className="timing-lbl">2. TCP CONNECT</span>
                  <span className={`timing-ms ${data.tcp.connected ? 'text-green' : 'text-red'}`}>
                    {data.tcp.connectMs !== null ? `${data.tcp.connectMs} ms` : '—'}
                  </span>
                </div>
                <span className="timing-arrow">►</span>
                <div className="timing-stage-pill">
                  <span className="timing-lbl">3. TLS HANDSHAKE</span>
                  <span
                    className={`timing-ms ${
                      !data.tls ? 'dim-inline' : data.tls.connected ? 'text-green' : 'text-red'
                    }`}
                  >
                    {!data.tls ? 'SKIPPED' : data.tls.handshakeMs !== null ? `${data.tls.handshakeMs} ms` : 'ERR'}
                  </span>
                </div>
                <span className="timing-arrow">►</span>
                <div className="timing-stage-pill">
                  <span className="timing-lbl">4. HTTP TTFB</span>
                  <span className={`timing-ms ${data.http ? 'text-gold' : 'dim-inline'}`}>
                    {data.http ? `${data.http.ttfbMs} ms` : 'N/A'}
                  </span>
                </div>
              </div>

              {data.tlsFallbackNote && (
                <div className="dim-note mt-8">ℹ {data.tlsFallbackNote}</div>
              )}

              <div className="horizontal-tiles-list">
                {/* ENDPOINT URL */}
                <div
                  tabIndex={0}
                  className="nav-tile focusable-row"
                  onKeyDown={(e) => handleTileKeyDown(e, data.finalUrl, 'final-url')}
                  onClick={() => void copyValue(data.finalUrl, 'final-url')}
                >
                  <div className="tile-badge-col">
                    <span className="tile-hdr-badge">ENDPOINT</span>
                    <span className="auth-status-pill text-gold">{data.protocolDetected || 'PROBE'}</span>
                  </div>
                  <div className="tile-content-col">
                    <div className="tile-title-line">FINAL PROBED URL</div>
                    <div className="tile-main-val">
                      <code>{data.finalUrl}</code>
                    </div>
                  </div>
                  <div className="tile-action-col">
                    <span className={`navy-btn btn-xs ${copiedKey === 'final-url' ? 'btn-copied' : ''}`}>
                      {copiedKey === 'final-url' ? '✓ COPIED' : 'COPY [C]'}
                    </span>
                  </div>
                </div>

                {/* PUBLIC DNS RESOLUTION */}
                <div
                  tabIndex={0}
                  className="nav-tile focusable-row"
                  onKeyDown={(e) =>
                    handleTileKeyDown(
                      e,
                      data.dns.resolvedIp || data.hostname,
                      'resolved-ip'
                    )
                  }
                  onClick={() => void copyValue(data.dns.resolvedIp || data.hostname, 'resolved-ip')}
                >
                  <div className="tile-badge-col">
                    <span className="tile-hdr-badge">WAN DNS</span>
                    <span className={`auth-status-pill ${data.dns.resolvedIp ? 'text-green' : 'text-red'}`}>
                      {data.dns.resolvedIp ? 'RESOLVED' : 'NXDOMAIN'}
                    </span>
                  </div>
                  <div className="tile-content-col">
                    <div className="tile-title-line">EXTERNAL PUBLIC DNS RESOLUTION (8.8.8.8 / 1.1.1.1)</div>
                    <div className="tile-main-val">
                      {data.dns.resolvedIp ? (
                        <>
                          <strong className="text-cyan">{data.dns.resolvedIp}</strong>
                          {data.dns.ipv4.length > 1 && (
                            <span className="dim-inline"> • All IPv4: {data.dns.ipv4.join(', ')}</span>
                          )}
                          {data.dns.ipv6.length > 0 && (
                            <span className="dim-inline"> • IPv6: {data.dns.ipv6.join(', ')}</span>
                          )}
                        </>
                      ) : (
                        <span className="text-red">
                          {data.tcp.errorMessage || `Public DNS could not resolve ${data.hostname}.`}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="tile-action-col">
                    <span className={`navy-btn btn-xs ${copiedKey === 'resolved-ip' ? 'btn-copied' : ''}`}>
                      {copiedKey === 'resolved-ip' ? '✓ COPIED' : 'COPY [C]'}
                    </span>
                  </div>
                </div>

                {/* ACTIVE SONAR ICMP PING */}
                {data.icmp && (
                  <div
                    tabIndex={0}
                    className="nav-tile focusable-row"
                    onKeyDown={(e) =>
                      handleTileKeyDown(
                        e,
                        `${data.dns.resolvedIp} — ${data.icmp!.summary}`,
                        'icmp-ping'
                      )
                    }
                    onClick={() =>
                      void copyValue(`${data.dns.resolvedIp} — ${data.icmp!.summary}`, 'icmp-ping')
                    }
                  >
                    <div className="tile-badge-col">
                      <span className="tile-hdr-badge">SONAR ICMP</span>
                      <span className={`auth-status-pill ${icmpVerdict.cls}`}>
                        {data.icmp.alive ? 'PING OK' : data.tcp.connected ? 'FILTERED' : 'NO ECHO'}
                      </span>
                    </div>
                    <div className="tile-content-col">
                      <div className="tile-title-line">ACTIVE SONAR — ICMP ECHO REQUEST (3 PULSES)</div>
                      <div className="tile-main-val">
                        <span className={icmpVerdict.cls}>{data.icmp.summary}</span>
                      </div>
                    </div>
                    <div className="tile-action-col">
                      <span className={`navy-btn btn-xs ${copiedKey === 'icmp-ping' ? 'btn-copied' : ''}`}>
                        {copiedKey === 'icmp-ping' ? '✓ COPIED' : 'COPY [C]'}
                      </span>
                    </div>
                  </div>
                )}

                {/* TCP SOCKET REACHABILITY */}
                {data.dns.resolvedIp && (
                  <div
                    tabIndex={0}
                    className="nav-tile focusable-row"
                    onKeyDown={(e) =>
                      handleTileKeyDown(
                        e,
                        `${data.dns.resolvedIp}:${data.port} — ${
                          data.tcp.connected ? `TCP OPEN (${data.tcp.connectMs} ms)` : data.tcp.errorMessage
                        }`,
                        'tcp-status'
                      )
                    }
                    onClick={() =>
                      void copyValue(
                        `${data.dns.resolvedIp}:${data.port} — ${
                          data.tcp.connected ? `TCP OPEN (${data.tcp.connectMs} ms)` : data.tcp.errorMessage
                        }`,
                        'tcp-status'
                      )
                    }
                  >
                    <div className="tile-badge-col">
                      <span className="tile-hdr-badge">TCP:{data.port}</span>
                      <span className={`auth-status-pill ${data.tcp.connected ? 'text-green' : 'text-red'}`}>
                        {data.tcp.connected ? 'OPEN' : data.tcp.errorCode || 'CLOSED'}
                      </span>
                    </div>
                    <div className="tile-content-col">
                      <div className="tile-title-line">EXTERNAL FIREWALL &amp; TCP SOCKET</div>
                      <div className="tile-main-val">
                        {data.tcp.connected ? (
                          <span className="text-green">
                            TCP 3-way handshake succeeded to <code>{data.dns.resolvedIp}:{data.port}</code> in{' '}
                            <strong>{data.tcp.connectMs} ms</strong>
                          </span>
                        ) : (
                          <span className="text-red">{data.tcp.errorMessage}</span>
                        )}
                      </div>
                    </div>
                    <div className="tile-action-col">
                      <span className={`navy-btn btn-xs ${copiedKey === 'tcp-status' ? 'btn-copied' : ''}`}>
                        {copiedKey === 'tcp-status' ? '✓ COPIED' : 'COPY [C]'}
                      </span>
                    </div>
                  </div>
                )}

                {/* HTTP STATUS / BANNER */}
                {data.tcp.connected && (
                  <div
                    tabIndex={0}
                    className="nav-tile focusable-row"
                    onKeyDown={(e) =>
                      handleTileKeyDown(
                        e,
                        data.http
                          ? `HTTP/${data.http.httpVersion} ${data.http.statusCode} ${data.http.statusMessage}${
                              data.http.pageTitle ? ` — ${data.http.pageTitle}` : ''
                            }`
                          : data.banner || data.httpError || 'TCP Open',
                        'http-status'
                      )
                    }
                    onClick={() =>
                      void copyValue(
                        data.http
                          ? `HTTP/${data.http.httpVersion} ${data.http.statusCode} ${data.http.statusMessage}${
                              data.http.pageTitle ? ` — ${data.http.pageTitle}` : ''
                            }`
                          : data.banner || data.httpError || 'TCP Open',
                        'http-status'
                      )
                    }
                  >
                    <div className="tile-badge-col">
                      <span className="tile-hdr-badge">{data.http ? 'HTTP' : 'SERVICE'}</span>
                      <span className={`auth-status-pill ${verdict.cls}`}>
                        {data.http ? data.http.statusCode : 'BANNER'}
                      </span>
                    </div>
                    <div className="tile-content-col">
                      <div className="tile-title-line">APPLICATION LAYER RESPONSE</div>
                      <div className="tile-main-val">
                        {data.http ? (
                          <>
                            <strong className={verdict.cls}>
                              HTTP/{data.http.httpVersion} {data.http.statusCode} {data.http.statusMessage}
                            </strong>
                            <span className="dim-inline">
                              {' '}
                              • TTFB {data.http.ttfbMs} ms
                              {data.http.server ? ` • Server: ${data.http.server}` : ''}
                              {data.http.contentType ? ` • ${data.http.contentType}` : ''}
                            </span>
                            {data.http.pageTitle && (
                              <div className="mt-8">
                                <span className="dim-inline">Page Title: </span>
                                <span className="text-gold">{data.http.pageTitle}</span>
                              </div>
                            )}
                            {data.http.location && !data.followRedirects && (
                              <div className="mt-8">
                                <span className="dim-inline">Location: </span>
                                <code className="text-cyan">{data.http.location}</code>
                              </div>
                            )}
                            {data.http.bodySnippet && (
                              <pre className="probe-snippet-pre">{data.http.bodySnippet}</pre>
                            )}
                          </>
                        ) : data.banner ? (
                          <>
                            <div className="dim-inline">Non-HTTP service banner received:</div>
                            <code className="text-gold">{data.banner}</code>
                          </>
                        ) : (
                          <span className="dim-inline">{data.httpError || 'Port open (no HTTP payload returned).'}</span>
                        )}
                      </div>
                    </div>
                    <div className="tile-action-col">
                      <span className={`navy-btn btn-xs ${copiedKey === 'http-status' ? 'btn-copied' : ''}`}>
                        {copiedKey === 'http-status' ? '✓ COPIED' : 'COPY [C]'}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* REDIRECT HOP TRACE */}
              {(data.redirectChain.length > 1 || data.redirectWarning) && (
                <div className="mt-8">
                  <div className="tile-title-line" style={{ marginBottom: '6px' }}>
                    HTTP REDIRECT CHAIN ({data.redirectChain.length} HOPS)
                  </div>
                  <div className="hops-timeline">
                    {data.redirectChain.map((hop) => (
                      <div key={hop.hop} className="hop-row">
                        <div className="hop-badge-col">
                          <span className="hop-badge">HOP #{hop.hop}</span>
                          <span className="hop-delay-badge text-cyan">{hop.durationMs} ms</span>
                        </div>
                        <div className="hop-info-col">
                          <div className="hop-route-line">
                            <strong className="text-gold">{hop.statusCode || hop.reachability}</strong>{' '}
                            <code>{hop.url}</code>
                          </div>
                          <div className="hop-meta-line">
                            <span>IP: {hop.resolvedIp || '—'}:{hop.port}</span>
                            {hop.tlsProtocol && <span>TLS: {hop.tlsProtocol}</span>}
                            {hop.location && (
                              <span className="text-cyan">➔ Location: {hop.location}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {data.redirectWarning && (
                    <div className="alert-banner status-err clean-box mt-8" style={{ padding: '10px' }}>
                      ⚠ {data.redirectWarning}
                    </div>
                  )}
                </div>
              )}
            </CopyableIntelSection>
          )}

          {/* 2. SSL / TLS CERTIFICATE DETAILS */}
          {(activeTab === 'all' || activeTab === 'tls') && data.tls && (
            <CopyableIntelSection
              title="2. SSL / TLS HANDSHAKE & LIVE CERTIFICATE DETAILS"
              badge={
                data.tls.connected
                  ? `${data.tls.protocol || 'TLS'} • ${data.tls.certificate?.wireChainCount || 0} CERT(S)`
                  : 'TLS FAILED'
              }
              copyPayload={sectionPayloads.tls}
            >
              {!data.tls.connected ? (
                <div className="alert-banner status-err clean-box">
                  ⚠ SSL/TLS Handshake Failed: {data.tls.errorMessage || data.tls.errorCode}
                </div>
              ) : data.tls.certificate ? (
                <>
                  <div className="raw-actions-row">
                    <button
                      type="button"
                      className={`navy-btn btn-sm ${copiedKey === 'full-chain-pem' ? 'btn-copied' : ''}`}
                      onClick={() =>
                        void copyValue(data.tls!.certificate!.fullChainPem, 'full-chain-pem')
                      }
                    >
                      {copiedKey === 'full-chain-pem'
                        ? '✓ FULL PEM CHAIN COPIED!'
                        : '📋 EXPORT FULL CHAIN PEM [X]'}
                    </button>
                    <button
                      type="button"
                      className={`navy-btn btn-sm ${copiedKey === 'leaf-pem' ? 'btn-copied' : ''}`}
                      onClick={() => void copyValue(data.tls!.certificate!.leafPem, 'leaf-pem')}
                    >
                      {copiedKey === 'leaf-pem' ? '✓ LEAF PEM COPIED!' : '📋 COPY SERVER CERT PEM'}
                    </button>
                  </div>

                  <div className="horizontal-tiles-list">
                    {/* TRUST & HOSTNAME VERIFICATION */}
                    <div
                      tabIndex={0}
                      className="nav-tile focusable-row"
                      onKeyDown={(e) =>
                        handleTileKeyDown(
                          e,
                          `${data.tls!.certificate!.trust.status}: ${data.tls!.certificate!.trust.details}`,
                          'tls-trust'
                        )
                      }
                      onClick={() =>
                        void copyValue(
                          `${data.tls!.certificate!.trust.status}: ${data.tls!.certificate!.trust.details}`,
                          'tls-trust'
                        )
                      }
                    >
                      <div className="tile-badge-col">
                        <span className="tile-hdr-badge">TRUST</span>
                        <span
                          className={`auth-status-pill ${
                            data.tls.certificate.trust.trusted && data.tls.certificate.hostnameMatch
                              ? 'text-green'
                              : 'text-red'
                          }`}
                        >
                          {data.tls.certificate.trust.status}
                        </span>
                      </div>
                      <div className="tile-content-col">
                        <div className="tile-title-line">CA TRUST STORE &amp; HOSTNAME VERIFICATION</div>
                        <div className="tile-main-val">
                          <div>{data.tls.certificate.trust.details}</div>
                          <div className="mt-8">
                            <span className="dim-inline">Hostname Check ({data.hostname}): </span>
                            {data.tls.certificate.hostnameMatch ? (
                              <strong className="text-green">
                                ✓ VALID ({data.tls.certificate.matchedIdentity || data.hostname})
                              </strong>
                            ) : (
                              <strong className="text-red">✗ HOSTNAME MISMATCH</strong>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="tile-action-col">
                        <span className={`navy-btn btn-xs ${copiedKey === 'tls-trust' ? 'btn-copied' : ''}`}>
                          {copiedKey === 'tls-trust' ? '✓ COPIED' : 'COPY [C]'}
                        </span>
                      </div>
                    </div>

                    {/* PROTOCOL & CIPHER */}
                    <div
                      tabIndex={0}
                      className="nav-tile focusable-row"
                      onKeyDown={(e) =>
                        handleTileKeyDown(
                          e,
                          `${data.tls!.protocol} / ${data.tls!.cipher?.standardName || data.tls!.cipher?.name || ''}`,
                          'tls-cipher'
                        )
                      }
                      onClick={() =>
                        void copyValue(
                          `${data.tls!.protocol} / ${data.tls!.cipher?.standardName || data.tls!.cipher?.name || ''}`,
                          'tls-cipher'
                        )
                      }
                    >
                      <div className="tile-badge-col">
                        <span className="tile-hdr-badge">CIPHER</span>
                        <span className="auth-status-pill text-cyan">{data.tls.protocol}</span>
                      </div>
                      <div className="tile-content-col">
                        <div className="tile-title-line">NEGOTIATED PROTOCOL &amp; CIPHER SUITE</div>
                        <div className="tile-main-val">
                          <strong className="text-cyan">{data.tls.protocol}</strong> •{' '}
                          <code>{data.tls.cipher?.standardName || data.tls.cipher?.name || 'Unknown'}</code>
                          {data.tls.handshakeMs !== null && (
                            <span className="dim-inline"> ({data.tls.handshakeMs} ms handshake)</span>
                          )}
                        </div>
                      </div>
                      <div className="tile-action-col">
                        <span className={`navy-btn btn-xs ${copiedKey === 'tls-cipher' ? 'btn-copied' : ''}`}>
                          {copiedKey === 'tls-cipher' ? '✓ COPIED' : 'COPY [C]'}
                        </span>
                      </div>
                    </div>

                    {/* SUBJECT & ISSUER */}
                    <div
                      tabIndex={0}
                      className="nav-tile focusable-row"
                      onKeyDown={(e) =>
                        handleTileKeyDown(
                          e,
                          `Subject: ${formatDistinguishedName(
                            data.tls!.certificate!.subject
                          )} | Issuer: ${formatDistinguishedName(data.tls!.certificate!.issuer)}`,
                          'tls-subj'
                        )
                      }
                      onClick={() =>
                        void copyValue(
                          `Subject: ${formatDistinguishedName(
                            data.tls!.certificate!.subject
                          )} | Issuer: ${formatDistinguishedName(data.tls!.certificate!.issuer)}`,
                          'tls-subj'
                        )
                      }
                    >
                      <div className="tile-badge-col">
                        <span className="tile-hdr-badge">IDENTITY</span>
                        <span className="auth-status-pill text-gold">
                          {data.tls.certificate.isSelfSigned ? 'SELF-SIGNED' : 'CA-ISSUED'}
                        </span>
                      </div>
                      <div className="tile-content-col">
                        <div className="tile-title-line">CERTIFICATE SUBJECT &amp; ISSUING CA</div>
                        <div className="tile-main-val">
                          <div>
                            <span className="dim-inline">Subject: </span>
                            <strong className="text-gold">
                              {formatDistinguishedName(data.tls.certificate.subject)}
                            </strong>
                          </div>
                          <div>
                            <span className="dim-inline">Issuer: </span>
                            <span>{formatDistinguishedName(data.tls.certificate.issuer)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="tile-action-col">
                        <span className={`navy-btn btn-xs ${copiedKey === 'tls-subj' ? 'btn-copied' : ''}`}>
                          {copiedKey === 'tls-subj' ? '✓ COPIED' : 'COPY [C]'}
                        </span>
                      </div>
                    </div>

                    {/* VALIDITY & EXPIRATION */}
                    <div
                      tabIndex={0}
                      className="nav-tile focusable-row"
                      onKeyDown={(e) =>
                        handleTileKeyDown(
                          e,
                          `Valid From: ${data.tls!.certificate!.validFrom} -> Valid Until: ${
                            data.tls!.certificate!.validTo
                          } (${data.tls!.certificate!.daysRemaining} days remaining)`,
                          'tls-validity'
                        )
                      }
                      onClick={() =>
                        void copyValue(
                          `Valid From: ${data.tls!.certificate!.validFrom} -> Valid Until: ${
                            data.tls!.certificate!.validTo
                          } (${data.tls!.certificate!.daysRemaining} days remaining)`,
                          'tls-validity'
                        )
                      }
                    >
                      <div className="tile-badge-col">
                        <span className="tile-hdr-badge">EXPIRY</span>
                        <span
                          className={`auth-status-pill ${
                            data.tls.certificate.isExpired
                              ? 'text-red'
                              : data.tls.certificate.daysRemaining <= 14
                              ? 'text-gold'
                              : 'text-green'
                          }`}
                        >
                          {data.tls.certificate.isExpired
                            ? 'EXPIRED'
                            : `${data.tls.certificate.daysRemaining}d LEFT`}
                        </span>
                      </div>
                      <div className="tile-content-col">
                        <div className="tile-title-line">VALIDITY WINDOW</div>
                        <div className="tile-main-val">
                          <div>
                            <span className="dim-inline">Not Before: </span>
                            <code>{data.tls.certificate.validFrom}</code>
                          </div>
                          <div>
                            <span className="dim-inline">Not After:  </span>
                            <code
                              className={
                                data.tls.certificate.isExpired
                                  ? 'text-red'
                                  : data.tls.certificate.daysRemaining <= 14
                                  ? 'text-gold'
                                  : 'text-green'
                              }
                            >
                              {data.tls.certificate.validTo}
                            </code>{' '}
                            <span className="dim-inline">
                              (
                              {data.tls.certificate.isExpired
                                ? `Expired ${Math.abs(data.tls.certificate.daysRemaining)} days ago`
                                : `${data.tls.certificate.daysRemaining} days remaining`}
                              )
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="tile-action-col">
                        <span className={`navy-btn btn-xs ${copiedKey === 'tls-validity' ? 'btn-copied' : ''}`}>
                          {copiedKey === 'tls-validity' ? '✓ COPIED' : 'COPY [C]'}
                        </span>
                      </div>
                    </div>

                    {/* SAN LIST */}
                    <div
                      tabIndex={0}
                      className="nav-tile focusable-row"
                      onKeyDown={(e) =>
                        handleTileKeyDown(
                          e,
                          data.tls!.certificate!.sans.join(', ') || 'None',
                          'tls-sans'
                        )
                      }
                      onClick={() =>
                        void copyValue(data.tls!.certificate!.sans.join(', ') || 'None', 'tls-sans')
                      }
                    >
                      <div className="tile-badge-col">
                        <span className="tile-hdr-badge">SAN ({data.tls.certificate.sans.length})</span>
                      </div>
                      <div className="tile-content-col">
                        <div className="tile-title-line">SUBJECT ALTERNATIVE NAMES</div>
                        <div className="san-tags-grid">
                          {data.tls.certificate.sans.length > 0 ? (
                            data.tls.certificate.sans.map((san) => (
                              <span key={san} className="cap-tag">
                                {san}
                              </span>
                            ))
                          ) : (
                            <span className="dim-inline">No SAN extension present</span>
                          )}
                        </div>
                      </div>
                      <div className="tile-action-col">
                        <span className={`navy-btn btn-xs ${copiedKey === 'tls-sans' ? 'btn-copied' : ''}`}>
                          {copiedKey === 'tls-sans' ? '✓ COPIED' : 'COPY [C]'}
                        </span>
                      </div>
                    </div>

                    {/* KEY & FINGERPRINT */}
                    <div
                      tabIndex={0}
                      className="nav-tile focusable-row"
                      onKeyDown={(e) =>
                        handleTileKeyDown(
                          e,
                          data.tls!.certificate!.fingerprint256,
                          'tls-fp'
                        )
                      }
                      onClick={() =>
                        void copyValue(data.tls!.certificate!.fingerprint256, 'tls-fp')
                      }
                    >
                      <div className="tile-badge-col">
                        <span className="tile-hdr-badge">KEY &amp; FP</span>
                        <span className="auth-status-pill text-cyan">
                          {data.tls.certificate.publicKey.type}
                        </span>
                      </div>
                      <div className="tile-content-col">
                        <div className="tile-title-line">PUBLIC KEY, SERIAL &amp; SHA-256 FINGERPRINT</div>
                        <div className="tile-main-val">
                          <div>
                            <span className="dim-inline">Public Key: </span>
                            <strong>
                              {data.tls.certificate.publicKey.type}
                              {data.tls.certificate.publicKey.details?.modulusLength
                                ? ` ${data.tls.certificate.publicKey.details.modulusLength}-bit`
                                : data.tls.certificate.publicKey.details?.namedCurve
                                ? ` (${data.tls.certificate.publicKey.details.namedCurve})`
                                : ''}
                            </strong>
                            <span className="dim-inline"> • Serial: {data.tls.certificate.serialNumber}</span>
                          </div>
                          <div>
                            <span className="dim-inline">SHA-256: </span>
                            <code>{data.tls.certificate.fingerprint256}</code>
                          </div>
                        </div>
                      </div>
                      <div className="tile-action-col">
                        <span className={`navy-btn btn-xs ${copiedKey === 'tls-fp' ? 'btn-copied' : ''}`}>
                          {copiedKey === 'tls-fp' ? '✓ COPIED' : 'COPY [C]'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* SERVER-SENT CHAIN SUMMARY */}
                  {data.tls.certificate.chainSummary.length > 0 && (
                    <div className="mt-8">
                      <div className="tile-title-line" style={{ marginBottom: '6px' }}>
                        SERVER-PRESENTED CERTIFICATE CHAIN ({data.tls.certificate.wireChainCount} CERT
                        {data.tls.certificate.wireChainCount === 1 ? '' : 'S'} ON WIRE)
                      </div>
                      <div className="hops-timeline">
                        {data.tls.certificate.chainSummary.map((node) => (
                          <div key={`${node.depth}-${node.fingerprint256}`} className="hop-row">
                            <div className="hop-badge-col">
                              <span className="hop-badge">
                                #{node.depth} {node.depth === 0 ? 'LEAF' : node.isSelfSigned ? 'ROOT' : 'INT CA'}
                              </span>
                            </div>
                            <div className="hop-info-col">
                              <div className="hop-route-line">
                                <strong className="text-cyan">
                                  {formatDistinguishedName(node.subject)}
                                </strong>
                              </div>
                              <div className="hop-meta-line">
                                <span>Issuer: {formatDistinguishedName(node.issuer)}</span>
                                <span>Valid Until: {node.validTo}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : null}
            </CopyableIntelSection>
          )}

          {activeTab === 'tls' && !data.tls && (
            <div className="empty-prompt clean-box">
              This probe ran over plain TCP/HTTP (port <code>{data.port}</code>) without an SSL/TLS handshake.{' '}
              <button
                type="button"
                className="navy-btn btn-xs"
                onClick={() => {
                  setPortInput('443');
                  setTlsMode('tls');
                  void runProbe({ port: '443', tlsMode: 'tls' });
                }}
              >
                ► PROBE PORT 443 WITH TLS
              </button>
            </div>
          )}

          {/* 3. HTTP RESPONSE & SECURITY HEADERS */}
          {(activeTab === 'all' || activeTab === 'headers') && data.http && (
            <CopyableIntelSection
              title="3. HTTP RESPONSE & SECURITY HEADERS"
              badge={`${data.http.headers.length} HEADERS`}
              copyPayload={sectionPayloads.headers}
            >
              {/* SECURITY HEADER POSTURE PILLS */}
              <div className="san-tags-grid" style={{ marginBottom: '6px' }}>
                <span className="cap-tag">
                  HSTS:{' '}
                  <strong className={data.http.securityHeaders.hsts ? 'text-green' : 'text-gold'}>
                    {data.http.securityHeaders.hsts ? 'PRESENT' : 'MISSING'}
                  </strong>
                </span>
                <span className="cap-tag">
                  CSP:{' '}
                  <strong className={data.http.securityHeaders.csp ? 'text-green' : 'dim-inline'}>
                    {data.http.securityHeaders.csp ? 'PRESENT' : 'NONE'}
                  </strong>
                </span>
                <span className="cap-tag">
                  X-FRAME-OPTIONS:{' '}
                  <strong className={data.http.securityHeaders.xFrameOptions ? 'text-green' : 'dim-inline'}>
                    {data.http.securityHeaders.xFrameOptions || 'NONE'}
                  </strong>
                </span>
                <span className="cap-tag">
                  X-CONTENT-TYPE:{' '}
                  <strong
                    className={data.http.securityHeaders.xContentTypeOptions ? 'text-green' : 'dim-inline'}
                  >
                    {data.http.securityHeaders.xContentTypeOptions || 'NONE'}
                  </strong>
                </span>
                <span className="cap-tag">
                  REFERRER-POLICY:{' '}
                  <strong className={data.http.securityHeaders.referrerPolicy ? 'text-green' : 'dim-inline'}>
                    {data.http.securityHeaders.referrerPolicy || 'NONE'}
                  </strong>
                </span>
              </div>

              <div className="horizontal-tiles-list">
                {data.http.headers.map((hdr, idx) => {
                  const rowKey = `hdr-${idx}-${hdr.name}`;
                  return (
                    <div
                      key={rowKey}
                      tabIndex={0}
                      className="nav-tile focusable-row"
                      onKeyDown={(e) => handleTileKeyDown(e, `${hdr.name}: ${hdr.value}`, rowKey)}
                      onClick={() => void copyValue(`${hdr.name}: ${hdr.value}`, rowKey)}
                    >
                      <div className="tile-badge-col">
                        <span className="tile-hdr-badge">{hdr.name.toUpperCase()}</span>
                      </div>
                      <div className="tile-content-col">
                        <div className="tile-main-val">
                          <code>{hdr.value}</code>
                        </div>
                      </div>
                      <div className="tile-action-col">
                        <span className={`navy-btn btn-xs ${copiedKey === rowKey ? 'btn-copied' : ''}`}>
                          {copiedKey === rowKey ? '✓ COPIED' : 'COPY [C]'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CopyableIntelSection>
          )}

          {activeTab === 'headers' && !data.http && (
            <div className="empty-prompt clean-box">
              No HTTP headers were returned on this probe ({data.reachability}).
            </div>
          )}
        </>
      )}
    </div>
  );
};
