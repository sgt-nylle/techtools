import React, { useState, useEffect, useCallback } from 'react';
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

  const handleCopyIp = async () => {
    if (!data?.ip) return;
    try {
      await navigator.clipboard.writeText(data.ip);
      sound.playCopy();
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      sound.playError();
    }
  };

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
            <div className="ip-hero-card c64-box">
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
                    className={`navy-btn btn-gold ${copied ? 'btn-copied' : ''}`}
                    onClick={handleCopyIp}
                  >
                    {copied ? '✓ IP COPIED' : '📋 COPY IP'}
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
                      ◄ BACK TO MY IP
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
            <section className="intel-section c64-box">
              <div className="section-title-row">
                <h3 className="section-title">► IP RANGE OWNER, BGP PREFIX &amp; ASN REGISTRY</h3>
                {data.network.rir && <span className="ttl-pill">RIR: {data.network.rir}</span>}
              </div>

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
                  <button
                    type="button"
                    className="navy-btn btn-sm"
                    onClick={() => {
                      sound.playClick();
                      setShowRawRir((v) => !v);
                    }}
                  >
                    {showRawRir ? '▼ HIDE RAW RIR WHOIS ATTRIBUTES' : '► VIEW RAW RIR WHOIS ATTRIBUTES'}
                  </button>
                  {showRawRir && (
                    <pre className="raw-pre-box">
                      {data.network.rawAttributes
                        .map((attr) => `${attr.key.padEnd(18, ' ')}: ${attr.value}`)
                        .join('\n')}
                    </pre>
                  )}
                </div>
              )}
            </section>

            {/* CLIENT CONNECTION TELEMETRY (Shown when viewing own IP) */}
            {data.clientMeta && (
              <section className="intel-section c64-box">
                <h3 className="section-title">► CLIENT HTTP CONNECTION HEADERS</h3>
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
              </section>
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
          <span className="prompt-chevron">IP&gt;</span>
          <input
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
            ► INSPECT IP
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
            ⟳ MY IP
          </button>
        </div>
      </form>
    </div>
  );
};

export default MyIpTool;
