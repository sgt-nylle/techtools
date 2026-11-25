import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CopyableIntelSection } from '../components/CopyableIntelSection';
import { RadarMap, type RadarPoint } from '../components/RadarMap';
import { sound } from '../utils/audio';
import { useIsPaneActive } from '../utils/paneContext';

interface AnycastInfo {
  provider: string;
  kind: string;
  asn: number | null;
  matchedBy: 'ASN' | 'ORG';
}

interface GeoRecord {
  ip: string;
  version: 'IPv4' | 'IPv6';
  found: boolean;
  network: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  isEu: boolean;
  continent: string | null;
  continentCode: string | null;
  lat: number | null;
  lon: number | null;
  accuracyRadiusKm: number | null;
  timezone: string | null;
  timezoneSource: string | null;
  utcOffsetEstimate: number | null;
  asn: number | null;
  asOrg: string | null;
  anycast: AnycastInfo | null;
  ptr: string[];
}

interface EdgePop {
  code: string;
  city: string;
  countryCode: string;
  lat: number;
  lon: number;
}

interface EdgeInfo {
  kind: 'TARGET' | 'CLIENT_INGRESS';
  probed: boolean;
  url: string | null;
  ip: string | null;
  ok: boolean;
  status: number | null;
  error: string | null;
  durationMs: number;
  provider: string | null;
  popCode: string | null;
  popSourceHeader: string | null;
  pop: EdgePop | null;
  headers: Record<string, string>;
}

interface DbInfo {
  source: string;
  file: string;
  type: string;
  buildDate: string | null;
}

interface GeoPayload {
  mode: 'self' | 'ip' | 'domain';
  query: string | null;
  hostname: string | null;
  isLocalClient: boolean;
  primary: GeoRecord;
  ips: GeoRecord[];
  totalIps: number;
  resolved: { a: string[]; aaaa: string[] } | null;
  skippedNonPublic: string[];
  edge: EdgeInfo | null;
  databases: { city: DbInfo | null; asn: DbInfo | null };
  attribution: string;
  durationMs: number;
}

function formatCoord(lat: number | null, lon: number | null): string {
  if (lat == null || lon == null) return '—';
  return `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(4)}°${lon >= 0 ? 'E' : 'W'}`;
}

function formatPlace(r: Pick<GeoRecord, 'city' | 'region' | 'country' | 'countryCode'>): string {
  const parts = [r.city, r.region && r.region !== r.city ? r.region : null, r.country].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Unknown location';
}

function localTimeFor(r: GeoRecord): string | null {
  const now = new Date();
  try {
    if (r.utcOffsetEstimate != null) {
      const shifted = new Date(now.getTime() + r.utcOffsetEstimate * 3600_000);
      return `${shifted.toISOString().slice(11, 16)} (est.)`;
    }
    if (!r.timezone) return null;
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: r.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'short',
      timeZoneName: 'short',
    }).format(now);
  } catch {
    return null;
  }
}

/** Great-circle distance in km (haversine). */
function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const QUICK_TARGETS = ['subwrite.se', '1.1.1.1', 'www.amazon.com', 'www.fastly.com', '2001:4860:4860::8888'];

export const GeoRadarTool: React.FC = () => {
  const isPaneActive = useIsPaneActive();
  const [data, setData] = useState<GeoPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<string>('');
  const [showHeaders, setShowHeaders] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestSeq = useRef(0);

  const runLookup = useCallback(async (rawTarget?: string) => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    const trimmed = (rawTarget ?? '').trim();
    const url = trimmed ? `/api/geo?target=${encodeURIComponent(trimmed)}` : '/api/geo';
    try {
      const res = await fetch(url);
      const json = await res.json();
      if (seq !== requestSeq.current) return;
      if (!res.ok) {
        setError(json.error || 'Geolocation lookup failed.');
        sound.playError();
      } else {
        setData(json as GeoPayload);
        sound.playRadarPing();
      }
    } catch {
      if (seq === requestSeq.current) {
        setError('Unable to reach the GeoIP radar endpoint.');
        sound.playError();
      }
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  // Initial sweep: locate the caller's own public IP.
  useEffect(() => {
    let active = true;
    fetch('/api/geo')
      .then(async (res) => {
        const json = await res.json();
        if (!active) return;
        if (!res.ok) setError(json.error || 'Geolocation lookup failed.');
        else setData(json as GeoPayload);
      })
      .catch(() => {
        if (active) setError('Unable to reach the GeoIP radar endpoint.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const primary = data?.primary ?? null;
  const edge = data?.edge ?? null;
  const edgePop = edge?.pop ?? null;

  const vectorKm = useMemo(() => {
    if (!primary || primary.lat == null || primary.lon == null || !edgePop) return null;
    return Math.round(distanceKm(primary.lat, primary.lon, edgePop.lat, edgePop.lon));
  }, [primary, edgePop]);

  // HQ and edge POP in (practically) the same city: merge into one contact instead of two overlapping markers.
  const popCoLocated = vectorKm != null && vectorKm < 150;

  const radarTarget: RadarPoint | null = useMemo(() => {
    if (!primary || primary.lat == null || primary.lon == null) return null;
    const lbl = primary.city || primary.countryCode || primary.ip;
    if (edgePop && popCoLocated) return { lat: primary.lat, lon: primary.lon, label: `HQ + POP ${edgePop.code}: ${lbl}` };
    return { lat: primary.lat, lon: primary.lon, label: edgePop ? `HQ: ${lbl}` : lbl };
  }, [primary, edgePop, popCoLocated]);

  const radarEdge: RadarPoint | null = useMemo(() => {
    if (!edgePop || popCoLocated) return null;
    return { lat: edgePop.lat, lon: edgePop.lon, label: `POP ${edgePop.code}: ${edgePop.city}` };
  }, [edgePop, popCoLocated]);

  const radarExtras: RadarPoint[] = useMemo(() => {
    if (!data) return [];
    const seen = new Set<string>();
    if (primary?.lat != null && primary?.lon != null) seen.add(`${primary.lat},${primary.lon}`);
    return data.ips
      .slice(1)
      .filter((r) => r.lat != null && r.lon != null)
      .filter((r) => {
        const k = `${r.lat},${r.lon}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((r) => ({ lat: r.lat as number, lon: r.lon as number }));
  }, [data, primary]);

  const summaryText = useMemo(() => {
    if (!data || !primary) return '';
    const lines = [
      `=== GEOLOCATION RADAR CONTACT (${data.hostname || primary.ip}) ===`,
      `Target: ${data.mode === 'self' ? 'Your public IP' : data.query}`,
      `IP Address(es): ${data.ips.map((r) => r.ip).join(', ')}${data.totalIps > data.ips.length ? ` (+${data.totalIps - data.ips.length} more)` : ''}`,
      `Hostname (PTR): ${primary.ptr.length ? primary.ptr.join(', ') : '(none)'}`,
      `Location: ${formatPlace(primary)}${primary.countryCode ? ` [${primary.countryCode}]` : ''}`,
      `Continent: ${primary.continent || '—'}`,
      `Coordinates: ${formatCoord(primary.lat, primary.lon)}`,
      `Timezone: ${primary.timezone || '—'}${primary.timezoneSource ? ` (${primary.timezoneSource})` : ''}`,
      `ASN: ${primary.asn ? `AS${primary.asn}` : '—'}`,
      `Organization: ${primary.asOrg || '—'}`,
      `Network: ${primary.network || '—'}`,
      `Anycast / CDN: ${primary.anycast ? `YES — ${primary.anycast.provider} (${primary.anycast.kind})` : 'No (unicast)'}`,
    ];
    if (edge) {
      lines.push(
        `Edge Provider: ${edge.provider || 'Not detected'}`,
        `Edge POP: ${edgePop ? `${edgePop.code} — ${edgePop.city}, ${edgePop.countryCode}` : edge.popCode || 'Not exposed'}${
          edge.popSourceHeader ? ` (via ${edge.popSourceHeader})` : ''
        }`
      );
      if (vectorKm != null) lines.push(`HQ ↔ POP vector: ${vectorKm.toLocaleString('en-US')} km`);
    }
    lines.push(`Source: ${data.attribution}`);
    return lines.join('\n');
  }, [data, primary, edge, edgePop, vectorKm]);

  const edgeCopyText = useMemo(() => {
    if (!edge) return '';
    const lines = [
      `=== CDN EDGE POP TELEMETRY ===`,
      `Mode: ${edge.kind === 'CLIENT_INGRESS' ? 'Your Cloudflare ingress POP' : `HEAD ${edge.url} → ${edge.ip}`}`,
      `Provider: ${edge.provider || 'Not detected'}`,
      `POP: ${edgePop ? `${edgePop.code} — ${edgePop.city}, ${edgePop.countryCode} (${formatCoord(edgePop.lat, edgePop.lon)})` : edge.popCode || 'Not exposed'}`,
    ];
    if (edge.probed) lines.push(`HEAD: ${edge.ok ? `HTTP ${edge.status}` : `FAILED (${edge.error})`} in ${edge.durationMs} ms`);
    Object.entries(edge.headers).forEach(([k, v]) => lines.push(`${k}: ${v}`));
    return lines.join('\n');
  }, [edge, edgePop]);

  const ipTableText = useMemo(() => {
    if (!data || data.ips.length < 2) return '';
    return [
      `=== RESOLVED ADDRESSES (${data.hostname}) ===`,
      ...data.ips.map(
        (r) =>
          `${r.ip.padEnd(40)} ${r.version}  ${formatPlace(r)}  ${r.asn ? `AS${r.asn}` : ''} ${r.asOrg || ''}${
            r.anycast ? '  [ANYCAST]' : ''
          }`
      ),
    ].join('\n');
  }, [data]);

  const copySummary = useCallback(async () => {
    if (!summaryText) return;
    try {
      await navigator.clipboard.writeText(summaryText);
      sound.playCopy();
    } catch {
      sound.playError();
    }
  }, [summaryText]);

  // Keyboard shortcuts scoped to the active pane
  useEffect(() => {
    if (!isPaneActive) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const typing =
        (el?.tagName === 'INPUT' &&
          (el as HTMLInputElement).type !== 'checkbox' &&
          (el as HTMLInputElement).type !== 'range') ||
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
        if (!loading) void runLookup(target);
      } else if (k === 'm') {
        e.preventDefault();
        if (!loading) {
          setTarget('');
          void runLookup('');
        }
      } else if (k === 'c' && summaryText) {
        e.preventDefault();
        void copySummary();
      } else if (k === 'h' && edge && Object.keys(edge.headers).length > 0) {
        e.preventDefault();
        sound.playClick();
        setShowHeaders((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPaneActive, loading, target, runLookup, summaryText, copySummary, edge]);

  const contactTitle = !data
    ? 'ACQUIRING CONTACT…'
    : data.mode === 'self'
      ? 'YOUR PUBLIC IP'
      : data.mode === 'domain'
        ? `DOMAIN: ${data.hostname}`
        : `IP: ${primary?.ip}`;

  return (
    <div className="tool-panel geo-radar-panel">
      {/* QUERY BAR */}
      <form
        className="query-bar clean-box"
        onSubmit={(e) => {
          e.preventDefault();
          void runLookup(target);
        }}
      >
        <div className="query-input-group">
          <span className="prompt-chevron" title="Press [Q] to focus input">
            GEO [Q]&gt;
          </span>
          <input
            ref={inputRef}
            type="text"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="IPv4, IPv6 or domain (empty = your IP) — e.g. subwrite.se, 1.1.1.1 (ESC unlocks shortcuts)"
            className="navy-input"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <button type="submit" disabled={loading} className="navy-btn btn-primary">
            ► LOCATE [R]
          </button>
          <button
            type="button"
            disabled={loading}
            className="navy-btn"
            onClick={() => {
              sound.playBlip();
              setTarget('');
              void runLookup('');
            }}
          >
            ⟳ MY IP [M]
          </button>
        </div>
        <div className="geo-quick-targets">
          <span className="tele-lbl">QUICK CONTACTS:</span>
          {QUICK_TARGETS.map((q) => (
            <button
              key={q}
              type="button"
              className="navy-btn btn-xs"
              disabled={loading}
              onClick={() => {
                sound.playClick();
                setTarget(q);
                void runLookup(q);
              }}
            >
              {q}
            </button>
          ))}
        </div>
      </form>

      {error && <div className="alert-banner status-err clean-box">⚠ {error}</div>}

      {/* RADAR + READOUT */}
      <div className="geo-radar-grid">
        <div className="geo-radar-scope clean-box">
          <div className="geo-scope-hdr">
            <span className="tele-lbl">► PPI RADAR // EQUIRECTANGULAR 1:110M</span>
            <span className="ttl-pill">
              {loading ? 'SWEEPING…' : data ? `${data.durationMs} ms` : 'STANDBY'}
            </span>
          </div>
          <div className="geo-scope-stage">
            <RadarMap target={radarTarget} edge={radarEdge} extras={radarExtras} scanning={loading} />
            {loading && <div className="geo-scope-overlay">◎ ACQUIRING CONTACT…</div>}
          </div>
          <div className="geo-scope-legend">
            <span>
              <i className="legend-dot legend-target" />{' '}
              {edgePop ? (popCoLocated ? `IP REGISTRY HQ = EDGE POP ${edgePop.code}` : 'IP REGISTRY HQ') : 'CONTACT'}
            </span>
            {edgePop && !popCoLocated && (
              <span>
                <i className="legend-dot legend-edge" /> ACTIVE EDGE POP
              </span>
            )}
            {edgePop && !popCoLocated && (
              <span>
                <i className="legend-line" /> VECTOR{vectorKm != null ? ` ${vectorKm.toLocaleString('en-US')} km` : ''}
              </span>
            )}
            {radarExtras.length > 0 && (
              <span>
                <i className="legend-dot legend-extra" /> +{radarExtras.length} ADDR
              </span>
            )}
            <span className="geo-scope-coord">{primary ? formatCoord(primary.lat, primary.lon) : '—'}</span>
          </div>
        </div>

        <section
          tabIndex={0}
          className="geo-readout copyable-section clean-box"
          aria-label="Geolocation contact readout — press C to copy"
          onKeyDown={(e) => {
            if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'c' || e.key === 'C')) {
              e.preventDefault();
              e.stopPropagation();
              void copySummary();
            }
          }}
        >
          <div className="section-title-row">
            <h3 className="section-title">► CONTACT READOUT</h3>
            <div className="section-header-right">
              <button type="button" tabIndex={-1} className="navy-btn btn-xs" onClick={() => void copySummary()}>
                📋 COPY [C]
              </button>
            </div>
          </div>
          <div className="geo-contact-title text-gold">{contactTitle}</div>
          {data?.isLocalClient && data.mode === 'self' && (
            <div className="local-dev-notice">ℹ Local socket detected — showing the server's outbound WAN IP.</div>
          )}
          {primary ? (
            <dl className="geo-readout-list">
              <dt>IP ADDRESS{data && data.ips.length > 1 ? 'ES' : ''}</dt>
              <dd className="text-cyan">
                {data?.ips.slice(0, 4).map((r) => (
                  <code key={r.ip} className="geo-ip-chip">
                    {r.ip}
                  </code>
                ))}
                {data && data.totalIps > 4 && <span className="dim-note"> +{data.totalIps - 4} more</span>}
              </dd>
              <dt>HOSTNAME (PTR)</dt>
              <dd>{primary.ptr.length ? primary.ptr.join(', ') : <span className="dim-note">(no PTR record)</span>}</dd>
              <dt>CITY / REGION</dt>
              <dd className="text-gold">{[primary.city, primary.region].filter(Boolean).join(', ') || '—'}</dd>
              <dt>COUNTRY</dt>
              <dd>
                {primary.country || '—'}
                {primary.countryCode && <span className="geo-cc">{primary.countryCode}</span>}
                {primary.isEu && <span className="geo-cc">EU</span>}
                {primary.continent && <span className="dim-note"> • {primary.continent}</span>}
              </dd>
              <dt>COORDINATES</dt>
              <dd className="text-cyan">{formatCoord(primary.lat, primary.lon)}</dd>
              <dt>TIMEZONE</dt>
              <dd>
                {primary.timezone || '—'}
                {localTimeFor(primary) && <span className="dim-note"> • {localTimeFor(primary)}</span>}
                {primary.timezoneSource && primary.timezoneSource !== 'DATABASE' && (
                  <span className="geo-src-tag">{primary.timezoneSource}</span>
                )}
              </dd>
              <dt>ASN</dt>
              <dd className="text-cyan">{primary.asn ? `AS${primary.asn}` : '—'}</dd>
              <dt>ORGANIZATION</dt>
              <dd className="text-gold">{primary.asOrg || '—'}</dd>
              <dt>NETWORK</dt>
              <dd>{primary.network || '—'}</dd>
              <dt>ANYCAST / CDN</dt>
              <dd>
                {primary.anycast ? (
                  <span className="status-warn">
                    ◉ YES — {primary.anycast.provider} <span className="dim-note">({primary.anycast.kind})</span>
                  </span>
                ) : (
                  <span className="status-ok">○ NO — UNICAST</span>
                )}
              </dd>
              <dt>EDGE POP</dt>
              <dd>
                {edge ? (
                  edgePop ? (
                    <span className="text-gold">
                      ◆ {edgePop.code} — {edgePop.city}, {edgePop.countryCode}
                      <span className="dim-note"> via {edge.popSourceHeader}</span>
                    </span>
                  ) : (
                    <span className="dim-note">
                      {edge.provider ? `${edge.provider} — POP not exposed` : edge.ok ? 'No CDN edge headers' : `HEAD failed (${edge.error})`}
                    </span>
                  )
                ) : (
                  <span className="dim-note">{data?.mode === 'domain' ? '—' : 'N/A (domain targets only)'}</span>
                )}
              </dd>
            </dl>
          ) : (
            !loading && !error && <div className="dim-note">No contact.</div>
          )}
          {primary && primary.anycast && !edgePop && (
            <div className="geo-anycast-note">
              ⚠ Anycast address: the registry location ({primary.city || primary.countryCode || 'HQ'}) is where the
              block is registered — traffic is actually served by the nearest {primary.anycast.provider} edge.
            </div>
          )}
        </section>
      </div>

      {/* EDGE POP TELEMETRY */}
      {edge && (
        <CopyableIntelSection
          title={edge.kind === 'CLIENT_INGRESS' ? '► YOUR CDN INGRESS POP' : '► CDN EDGE POP TELEMETRY'}
          badge={edge.probed ? (edge.ok ? `HEAD ${edge.status} • ${edge.durationMs} ms` : 'HEAD FAILED') : 'INBOUND CF-RAY'}
          copyPayload={edgeCopyText}
        >
          <div className="whois-grid">
            <div className="whois-item">
              <span className="tele-lbl">EDGE PROVIDER</span>
              <span className="tele-val text-gold">{edge.provider || 'Not detected'}</span>
            </div>
            <div className="whois-item">
              <span className="tele-lbl">ACTIVE POP (IATA)</span>
              <span className="tele-val text-cyan">
                {edgePop ? `${edgePop.code} — ${edgePop.city}, ${edgePop.countryCode}` : edge.popCode || 'Not exposed'}
              </span>
            </div>
            <div className="whois-item">
              <span className="tele-lbl">POP SOURCE HEADER</span>
              <span className="tele-val">{edge.popSourceHeader || '—'}</span>
            </div>
            <div className="whois-item">
              <span className="tele-lbl">HQ ↔ POP VECTOR</span>
              <span className="tele-val">
                {vectorKm != null ? `${vectorKm.toLocaleString('en-US')} km` : '—'}
              </span>
            </div>
            {edge.probed && (
              <div className="whois-item">
                <span className="tele-lbl">HEAD PROBE</span>
                <span className={`tele-val ${edge.ok ? 'status-ok' : 'status-err'}`}>
                  {edge.ok ? `HTTP ${edge.status}` : edge.error} • {edge.ip}
                </span>
              </div>
            )}
          </div>
          {Object.keys(edge.headers).length > 0 && (
            <div className="mt-8">
              <button
                type="button"
                className="navy-btn btn-sm"
                onClick={() => {
                  sound.playClick();
                  setShowHeaders((v) => !v);
                }}
              >
                {showHeaders ? '▼ HIDE EDGE HEADERS [H]' : `► VIEW EDGE HEADERS (${Object.keys(edge.headers).length}) [H]`}
              </button>
              {showHeaders && (
                <table className="headers-table mt-8">
                  <tbody>
                    {Object.entries(edge.headers).map(([k, v]) => (
                      <tr key={k}>
                        <td className="hdr-name text-cyan">{k}</td>
                        <td className="hdr-val code-wrap-inline">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </CopyableIntelSection>
      )}

      {/* RESOLVED ADDRESS TABLE */}
      {data && data.ips.length > 1 && (
        <CopyableIntelSection
          title="► RESOLVED ADDRESSES (A / AAAA)"
          badge={`${data.resolved?.a.length ?? 0} A • ${data.resolved?.aaaa.length ?? 0} AAAA`}
          copyPayload={ipTableText}
        >
          <div className="geo-ip-table-wrap">
            <table className="headers-table geo-ip-table">
              <thead>
                <tr>
                  <th>ADDRESS</th>
                  <th>LOCATION</th>
                  <th>ASN / ORG</th>
                  <th>ANYCAST</th>
                </tr>
              </thead>
              <tbody>
                {data.ips.map((r) => (
                  <tr key={r.ip}>
                    <td className="text-cyan">
                      <code>{r.ip}</code> <span className="geo-cc">{r.version}</span>
                    </td>
                    <td>{formatPlace(r)}</td>
                    <td>
                      {r.asn ? `AS${r.asn}` : '—'} <span className="dim-note">{r.asOrg || ''}</span>
                    </td>
                    <td>{r.anycast ? <span className="status-warn">◉ {r.anycast.provider}</span> : '○'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.skippedNonPublic.length > 0 && (
            <div className="dim-note mt-8">
              Skipped non-public records: {data.skippedNonPublic.join(', ')}
            </div>
          )}
        </CopyableIntelSection>
      )}

      {/* DATA SOURCES / ATTRIBUTION */}
      {data && (
        <div className="geo-attribution dim-note">
          🛰 Local MMDB lookups — no third-party GeoIP / map tile requests.{' '}
          {data.databases.city && (
            <>
              City DB: <code>{data.databases.city.type}</code> ({data.databases.city.buildDate || '?'}).{' '}
            </>
          )}
          {data.databases.asn && (
            <>
              ASN DB: <code>{data.databases.asn.type}</code> ({data.databases.asn.buildDate || '?'}).{' '}
            </>
          )}
          {data.attribution.includes('DB-IP') ? (
            <>
              <a href="https://db-ip.com" target="_blank" rel="noopener noreferrer" className="provider-link">
                IP Geolocation by DB-IP
              </a>{' '}
              (CC BY 4.0).
            </>
          ) : (
            data.attribution
          )}{' '}
          Map: Natural Earth (public domain).
        </div>
      )}
    </div>
  );
};

export default GeoRadarTool;
