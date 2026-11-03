import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { CopyableIntelSection } from '../components/CopyableIntelSection';
import { sound } from '../utils/audio';

interface IpLookupPayload {
  ip: string;
  ipVersion: 'IPv4' | 'IPv6';
  isCustomTarget: boolean;
  resolvedFromHost: string | null;
  isLocalClient: boolean;
  clientSocketIp: string;
  ptr: string[];
  network: {
    prefix: string;
    ipRange: string;
    netname: string;
    organization: string;
    descriptions: string[];
    country: string;
    rir: string;
    asn: string;
    asnHolder: string;
    abuseContact: string;
    status: string;
    lastModified: string;
    rawAttributes: Array<{ key: string; value: string }>;
  };
  clientMeta: {
    userAgent: string;
    acceptLanguage: string;
    forwardedProto: string;
    host: string;
  } | null;
  durationMs: number;
}

export const MyIpTool: React.FC = () => {
  const [data, setData] = useState<IpLookupPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [customTarget, setCustomTarget] = useState<string>('');
  const [showRawRir, setShowRawRir] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [copiedRawRir, setCopiedRawRir] = useState<boolean>(false);
  const customInputRef = useRef<HTMLInputElement>(null);

  const fetchIpIntel = useCallback(async (target?: string) => {
    setLoading(true);
    setError(null);
    const trimmed = (target ?? '').trim();
    const url = trimmed ? `/api/ip?target=${encodeURIComponent(trimmed)}` : '/api/ip';

    try {
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'IP lookup failed.');
        sound.playError();
      } else {
        setData(json as IpLookupPayload);
        setShowRawRir(false);
      }
    } catch {
      setError('Unable to reach IP telemetry endpoint.');
      sound.playError();
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/ip')
      .then(async (res) => {
        const json = await res.json();
        if (!active) return;
        if (!res.ok) {
          setError(json.error || 'IP lookup failed.');
        } else {
          setData(json as IpLookupPayload);
        }
      })
      .catch(() => {
        if (active) setError('Unable to reach IP telemetry endpoint.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleCopyIp = useCallback(async () => {
    if (!data?.ip) return;
    try {
      await navigator.clipboard.writeText(data.ip);
      sound.playCopy();
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      sound.playError();
    }
  }, [data]);

  const rawRirText = useMemo(() => {
    if (!data?.network.rawAttributes.length) return '';
    return data.network.rawAttributes
      .map((attr) => `${attr.key.padEnd(18, ' ')}: ${attr.value}`)
      .join('\n');
  }, [data]);

  const handleCopyRawRir = useCallback(async () => {
    if (!rawRirText) return;
    try {
      await navigator.clipboard.writeText(rawRirText);
      sound.playCopy();
      setCopiedRawRir(true);
      window.setTimeout(() => setCopiedRawRir(false), 1600);
    } catch {
      sound.playError();
    }
  }, [rawRirText]);

  // Single-letter shortcuts for What's My IP / RIR Range Owner tool
  useEffect(() => {
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
        customInputRef.current?.focus();
        customInputRef.current?.select();
        return;
      }

      if (k === 'm') {
        e.preventDefault();
        if (!loading) {
          sound.playBlip();
          setCustomTarget('');
          void fetchIpIntel('');
        }
        return;
      }

      if (k === 'r') {
        e.preventDefault();
        if (!loading) {
          sound.playRadarPing();
          void fetchIpIntel(customTarget);
        }
        return;
      }

      if (k === 'c' && data?.ip) {
        e.preventDefault();
        void handleCopyIp();
        return;
      }

      if (k === 'v' && data?.network.rawAttributes.length) {
        e.preventDefault();
        sound.playClick();
        setShowRawRir((v) => !v);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [data, loading, customTarget, fetchIpIntel, handleCopyIp]);

  const { rangeCopyPayload, headersCopyPayload } = useMemo(() => {
    if (!data) return { rangeCopyPayload: '', headersCopyPayload: '' };

    const rangeLines: string[] = [
      `=== IP RANGE OWNER, BGP PREFIX & ASN REGISTRY (${data.ip}) ===`,
      `IP Address: ${data.ip} (${data.ipVersion})`,
      `Reverse DNS (PTR): ${data.ptr.length > 0 ? data.ptr.join(', ') : '(None)'}`,
      `ISP / Organization: ${data.network.organization || data.network.asnHolder || 'Unknown'}`,
      `ASN: ${
        data.network.asn
          ? `${data.network.asn}${data.network.asnHolder ? ` — ${data.network.asnHolder}` : ''}`
          : 'Unannounced'
      }`,
      `Allocated IP Range: ${data.network.ipRange || '—'}`,
      `BGP Routed Prefix: ${data.network.prefix || '—'}`,
      `Netname: ${data.network.netname || '—'}`,
      `Country: ${data.network.country || '—'}`,
      `RIR: ${data.network.rir || '—'}`,
      `Status: ${data.network.status || 'ALLOCATED'}`,
      `Abuse Contact: ${data.network.abuseContact || '—'}`,
    ];

    if (data.network.descriptions.length > 0) {
      rangeLines.push(`Descriptions: ${data.network.descriptions.join(' | ')}`);
    }
    if (showRawRir && rawRirText) {
      rangeLines.push('', '--- RAW RIR WHOIS ATTRIBUTES ---', rawRirText);
    }

    const headerLines: string[] = [];
    if (data.clientMeta) {
      headerLines.push(
        '=== CLIENT HTTP CONNECTION HEADERS ===',
        `Host / Protocol: ${data.clientMeta.forwardedProto}://${data.clientMeta.host}`,
        `Accept-Language: ${data.clientMeta.acceptLanguage}`,
        `User-Agent: ${data.clientMeta.userAgent}`
      );
    }

    return {
      rangeCopyPayload: rangeLines.join('\n'),
      headersCopyPayload: headerLines.join('\n'),
    };
  }, [data, showRawRir, rawRirText]);

  return (
    <div className="tool-panel">
      {/* HERO PUBLIC IP DISPLAY */}
      {loading ? (
        <div className="loading-radar c64-box">
          <span className="radar-spinner">◎</span> ACQUIRING PUBLIC IP &amp; RIR ALLOCATION TELEMETRY...
        </div>
      ) : error ? (
        <div className="alert-banner status-err c64-box">⚠ {error}</div>
      ) : (
        data && (
          <>
            <div
              tabIndex={0}
              className={`ip-hero-card copyable-section c64-box ${copied ? 'section-just-copied' : ''}`}
              aria-label={`Public IP ${data.ip} — Press C to copy IP`}
              onKeyDown={(e) => {
                if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'c' || e.key === 'C')) {
                  e.preventDefault();
                  e.stopPropagation();
                  void handleCopyIp();
                }
              }}
            >
              <div className="ip-hero-top">
                <span className="ip-hero-tag">
                  {data.isCustomTarget
                    ? `TARGET TELEMETRY${data.resolvedFromHost ? ` (${data.resolvedFromHost})` : ''}`
                    : 'YOUR DETECTED PUBLIC IP ADDRESS'}
                </span>
                <span className="ttl-pill">
                  {data.ipVersion} • {data.durationMs} ms
                </span>
              </div>

              <div className="ip-hero-main">
                <code className="ip-giant-readout">{data.ip}</code>
                <div className="ip-hero-actions">
                  <button
                    type="button"
                    tabIndex={-1}
                    className={`navy-btn section-copy-btn ${copied ? 'btn-copied' : ''}`}
                    onClick={() => void handleCopyIp()}
                  >
                    {copied ? '✓ IP COPIED' : '📋 COPY IP [C]'}
                  </button>
                  {data.isCustomTarget && (
                    <button
                      type="button"
                      className="navy-btn"
                      onClick={() => {
                        sound.playBlip();
                        setCustomTarget('');
                        void fetchIpIntel('');
                      }}
                    >
                      ◄ BACK TO MY IP [M]
                    </button>
                  )}
                </div>
              </div>

              {data.isLocalClient && !data.isCustomTarget && (
                <div className="local-dev-notice">
                  ℹ Connected from local socket <code>{data.clientSocketIp}</code> — displaying outbound WAN public IP
                  for live ISP range inspection.
                </div>
              )}

              <div className="ip-ptr-line">
                <span className="tele-lbl">REVERSE DNS (PTR):</span>{' '}
                <code className="text-cyan">
                  {data.ptr.length > 0 ? data.ptr.join(', ') : '(No reverse PTR record published)'}
                </code>
              </div>
            </div>

            {/* NETWORK OWNER / ASN / RIR RANGE DETAILS */}
            <CopyableIntelSection
              title="► IP RANGE OWNER, BGP PREFIX & ASN REGISTRY"
              badge={data.network.rir ? `RIR: ${data.network.rir}` : null}
              copyPayload={rangeCopyPayload}
            >
              <div className="whois-grid">
                <div className="whois-item">
                  <span className="tele-lbl">ISP / ORGANIZATION OWNER</span>
                  <span className="tele-val text-gold">
                    {data.network.organization || data.network.asnHolder || 'Unknown'}
                  </span>
                </div>
                <div className="whois-item">
                  <span className="tele-lbl">AUTONOMOUS SYSTEM (ASN)</span>
                  <span className="tele-val text-cyan">
                    {data.network.asn
                      ? `${data.network.asn}${data.network.asnHolder ? ` — ${data.network.asnHolder}` : ''}`
                      : 'Unannounced'}
                  </span>
                </div>
                <div className="whois-item">
                  <span className="tele-lbl">ALLOCATED IP RANGE</span>
                  <span className="tele-val">{data.network.ipRange || '—'}</span>
                </div>
                <div className="whois-item">
                  <span className="tele-lbl">BGP ROUTED PREFIX (CIDR)</span>
                  <span className="tele-val text-cyan">{data.network.prefix || '—'}</span>
                </div>
                <div className="whois-item">
                  <span className="tele-lbl">NETNAME</span>
                  <span className="tele-val">{data.network.netname || '—'}</span>
                </div>
                <div className="whois-item">
                  <span className="tele-lbl">COUNTRY / JURISDICTION</span>
                  <span className="tele-val text-gold">{data.network.country || '—'}</span>
                </div>
                <div className="whois-item">
                  <span className="tele-lbl">ALLOCATION STATUS</span>
                  <span className="tele-val status-ok">{data.network.status || 'ALLOCATED'}</span>
                </div>
                <div className="whois-item">
                  <span className="tele-lbl">ABUSE CONTACT</span>
                  <span className="tele-val">{data.network.abuseContact || '—'}</span>
                </div>
              </div>

              {data.network.descriptions.length > 1 && (
                <div className="sub-card mt-8">
                  <div className="sub-card-hdr">REGISTRY DESCRIPTIONS</div>
                  {data.network.descriptions.map((desc, idx) => (
                    <div key={`desc-${idx}`} className="kv-row">
                      <span>{desc}</span>
                    </div>
                  ))}
                </div>
              )}

              {data.network.rawAttributes.length > 0 && (
                <div className="mt-8">
                  <div className="raw-actions-row">
                    <button
                      type="button"
                      className="navy-btn btn-sm"
                      onClick={() => {
                        sound.playClick();
                        setShowRawRir((v) => !v);
                      }}
                    >
                      {showRawRir ? '▼ HIDE RAW RIR WHOIS [V]' : '► VIEW RAW RIR WHOIS [V]'}
                    </button>
                    {showRawRir && (
                      <button
                        type="button"
                        tabIndex={-1}
                        className={`navy-btn btn-xs ${copiedRawRir ? 'btn-copied' : ''}`}
                        onClick={() => void handleCopyRawRir()}
                      >
                        {copiedRawRir ? '✓ COPIED RAW RIR!' : '📋 COPY RAW RIR [TAB + C]'}
                      </button>
                    )}
                  </div>
                  {showRawRir && (
                    <pre
                      tabIndex={0}
                      className={`raw-pre-box copyable-pre ${copiedRawRir ? 'row-copied' : ''}`}
                      aria-label="Raw RIR WHOIS attributes — Press C to copy raw RIR output"
                      onKeyDown={(e) => {
                        if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'c' || e.key === 'C')) {
                          e.preventDefault();
                          e.stopPropagation();
                          void handleCopyRawRir();
                        }
                      }}
                    >
                      {rawRirText}
                    </pre>
                  )}
                </div>
              )}
            </CopyableIntelSection>

            {/* CLIENT CONNECTION TELEMETRY (Shown when viewing own IP) */}
            {data.clientMeta && (
              <CopyableIntelSection
                title="► CLIENT HTTP CONNECTION HEADERS"
                copyPayload={headersCopyPayload}
              >
                <div className="soa-list">
                  <div>
                    <strong>HOST / PROTOCOL:</strong>{' '}
                    <code>
                      {data.clientMeta.forwardedProto}://{data.clientMeta.host}
                    </code>
                  </div>
                  <div>
                    <strong>ACCEPT-LANGUAGE:</strong> <code>{data.clientMeta.acceptLanguage}</code>
                  </div>
                  <div>
                    <strong>USER-AGENT:</strong> <code className="code-wrap-inline">{data.clientMeta.userAgent}</code>
                  </div>
                </div>
              </CopyableIntelSection>
            )}
          </>
        )
      )}

      {/* BONUS EXTERNAL IP / HOST INSPECTOR */}
      <form
        className="query-bar c64-box"
        onSubmit={(e) => {
          e.preventDefault();
          sound.playRadarPing();
          void fetchIpIntel(customTarget);
        }}
      >
        <div className="query-input-group">
          <span className="prompt-chevron" title="Press [Q] to focus input">
            IP [Q]&gt;
          </span>
          <input
            ref={customInputRef}
            type="text"
            value={customTarget}
            onChange={(e) => setCustomTarget(e.target.value)}
            placeholder="Inspect another IP or host (e.g. 1.1.1.1, 8.8.8.8, subwrite.se)"
            className="navy-input"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <button type="submit" disabled={loading} className="navy-btn btn-primary">
            ► INSPECT [R]
          </button>
          <button
            type="button"
            disabled={loading}
            className="navy-btn"
            onClick={() => {
              sound.playBlip();
              setCustomTarget('');
              void fetchIpIntel('');
            }}
          >
            ⟳ MY IP [M]
          </button>
        </div>
      </form>
    </div>
  );
};

export default MyIpTool;
