import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { CopyableIntelSection } from '../components/CopyableIntelSection';
import { sound } from '../utils/audio';
import { useIsPaneActive } from '../utils/paneContext';

type DnsViewTab = 'all' | 'ip' | 'mail' | 'authority' | 'whois';
type DnsServerPreset = 'google' | 'cloudflare' | 'custom';

interface DnskeyRecord {
  flags: number;
  protocol: number;
  algorithm: number;
  algorithmName: string;
  keyType: 'KSK' | 'ZSK' | 'REVOKED_KSK' | 'REVOKED_ZSK' | 'OTHER';
  keyTypeLabel: string;
  keyTag: number;
  publicKey: string;
  ttl: number | null;
  matchedByDs: boolean;
}

interface DsRecord {
  keyTag: number;
  algorithm: number;
  algorithmName: string;
  digestType: number;
  digestTypeName: string;
  digest: string;
  ttl: number | null;
  matchesKsk: boolean;
  matchesAnyKey: boolean;
  digestVerified: boolean;
}

interface DnssecAnalysis {
  zone: string;
  inheritedFromApex: boolean;
  dohProvider: string;
  status: 'SECURE' | 'INCOMPLETE' | 'BROKEN' | 'UNSIGNED';
  statusLabel: string;
  chainValid: boolean;
  adAuthenticated: boolean;
  summaryNote: string;
  totalKeys: number;
  kskCount: number;
  zskCount: number;
  dnskeys: DnskeyRecord[];
  dsRecords: DsRecord[];
}

interface DnsResultPayload {
  query: string;
  isIpQuery: boolean;
  apexDomain: string | null;
  nsInheritedFrom?: string | null;
  dnsServer?: {
    ip: string;
    label: string;
    preset: DnsServerPreset;
    resolvedFrom: string | null;
  };
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
  dnssec?: DnssecAnalysis | null;
}

export const DnsTool: React.FC = () => {
  const isPaneActive = useIsPaneActive();
  const [domainInput, setDomainInput] = useState<string>('');
  const [dnsPreset, setDnsPreset] = useState<DnsServerPreset>('google');
  const [customDnsInput, setCustomDnsInput] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DnsResultPayload | null>(null);
  const [activeTab, setActiveTab] = useState<DnsViewTab>('all');
  const [showRawWhois, setShowRawWhois] = useState<boolean>(false);
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const customDnsRef = useRef<HTMLInputElement>(null);

  const runLookup = useCallback(
    async (targetOverride?: string, serverOverride?: string) => {
      const queryTarget = (targetOverride ?? domainInput).trim();
      if (!queryTarget) {
        setError('Enter a domain name, subdomain, or IP address to inspect.');
        sound.playError();
        inputRef.current?.focus();
        return;
      }

      const resolvedServerParam =
        serverOverride !== undefined
          ? serverOverride
          : dnsPreset === 'google'
          ? '8.8.8.8'
          : dnsPreset === 'cloudflare'
          ? '1.1.1.1'
          : customDnsInput.trim();

      if (dnsPreset === 'custom' && serverOverride === undefined && !resolvedServerParam) {
        setError('Enter a custom public DNS server IP or hostname (e.g. 9.9.9.9), or select Google / Cloudflare.');
        sound.playError();
        customDnsRef.current?.focus();
        return;
      }

      setLoading(true);
      setError(null);
      sound.playRadarPing();

      try {
        const params = new URLSearchParams({
          domain: queryTarget,
          server: resolvedServerParam,
        });
        const res = await fetch(`/api/dns?${params.toString()}`);
        const json = await res.json();
        if (!res.ok) {
          setError(json.error || 'DNS lookup failed.');
          sound.playError();
        } else {
          setData(json as DnsResultPayload);
          setShowRawWhois(false);
          setExpandedKeys({});
        }
      } catch {
        setError('Network error contacting diagnostic backend.');
        sound.playError();
      } finally {
        setLoading(false);
      }
    },
    [domainInput, dnsPreset, customDnsInput]
  );

  const selectDnsPreset = useCallback(
    (preset: DnsServerPreset) => {
      sound.playClick();
      setDnsPreset(preset);
      setError(null);

      if (preset === 'custom') {
        window.setTimeout(() => {
          customDnsRef.current?.focus();
          customDnsRef.current?.select();
        }, 0);
        return;
      }

      const nextServer = preset === 'google' ? '8.8.8.8' : '1.1.1.1';
      if (data && !loading && domainInput.trim()) {
        void runLookup(domainInput, nextServer);
      }
    },
    [data, loading, domainInput, runLookup]
  );

  const copyValue = useCallback(async (val: string, key: string) => {
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
  }, []);

  const toggleKeyExpand = useCallback((id: string) => {
    sound.playClick();
    setExpandedKeys((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const quickQuery = (sample: string) => {
    setDomainInput(sample);
    void runLookup(sample);
  };

  // Single-letter shortcuts for DNS & WHOIS tool
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
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }

      if (k === 'g') {
        e.preventDefault();
        selectDnsPreset('google');
        return;
      }

      if (k === 'f') {
        e.preventDefault();
        selectDnsPreset('cloudflare');
        return;
      }

      if (k === 'u') {
        e.preventDefault();
        selectDnsPreset('custom');
        return;
      }

      if (k === 'r') {
        e.preventDefault();
        if (!loading) void runLookup();
        return;
      }

      if (!data) return;

      if (k === 'a') {
        e.preventDefault();
        sound.playClick();
        setActiveTab('all');
      } else if (k === 'i') {
        e.preventDefault();
        sound.playClick();
        setActiveTab('ip');
      } else if (k === 'm') {
        e.preventDefault();
        sound.playClick();
        setActiveTab('mail');
      } else if (k === 'n') {
        e.preventDefault();
        sound.playClick();
        setActiveTab('authority');
      } else if (k === 'w') {
        e.preventDefault();
        sound.playClick();
        setActiveTab('whois');
      } else if (k === 'v' && data.whois?.raw) {
        e.preventDefault();
        sound.playClick();
        setShowRawWhois((v) => !v);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPaneActive, data, loading, runLookup, selectDnsPreset]);

  // Formatted plain-text clipboard payloads for each Tab-selectable intel section
  const sectionPayloads = useMemo(() => {
    if (!data) {
      return { ip: '', mail: '', whois: '', authority: '' };
    }

    const resolverLabel = data.dnsServer?.label || 'Google (8.8.8.8)';

    // 1. IP Resolution payload
    const ipLines: string[] = [
      `=== IP ADDRESS RESOLUTION (${data.query}) ===`,
      `DNS Resolver: ${resolverLabel}`,
    ];
    if (data.records.CNAME.length > 0) {
      ipLines.push(`CNAME: ${data.records.CNAME.join(', ')}`);
    }
    if (data.records.A.length === 0) {
      ipLines.push('IPv4 (A): None');
    } else {
      for (const rec of data.records.A) {
        const addr = typeof rec === 'string' ? rec : rec.address;
        const ttl = typeof rec === 'string' ? null : rec.ttl;
        ipLines.push(`IPv4 (A): ${addr}${ttl !== null ? ` (TTL ${ttl}s)` : ''}`);
      }
    }
    if (data.records.AAAA.length === 0) {
      ipLines.push('IPv6 (AAAA): None');
    } else {
      for (const rec of data.records.AAAA) {
        const addr = typeof rec === 'string' ? rec : rec.address;
        const ttl = typeof rec === 'string' ? null : rec.ttl;
        ipLines.push(`IPv6 (AAAA): ${addr}${ttl !== null ? ` (TTL ${ttl}s)` : ''}`);
      }
    }
    for (const ptr of data.records.PTR) {
      ipLines.push(
        `PTR (${ptr.ip}): ${ptr.hostnames.length > 0 ? ptr.hostnames.join(', ') : '(No PTR record)'}`
      );
    }

    // 2. Mail / SPF / DMARC payload
    const mailLines: string[] = [
      `=== MAIL SERVERS & SENDER SECURITY (${data.query}) ===`,
      `DNS Resolver: ${resolverLabel}`,
    ];
    if (data.records.MX.length === 0) {
      mailLines.push('MX Records: None');
    } else {
      for (const mx of data.records.MX) {
        mailLines.push(
          `MX: PRIO ${mx.priority} ${mx.exchange} (${mx.ips.length > 0 ? mx.ips.join(', ') : 'No IPv4'})`
        );
      }
    }
    if (data.emailSecurity.spf) {
      mailLines.push(`SPF [${data.emailSecurity.spf.status}]: ${data.emailSecurity.spf.note}`);
      if (data.emailSecurity.spf.record) {
        mailLines.push(`SPF Record: ${data.emailSecurity.spf.record}`);
      }
    }
    if (data.emailSecurity.dmarc) {
      mailLines.push(
        `DMARC (${data.emailSecurity.dmarc.host}) [${data.emailSecurity.dmarc.policy}]: ${data.emailSecurity.dmarc.note}`
      );
      if (data.emailSecurity.dmarc.record) {
        mailLines.push(`DMARC Record: ${data.emailSecurity.dmarc.record}`);
      }
    }

    // 3. Domain Registry / WHOIS payload
    const whoisLines: string[] = [];
    if (data.whois) {
      whoisLines.push(`=== DOMAIN REGISTRATION INFO (${data.whois.apexDomain.toUpperCase()}) ===`);
      if (data.whois.whoisServer) {
        whoisLines.push(`WHOIS Server: ${data.whois.whoisServer}`);
      }
      if (data.whois.summary) {
        const s = data.whois.summary;
        whoisLines.push(`Domain: ${s.domain}`);
        whoisLines.push(`Registrar: ${s.registrar || 'Not disclosed by registry'}`);
        if (s.holder) whoisLines.push(`Holder / Org: ${s.holder}`);
        whoisLines.push(`Created: ${s.created || '—'}`);
        whoisLines.push(`Expires: ${s.expires || '—'}`);
        whoisLines.push(`Last Modified: ${s.updated || '—'}`);
        whoisLines.push(`DNSSEC: ${s.dnssec || 'unsigned / unspecified'}`);
        whoisLines.push(`Status: ${s.statuses.length > 0 ? s.statuses.join(', ') : 'ACTIVE'}`);
        if (s.nameservers.length > 0) {
          whoisLines.push(`Nameservers: ${s.nameservers.join(', ')}`);
        }
      }
      if (data.dnssec) {
        const d = data.dnssec;
        whoisLines.push(
          '',
          `--- DNSSEC ZONE KEY & DELEGATION ANALYSIS (${d.zone.toUpperCase()}) ---`,
          `DNSSEC Status: ${d.statusLabel} (Total Keys: ${d.totalKeys} — ${d.kskCount} KSK, ${d.zskCount} ZSK)`,
          `Summary: ${d.summaryNote}`
        );
        if (d.dsRecords.length > 0) {
          for (const ds of d.dsRecords) {
            whoisLines.push(
              `DS Record: KeyTag=#${ds.keyTag} | Alg=${ds.algorithm} (${ds.algorithmName}) | DigestType=${ds.digestType} (${ds.digestTypeName}) | Chain=${
                ds.matchesKsk ? 'VALID (Matches KSK)' : 'MISMATCH'
              } | Digest=${ds.digest}`
            );
          }
        } else {
          whoisLines.push('DS Records: None');
        }
        if (d.dnskeys.length > 0) {
          for (const k of d.dnskeys) {
            whoisLines.push(
              `DNSKEY: ${k.keyType} (Flag ${k.flags}) | KeyTag=#${k.keyTag} | Alg=${k.algorithm} (${k.algorithmName}) | PubKey=${k.publicKey}`
            );
          }
        } else {
          whoisLines.push('DNSKEY Records: None');
        }
      }
      if (showRawWhois && data.whois.raw) {
        whoisLines.push('', '--- RAW WHOIS RECORD ---', data.whois.raw.trim());
      }
    }

    // 4. Authority (NS / SOA / TXT / CAA) payload
    const authLines: string[] = [
      `=== AUTHORITATIVE NAMESERVERS, SOA & TXT (${data.query}) ===`,
      `DNS Resolver: ${resolverLabel}`,
    ];
    authLines.push(
      `Nameservers (NS)${data.nsInheritedFrom ? ` [zone: ${data.nsInheritedFrom}]` : ''}: ${
        data.records.NS.length > 0 ? data.records.NS.join(', ') : 'None'
      }`
    );
    if (data.records.SOA) {
      const soa = data.records.SOA;
      authLines.push(
        `SOA: Primary=${soa.nsname} | Hostmaster=${soa.hostmaster} | Serial=${soa.serial} | Refresh=${soa.refresh}s | Retry=${soa.retry}s | MinTTL=${soa.minttl}s`
      );
    } else {
      authLines.push('SOA: None on this node');
    }
    if (data.records.TXT.length === 0) {
      authLines.push('TXT Records: None');
    } else {
      for (const txt of data.records.TXT) {
        authLines.push(`TXT: ${txt}`);
      }
    }
    for (const caa of data.records.CAA) {
      const tag = caa.issue
        ? `issue "${caa.issue}"`
        : caa.issuewild
        ? `issuewild "${caa.issuewild}"`
        : `iodef "${caa.iodef || ''}"`;
      authLines.push(`CAA: flags=${caa.critical} ${tag}`);
    }

    return {
      ip: ipLines.join('\n'),
      mail: mailLines.join('\n'),
      whois: whoisLines.join('\n'),
      authority: authLines.join('\n'),
    };
  }, [data, showRawWhois]);

  return (
    <div className="tool-panel">
      {/* QUERY BAR + DNS RESOLVER SELECTOR */}
      <form
        className="query-bar clean-box"
        onSubmit={(e) => {
          e.preventDefault();
          void runLookup();
        }}
      >
        <div className="query-input-group">
          <span className="prompt-chevron" title="Press [Q] to focus input">
            DNS [Q]&gt;
          </span>
          <input
            ref={inputRef}
            type="text"
            value={domainInput}
            onChange={(e) => setDomainInput(e.target.value)}
            placeholder="Paste domain name, subdomain, or IP to inspect... (ESC unlocks shortcuts)"
            className="navy-input"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <button type="submit" disabled={loading} className="navy-btn btn-primary">
            {loading ? 'SCANNING...' : '► SCAN [R]'}
          </button>
        </div>

        {/* DNS SERVER RESOLVER SELECTOR */}
        <div className="dns-resolver-row">
          <span className="quick-lbl">DNS SERVER:</span>
          <div className="preset-buttons">
            <button
              type="button"
              className={`navy-btn btn-sm ${dnsPreset === 'google' ? 'btn-active' : ''}`}
              onClick={() => selectDnsPreset('google')}
            >
              GOOGLE 8.8.8.8 [G]
            </button>
            <button
              type="button"
              className={`navy-btn btn-sm ${dnsPreset === 'cloudflare' ? 'btn-active' : ''}`}
              onClick={() => selectDnsPreset('cloudflare')}
            >
              CLOUDFLARE 1.1.1.1 [F]
            </button>
            <button
              type="button"
              className={`navy-btn btn-sm ${dnsPreset === 'custom' ? 'btn-active' : ''}`}
              onClick={() => selectDnsPreset('custom')}
            >
              CUSTOM DNS [U]
            </button>
          </div>

          {dnsPreset === 'custom' && (
            <input
              ref={customDnsRef}
              type="text"
              value={customDnsInput}
              onChange={(e) => setCustomDnsInput(e.target.value)}
              placeholder="Public DNS IP or NS host (e.g. 9.9.9.9, 208.67.222.222, ns1.inleed.net)"
              className="navy-input custom-dns-input"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-label="Custom public DNS server IP or hostname"
            />
          )}
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

      {error && <div className="alert-banner status-err clean-box">⚠ {error}</div>}

      {!data && !loading && !error && (
        <div className="empty-prompt clean-box">
          Enter any domain name above (<kbd>Q</kbd> to focus), pick a DNS resolver (<kbd>G</kbd> Google{' '}
          <code>8.8.8.8</code>, <kbd>F</kbd> Cloudflare <code>1.1.1.1</code>, or <kbd>U</kbd> Custom), and press{' '}
          <kbd>ENTER</kbd> or <kbd>R</kbd> to scan.
        </div>
      )}

      {loading && (
        <div className="loading-radar clean-box">
          <span className="radar-spinner">◎</span> QUERYING DNS RESOLVER (
          {dnsPreset === 'google'
            ? '8.8.8.8'
            : dnsPreset === 'cloudflare'
            ? '1.1.1.1'
            : customDnsInput.trim() || 'CUSTOM'}
          ) &amp; WHOIS REGISTRY...
        </div>
      )}

      {data && !loading && (
        <>
          {/* SUMMARY TELEMETRY STRIP */}
          <div className="telemetry-strip clean-box">
            <div className="tele-cell">
              <span className="tele-lbl">TARGET</span>
              <span className="tele-val text-gold">{data.query}</span>
            </div>
            <div className="tele-cell">
              <span className="tele-lbl">DNS SERVER</span>
              <span className="tele-val text-cyan">{data.dnsServer?.label || 'Google (8.8.8.8)'}</span>
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
            {data.dnssec && (
              <div className="tele-cell">
                <span className="tele-lbl">DNSSEC</span>
                <span
                  className={`tele-val ${
                    data.dnssec.status === 'SECURE'
                      ? 'status-ok'
                      : data.dnssec.status === 'BROKEN'
                      ? 'status-err'
                      : 'status-warn'
                  }`}
                >
                  {data.dnssec.status === 'SECURE'
                    ? `SIGNED (${data.dnssec.totalKeys} KEYS)`
                    : data.dnssec.status}
                </span>
              </div>
            )}
            <div className="tele-cell">
              <span className="tele-lbl">SCAN TIME</span>
              <span className="tele-val status-ok">{data.durationMs} ms</span>
            </div>
          </div>

          {/* SECTION FILTER TABS */}
          <div className="sub-tabs-row">
            {(
              [
                { id: 'all', label: 'ALL INTEL [A]' },
                { id: 'ip', label: 'IP / PTR [I]' },
                { id: 'mail', label: 'MX / SPF / DMARC [M]' },
                { id: 'authority', label: 'NS / SOA / TXT [N]' },
                { id: 'whois', label: 'WHOIS & DNSSEC [W]' },
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
            <CopyableIntelSection
              title="► IP ADDRESS RESOLUTION (A / AAAA / CNAME / PTR)"
              badge={data.dnsServer?.ip ? `@${data.dnsServer.ip}` : null}
              copyPayload={sectionPayloads.ip}
            >
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
                              tabIndex={-1}
                              className="navy-btn btn-xs"
                              onClick={() => void copyValue(addr, k)}
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
                              tabIndex={-1}
                              className="navy-btn btn-xs"
                              onClick={() => void copyValue(addr, k)}
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
            </CopyableIntelSection>
          )}

          {/* 2. MAIL ROUTING (MX) & EMAIL AUTHENTICATION (SPF / DMARC) */}
          {(activeTab === 'all' || activeTab === 'mail') && !data.isIpQuery && (
            <CopyableIntelSection
              title="► MAIL SERVERS (MX) & SENDER SECURITY (SPF / DMARC)"
              badge={data.dnsServer?.ip ? `@${data.dnsServer.ip}` : null}
              copyPayload={sectionPayloads.mail}
            >
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
            </CopyableIntelSection>
          )}

          {/* 3. DOMAIN REGISTRY / WHOIS */}
          {(activeTab === 'all' || activeTab === 'whois') && data.whois && (
            <CopyableIntelSection
              title={`► DOMAIN REGISTRATION INFO (${data.whois.apexDomain.toUpperCase()})`}
              badge={data.whois.whoisServer ? `SOURCE: ${data.whois.whoisServer}` : null}
              copyPayload={sectionPayloads.whois}
            >
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
                    <span
                      className={`tele-val ${
                        data.dnssec?.status === 'SECURE'
                          ? 'status-ok'
                          : data.dnssec?.status === 'BROKEN'
                          ? 'status-err'
                          : data.whois.summary.dnssec &&
                            !/unsigned/i.test(data.whois.summary.dnssec)
                          ? 'status-ok'
                          : 'status-warn'
                      }`}
                    >
                      {data.whois.summary.dnssec ||
                        (data.dnssec?.status === 'SECURE'
                          ? 'signedDelegation'
                          : 'unsigned / unspecified')}
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

              {/* EXPANDED DNSSEC ZONE KEY (DNSKEY) & DELEGATION SIGNER (DS) ANALYSIS */}
              {data.dnssec && (
                <div className="dnssec-panel mt-8">
                  <div className="dnssec-status-bar">
                    <div className="dnssec-status-left">
                      <span
                        className={`dnssec-status-badge ${
                          data.dnssec.status === 'SECURE'
                            ? 'badge-secure'
                            : data.dnssec.status === 'BROKEN'
                            ? 'badge-broken'
                            : 'badge-unsigned'
                        }`}
                      >
                        {data.dnssec.status === 'SECURE'
                          ? `✓ ${data.dnssec.statusLabel}`
                          : data.dnssec.status === 'BROKEN'
                          ? `✕ ${data.dnssec.statusLabel}`
                          : `⚠ ${data.dnssec.statusLabel}`}
                      </span>
                      <span className="dnssec-summary-note">{data.dnssec.summaryNote}</span>
                    </div>
                    <div className="dnssec-meta-pills">
                      <span className="ttl-pill">
                        KEYS FOUND: <strong>{data.dnssec.totalKeys}</strong> ({data.dnssec.kskCount} KSK •{' '}
                        {data.dnssec.zskCount} ZSK)
                      </span>
                      <span className="ttl-pill">
                        DS RECORDS: <strong>{data.dnssec.dsRecords.length}</strong>
                      </span>
                      <span
                        className={`ttl-pill ${
                          data.dnssec.adAuthenticated ? 'status-ok' : 'dim-inline'
                        }`}
                        title="DNSSEC Authenticated Data (AD) bit from validating DoH resolver"
                      >
                        {data.dnssec.adAuthenticated ? 'AD=1 (VALIDATED)' : 'AD=0'}
                      </span>
                    </div>
                  </div>

                  {/* DELEGATION SIGNER (DS) RECORDS */}
                  <div className="sub-card mt-8">
                    <div className="sub-card-hdr dnssec-sub-hdr">
                      <span>
                        DELEGATION SIGNER (DS) RECORDS — PARENT TLD CHAIN OF TRUST (
                        {data.dnssec.dsRecords.length})
                      </span>
                      <span className="dim-inline">
                        ZONE: {data.dnssec.zone}
                        {data.dnssec.inheritedFromApex ? ' (apex)' : ''}
                      </span>
                    </div>
                    {data.dnssec.dsRecords.length === 0 ? (
                      <div className="dim-note">
                        No DS delegation records published in parent zone for {data.dnssec.zone}.
                      </div>
                    ) : (
                      <div className="dnssec-records-list">
                        {data.dnssec.dsRecords.map((ds, idx) => {
                          const dsCopyId = `ds-${ds.keyTag}-${idx}`;
                          return (
                            <div key={dsCopyId} className="dnssec-record-block">
                              <div className="dnssec-record-top">
                                <div className="dnssec-record-tags">
                                  <span className="dnssec-tag-pill">KEY TAG #{ds.keyTag}</span>
                                  <span className="ttl-pill">
                                    ALG {ds.algorithm}: {ds.algorithmName}
                                  </span>
                                  <span className="ttl-pill">
                                    DIGEST {ds.digestType}: {ds.digestTypeName}
                                  </span>
                                  {ds.ttl !== null && <span className="ttl-pill">TTL {ds.ttl}s</span>}
                                </div>
                                <span
                                  className={`dnssec-chain-indicator ${
                                    ds.matchesKsk
                                      ? 'chain-valid'
                                      : ds.matchesAnyKey
                                      ? 'chain-warn'
                                      : 'chain-broken'
                                  }`}
                                >
                                  {ds.matchesKsk
                                    ? `✓ CHAIN OF TRUST VALID • MATCHES KSK #${ds.keyTag}${
                                        ds.digestVerified ? ' (DIGEST VERIFIED)' : ''
                                      }`
                                    : ds.matchesAnyKey
                                    ? `✓ MATCHES ZONE KEY #${ds.keyTag}`
                                    : `✕ NO MATCHING KSK #${ds.keyTag} IN ZONE`}
                                </span>
                              </div>
                              <div className="dnssec-key-row">
                                <span className="dnssec-field-lbl">DIGEST:</span>
                                <code className="dnssec-key-code text-gold">{ds.digest}</code>
                                <button
                                  type="button"
                                  tabIndex={-1}
                                  className={`navy-btn btn-xs ${
                                    copiedKey === dsCopyId ? 'btn-copied' : ''
                                  }`}
                                  onClick={() => void copyValue(ds.digest, dsCopyId)}
                                >
                                  {copiedKey === dsCopyId ? '✓ COPIED' : 'COPY'}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* ZONE PUBLIC KEYS (DNSKEY) */}
                  <div className="sub-card mt-8">
                    <div className="sub-card-hdr dnssec-sub-hdr">
                      <span>
                        ZONE PUBLIC KEYS (DNSKEY) — AUTHORITATIVE KEYSET ({data.dnssec.totalKeys} KEYS
                        FOUND)
                      </span>
                      <span className="dim-inline">{data.dnssec.dohProvider}</span>
                    </div>
                    {data.dnssec.dnskeys.length === 0 ? (
                      <div className="dim-note">
                        No DNSKEY records published for {data.dnssec.zone}.
                      </div>
                    ) : (
                      <div className="dnssec-records-list">
                        {data.dnssec.dnskeys.map((k, idx) => {
                          const keyId = `dnskey-${k.keyTag}-${k.flags}-${idx}`;
                          const isExpanded = Boolean(expandedKeys[keyId]);
                          const shouldTruncate = k.publicKey.length > 56;
                          const displayKey =
                            !shouldTruncate || isExpanded
                              ? k.publicKey
                              : `${k.publicKey.slice(0, 36)}…${k.publicKey.slice(-16)}`;

                          return (
                            <div key={keyId} className="dnssec-record-block">
                              <div className="dnssec-record-top">
                                <div className="dnssec-record-tags">
                                  <span
                                    className={`dnssec-role-badge ${
                                      k.keyType === 'KSK' ? 'role-ksk' : 'role-zsk'
                                    }`}
                                  >
                                    {k.keyType === 'KSK'
                                      ? 'KSK • FLAG 257 (KEY SIGNING KEY)'
                                      : k.keyType === 'ZSK'
                                      ? 'ZSK • FLAG 256 (ZONE SIGNING KEY)'
                                      : k.keyTypeLabel.toUpperCase()}
                                  </span>
                                  <span className="dnssec-tag-pill">KEY TAG #{k.keyTag}</span>
                                  <span className="ttl-pill">
                                    ALG {k.algorithm}: {k.algorithmName}
                                  </span>
                                  <span className="ttl-pill">PROTO {k.protocol}</span>
                                  {k.ttl !== null && <span className="ttl-pill">TTL {k.ttl}s</span>}
                                </div>
                                {k.matchedByDs && (
                                  <span className="dnssec-chain-indicator chain-valid">
                                    ★ LINKED BY PARENT DS #{k.keyTag}
                                  </span>
                                )}
                              </div>
                              <div className="dnssec-key-row">
                                <span className="dnssec-field-lbl">PUBKEY:</span>
                                <code
                                  className="dnssec-key-code text-cyan"
                                  onClick={() => {
                                    if (shouldTruncate) toggleKeyExpand(keyId);
                                  }}
                                  title={
                                    shouldTruncate
                                      ? 'Click to expand / collapse full Base64 public key'
                                      : undefined
                                  }
                                  style={shouldTruncate ? { cursor: 'pointer' } : undefined}
                                >
                                  {displayKey}
                                </code>
                                <div className="kv-right">
                                  {shouldTruncate && (
                                    <button
                                      type="button"
                                      tabIndex={-1}
                                      className="navy-btn btn-xs"
                                      onClick={() => toggleKeyExpand(keyId)}
                                    >
                                      {isExpanded ? 'COLLAPSE' : 'EXPAND'}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    tabIndex={-1}
                                    className={`navy-btn btn-xs ${
                                      copiedKey === keyId ? 'btn-copied' : ''
                                    }`}
                                    onClick={() => void copyValue(k.publicKey, keyId)}
                                  >
                                    {copiedKey === keyId ? '✓ COPIED' : 'COPY'}
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {data.whois.raw && (
                <div className="mt-8">
                  <div className="raw-actions-row">
                    <button
                      type="button"
                      className="navy-btn btn-sm"
                      onClick={() => {
                        sound.playClick();
                        setShowRawWhois((v) => !v);
                      }}
                    >
                      {showRawWhois ? '▼ HIDE RAW WHOIS [V]' : '► VIEW RAW WHOIS [V]'}
                    </button>
                    {showRawWhois && (
                      <button
                        type="button"
                        tabIndex={-1}
                        className={`navy-btn btn-xs ${copiedKey === 'raw-whois' ? 'btn-copied' : ''}`}
                        onClick={() => void copyValue(data.whois?.raw || '', 'raw-whois')}
                      >
                        {copiedKey === 'raw-whois' ? '✓ COPIED RAW WHOIS!' : '📋 COPY RAW WHOIS [TAB + C]'}
                      </button>
                    )}
                  </div>
                  {showRawWhois && (
                    <pre
                      tabIndex={0}
                      className={`raw-pre-box copyable-pre ${copiedKey === 'raw-whois' ? 'row-copied' : ''}`}
                      aria-label="Raw WHOIS output — Press C to copy raw WHOIS"
                      onKeyDown={(e) => {
                        if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'c' || e.key === 'C')) {
                          e.preventDefault();
                          e.stopPropagation();
                          void copyValue(data.whois?.raw || '', 'raw-whois');
                        }
                      }}
                    >
                      {data.whois.raw}
                    </pre>
                  )}
                </div>
              )}
            </CopyableIntelSection>
          )}

          {/* 4. AUTHORITY (NS / SOA / TXT / CAA) */}
          {(activeTab === 'all' || activeTab === 'authority') && !data.isIpQuery && (
            <CopyableIntelSection
              title="► AUTHORITATIVE NAMESERVERS, SOA & TXT RECORDS"
              badge={data.dnsServer?.ip ? `@${data.dnsServer.ip}` : null}
              copyPayload={sectionPayloads.authority}
            >
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
            </CopyableIntelSection>
          )}
        </>
      )}
    </div>
  );
};

export default DnsTool;
