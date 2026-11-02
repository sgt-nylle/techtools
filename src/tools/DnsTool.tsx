import React, { useState, useCallback, useRef } from 'react';
import { sound } from '../utils/audio';

type DnsViewTab = 'all' | 'ip' | 'mail' | 'authority' | 'whois';

interface DnsResultPayload {
  query: string;
  isIpQuery: boolean;
  apexDomain: string | null;
  nsInheritedFrom?: string | null;
  durationMs: number;
  records: {
    A: Array<{ address: string; ttl: number } | string>;
    AAAA: Array<{ address: string; ttl: number } | string>;
    CNAME: string[];
    MX: Array<{ priority: number; exchange: string; ips: string[] }>;
    NS: string[];
    TXT: string[];
    CAA: Array<{ critical: number; issue?: string; issuewild?: string; iodef?: string }>;
    SOA: {
      nsname: string;
      hostmaster: string;
      serial: number;
      refresh: number;
      retry: number;
      expire: number;
      minttl: number;
    } | null;
    PTR: Array<{ ip: string; hostnames: string[] }>;
  };
  emailSecurity: {
    spf: {
      present: boolean;
      status: string;
      record: string | null;
      count: number;
      note: string;
      mechanisms: string[];
    } | null;
    dmarc: {
      present: boolean;
      host: string;
      policy: string;
      record: string | null;
      note: string;
    } | null;
  };
  whois: {
    apexDomain: string;
    whoisServer: string | null;
    registrarWhoisServer?: string | null;
    summary: {
      domain: string;
      registrar: string;
      holder: string;
      created: string;
      expires: string;
      updated: string;
      dnssec: string;
      statuses: string[];
      nameservers: string[];
    } | null;
    raw: string;
  } | null;
}

export const DnsTool: React.FC = () => {
  const [domainInput, setDomainInput] = useState<string>('subwrite.se');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DnsResultPayload | null>(null);
  const [activeTab, setActiveTab] = useState<DnsViewTab>('all');
  const [showRawWhois, setShowRawWhois] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const runLookup = useCallback(async (targetOverride?: string) => {
    const queryTarget = (targetOverride ?? domainInput).trim();
    if (!queryTarget) return;

    setLoading(true);
    setError(null);
    sound.playRadarPing();

    try {
      const res = await fetch(`/api/dns?domain=${encodeURIComponent(queryTarget)}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'DNS lookup failed.');
        sound.playError();
      } else {
        setData(json as DnsResultPayload);
        setShowRawWhois(false);
      }
    } catch {
      setError('Network error contacting diagnostic backend.');
      sound.playError();
    } finally {
      setLoading(false);
    }
  }, [domainInput]);

  const copyValue = async (val: string, key: string) => {
    try {
      await navigator.clipboard.writeText(val);
      sound.playCopy();
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 1400);
    } catch {
      sound.playError();
    }
  };

  const quickQuery = (sample: string) => {
    setDomainInput(sample);
    void runLookup(sample);
  };

  return (
    <div className="tool-panel">
      {/* QUERY BAR */}
      <form
        className="query-bar c64-box"
        onSubmit={(e) => {
          e.preventDefault();
          void runLookup();
        }}
      >
        <div className="query-input-group">
          <span className="prompt-chevron">DNS&gt;</span>
          <input
            ref={inputRef}
            type="text"
            value={domainInput}
            onChange={(e) => setDomainInput(e.target.value)}
            placeholder="Enter domain, subdomain, URL, or IP (e.g. subwrite.se)"
            className="navy-input"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <button type="submit" disabled={loading} className="navy-btn btn-primary">
            {loading ? 'SCANNING...' : '► SCAN DOMAIN'}
          </button>
        </div>

        <div className="quick-samples-row">
          <span className="quick-lbl">QUICK TARGETS:</span>
          {['subwrite.se', 'iis.se', 'cloudflare.com', 'github.com'].map((sample) => (
            <button
              key={sample}
              type="button"
              className="navy-chip-btn"
              onClick={() => quickQuery(sample)}
            >
              {sample}
            </button>
          ))}
        </div>
      </form>

      {error && <div className="alert-banner status-err c64-box">⚠ {error}</div>}

      {!data && !loading && !error && (
        <div className="empty-prompt c64-box">
          Enter any domain name above and press <kbd>ENTER</kbd> or <strong>SCAN DOMAIN</strong> to inspect IP
          records, MX mail routing, SPF/DMARC posture, nameservers, TXT records, and WHOIS domain registry details.
        </div>
      )}

      {loading && (
        <div className="loading-radar c64-box">
          <span className="radar-spinner">◎</span> INTERROGATING AUTHORITATIVE NAMESERVERS &amp; WHOIS REGISTRY...
        </div>
      )}

      {data && !loading && (
        <>
          {/* SUMMARY TELEMETRY STRIP */}
          <div className="telemetry-strip c64-box">
            <div className="tele-cell">
              <span className="tele-lbl">TARGET</span>
              <span className="tele-val text-gold">{data.query}</span>
            </div>
            <div className="tele-cell">
              <span className="tele-lbl">IPv4 / IPv6</span>
              <span className="tele-val text-cyan">
                {data.records.A.length} A / {data.records.AAAA.length} AAAA
              </span>
            </div>
            <div className="tele-cell">
              <span className="tele-lbl">MAIL (MX / SPF)</span>
              <span
                className={`tele-val ${
                  data.emailSecurity.spf?.present ? 'status-ok' : 'status-warn'
                }`}
              >
                {data.records.MX.length} MX • {data.emailSecurity.spf?.status || 'N/A'}
              </span>
            </div>
            <div className="tele-cell">
              <span className="tele-lbl">SCAN TIME</span>
              <span className="tele-val status-ok">{data.durationMs} ms</span>
            </div>
          </div>

          {/* SECTION FILTER TABS */}
          <div className="sub-tabs-row">
            {(
              [
                { id: 'all', label: 'ALL INTEL' },
                { id: 'ip', label: 'IP / A / AAAA / PTR' },
                { id: 'mail', label: 'MX / SPF / DMARC' },
                { id: 'authority', label: 'NS / SOA / TXT' },
                { id: 'whois', label: 'DOMAIN REGISTRY (WHOIS)' },
              ] as Array<{ id: DnsViewTab; label: string }>
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`navy-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => {
                  sound.playClick();
                  setActiveTab(tab.id);
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* 1. IP RESOLUTION & REVERSE PTR */}
          {(activeTab === 'all' || activeTab === 'ip') && (
            <section className="intel-section c64-box">
              <h3 className="section-title">► IP ADDRESS RESOLUTION (A / AAAA / CNAME / PTR)</h3>

              {data.records.CNAME.length > 0 && (
                <div className="record-group">
                  <div className="record-badge">CNAME</div>
                  <div className="record-values">
                    {data.records.CNAME.map((cname) => (
                      <div key={cname} className="record-line">
                        <code>{cname}</code>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="record-grid-two">
                <div className="sub-card">
                  <div className="sub-card-hdr">IPv4 (A RECORDS)</div>
                  {data.records.A.length === 0 ? (
                    <div className="dim-note">No IPv4 A records found.</div>
                  ) : (
                    data.records.A.map((rec, i) => {
                      const addr = typeof rec === 'string' ? rec : rec.address;
                      const ttl = typeof rec === 'string' ? null : rec.ttl;
                      const k = `a-${i}`;
                      return (
                        <div key={k} className="kv-row">
                          <code className="text-gold">{addr}</code>
                          <div className="kv-right">
                            {ttl !== null && <span className="ttl-pill">TTL {ttl}s</span>}
                            <button
                              type="button"
                              className="navy-btn btn-xs"
                              onClick={() => copyValue(addr, k)}
                            >
                              {copiedKey === k ? '✓' : 'COPY'}
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="sub-card">
                  <div className="sub-card-hdr">IPv6 (AAAA RECORDS)</div>
                  {data.records.AAAA.length === 0 ? (
                    <div className="dim-note">No IPv6 AAAA records found.</div>
                  ) : (
                    data.records.AAAA.map((rec, i) => {
                      const addr = typeof rec === 'string' ? rec : rec.address;
                      const ttl = typeof rec === 'string' ? null : rec.ttl;
                      const k = `aaaa-${i}`;
                      return (
                        <div key={k} className="kv-row">
                          <code className="text-cyan">{addr}</code>
                          <div className="kv-right">
                            {ttl !== null && <span className="ttl-pill">TTL {ttl}s</span>}
                            <button
                              type="button"
                              className="navy-btn btn-xs"
                              onClick={() => copyValue(addr, k)}
                            >
                              {copiedKey === k ? '✓' : 'COPY'}
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {data.records.PTR.length > 0 && (
                <div className="sub-card mt-8">
                  <div className="sub-card-hdr">REVERSE DNS (PTR)</div>
                  {data.records.PTR.map((ptr) => (
                    <div key={ptr.ip} className="kv-row">
                      <span className="text-cyan">{ptr.ip}</span>
                      <code>
                        {ptr.hostnames.length > 0 ? ptr.hostnames.join(', ') : '(No PTR record)'}
                      </code>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* 2. MAIL ROUTING (MX) & EMAIL AUTHENTICATION (SPF / DMARC) */}
          {(activeTab === 'all' || activeTab === 'mail') && !data.isIpQuery && (
            <section className="intel-section c64-box">
              <h3 className="section-title">► MAIL SERVERS (MX) &amp; SENDER SECURITY (SPF / DMARC)</h3>

              <div className="sub-card">
                <div className="sub-card-hdr">MX RECORDS (SORTED BY PRIORITY)</div>
                {data.records.MX.length === 0 ? (
                  <div className="dim-note">No MX mail exchangers published for {data.query}.</div>
                ) : (
                  data.records.MX.map((mx, i) => (
                    <div key={`${mx.exchange}-${i}`} className="kv-row">
                      <div>
                        <span className="prio-badge">PRIO {mx.priority}</span>{' '}
                        <code className="text-gold">{mx.exchange}</code>
                      </div>
                      <span className="dim-inline">
                        {mx.ips.length > 0 ? mx.ips.join(', ') : 'No IPv4'}
                      </span>
                    </div>
                  ))
                )}
              </div>

              <div className="record-grid-two mt-8">
                {data.emailSecurity.spf && (
                  <div className="sub-card">
                    <div className="sub-card-hdr">
                      SPF POLICY{' '}
                      <span
                        className={
                          data.emailSecurity.spf.present
                            ? data.emailSecurity.spf.status.includes('DANGER') ||
                              data.emailSecurity.spf.status.includes('WARN')
                              ? 'status-err'
                              : 'status-ok'
                            : 'status-warn'
                        }
                      >
                        [{data.emailSecurity.spf.status}]
                      </span>
                    </div>
                    <p className="policy-note">{data.emailSecurity.spf.note}</p>
                    {data.emailSecurity.spf.record && (
                      <code className="code-wrap-box">{data.emailSecurity.spf.record}</code>
                    )}
                  </div>
                )}

                {data.emailSecurity.dmarc && (
                  <div className="sub-card">
                    <div className="sub-card-hdr">
                      DMARC ({data.emailSecurity.dmarc.host}){' '}
                      <span
                        className={
                          data.emailSecurity.dmarc.present ? 'status-ok' : 'status-warn'
                        }
                      >
                        [{data.emailSecurity.dmarc.policy}]
                      </span>
                    </div>
                    <p className="policy-note">{data.emailSecurity.dmarc.note}</p>
                    {data.emailSecurity.dmarc.record && (
                      <code className="code-wrap-box">{data.emailSecurity.dmarc.record}</code>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* 3. DOMAIN REGISTRY / WHOIS */}
          {(activeTab === 'all' || activeTab === 'whois') && data.whois && (
            <section className="intel-section c64-box">
              <div className="section-title-row">
                <h3 className="section-title">
                  ► DOMAIN REGISTRATION INFO ({data.whois.apexDomain.toUpperCase()})
                </h3>
                {data.whois.whoisServer && (
                  <span className="ttl-pill">SOURCE: {data.whois.whoisServer}</span>
                )}
              </div>

              {data.whois.summary ? (
                <div className="whois-grid">
                  <div className="whois-item">
                    <span className="tele-lbl">REGISTERED DOMAIN</span>
                    <span className="tele-val text-gold">{data.whois.summary.domain}</span>
                  </div>
                  <div className="whois-item">
                    <span className="tele-lbl">REGISTRAR</span>
                    <span className="tele-val text-cyan">
                      {data.whois.summary.registrar || 'Not disclosed by registry'}
                    </span>
                  </div>
                  <div className="whois-item">
                    <span className="tele-lbl">CREATED</span>
                    <span className="tele-val">{data.whois.summary.created || '—'}</span>
                  </div>
                  <div className="whois-item">
                    <span className="tele-lbl">EXPIRES</span>
                    <span className="tele-val text-gold">{data.whois.summary.expires || '—'}</span>
                  </div>
                  <div className="whois-item">
                    <span className="tele-lbl">LAST MODIFIED</span>
                    <span className="tele-val">{data.whois.summary.updated || '—'}</span>
                  </div>
                  <div className="whois-item">
                    <span className="tele-lbl">DNSSEC</span>
                    <span className="tele-val">
                      {data.whois.summary.dnssec || 'unsigned / unspecified'}
                    </span>
                  </div>
                  {data.whois.summary.holder && (
                    <div className="whois-item">
                      <span className="tele-lbl">HOLDER / ORG</span>
                      <span className="tele-val">{data.whois.summary.holder}</span>
                    </div>
                  )}
                  <div className="whois-item">
                    <span className="tele-lbl">DOMAIN STATUS</span>
                    <span className="tele-val status-ok">
                      {data.whois.summary.statuses.length > 0
                        ? data.whois.summary.statuses.join(', ')
                        : 'ACTIVE'}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="dim-note">Structured WHOIS summary unavailable for this TLD.</div>
              )}

              {data.whois.raw && (
                <div className="mt-8">
                  <button
                    type="button"
                    className="navy-btn btn-sm"
                    onClick={() => {
                      sound.playClick();
                      setShowRawWhois((v) => !v);
                    }}
                  >
                    {showRawWhois ? '▼ HIDE RAW WHOIS RECORD' : '► VIEW RAW WHOIS RECORD'}
                  </button>
                  {showRawWhois && <pre className="raw-pre-box">{data.whois.raw}</pre>}
                </div>
              )}
            </section>
          )}

          {/* 4. AUTHORITY (NS / SOA / TXT / CAA) */}
          {(activeTab === 'all' || activeTab === 'authority') && !data.isIpQuery && (
            <section className="intel-section c64-box">
              <h3 className="section-title">► AUTHORITATIVE NAMESERVERS, SOA &amp; TXT RECORDS</h3>

              <div className="record-grid-two">
                <div className="sub-card">
                  <div className="sub-card-hdr">
                    NAMESERVERS (NS){' '}
                    {data.nsInheritedFrom && (
                      <span className="dim-inline">(zone: {data.nsInheritedFrom})</span>
                    )}
                  </div>
                  {data.records.NS.length === 0 ? (
                    <div className="dim-note">No NS records returned.</div>
                  ) : (
                    data.records.NS.map((ns) => (
                      <div key={ns} className="kv-row">
                        <code className="text-cyan">{ns}</code>
                      </div>
                    ))
                  )}
                </div>

                <div className="sub-card">
                  <div className="sub-card-hdr">START OF AUTHORITY (SOA)</div>
                  {!data.records.SOA ? (
                    <div className="dim-note">No direct SOA record on this node (subdomain).</div>
                  ) : (
                    <div className="soa-list">
                      <div>
                        <strong>PRIMARY NS:</strong> <code>{data.records.SOA.nsname}</code>
                      </div>
                      <div>
                        <strong>HOSTMASTER:</strong> <code>{data.records.SOA.hostmaster}</code>
                      </div>
                      <div>
                        <strong>SERIAL:</strong> <code className="text-gold">{data.records.SOA.serial}</code>
                      </div>
                      <div>
                        <strong>TIMERS:</strong> Refresh {data.records.SOA.refresh}s • Retry{' '}
                        {data.records.SOA.retry}s • MinTTL {data.records.SOA.minttl}s
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="sub-card mt-8">
                <div className="sub-card-hdr">TXT RECORDS ({data.records.TXT.length})</div>
                {data.records.TXT.length === 0 ? (
                  <div className="dim-note">No TXT records found on {data.query}.</div>
                ) : (
                  data.records.TXT.map((txt, idx) => (
                    <div key={`txt-${idx}`} className="txt-record-row">
                      <code className="code-wrap-box">{txt}</code>
                    </div>
                  ))
                )}
              </div>

              {data.records.CAA.length > 0 && (
                <div className="sub-card mt-8">
                  <div className="sub-card-hdr">CERTIFICATE AUTHORITY AUTHORIZATION (CAA)</div>
                  {data.records.CAA.map((caa, idx) => (
                    <div key={`caa-${idx}`} className="kv-row">
                      <code>
                        flags={caa.critical}{' '}
                        {caa.issue
                          ? `issue "${caa.issue}"`
                          : caa.issuewild
                          ? `issuewild "${caa.issuewild}"`
                          : `iodef "${caa.iodef || ''}"`}
                      </code>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
};

export default DnsTool;
