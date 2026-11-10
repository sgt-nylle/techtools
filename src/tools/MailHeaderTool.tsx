import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { CopyableIntelSection } from '../components/CopyableIntelSection';
import { sound } from '../utils/audio';
import { useIsPaneActive } from '../utils/paneContext';
import { parseEmailMessageHeader, type MailHeaderAnalysis } from './mailHeaderParser';

const SAMPLE_MAIL_HEADERS = `Delivered-To: commander@subwrite.se
Received: by 2002:a05:6512:123:: with SMTP id a123;
        Tue, 3 Nov 2026 12:34:56 -0800 (PST)
X-Received: by 2002:a05:6512:456:: with SMTP id b456;
        Tue, 3 Nov 2026 12:34:55 -0800 (PST)
Received: from mail-ed1-f52.google.com (mail-ed1-f52.google.com. [209.85.208.52])
        by mx.google.com with ESMTPS id c789
        for <commander@subwrite.se>
        (version=TLS1_3 cipher=TLS_AES_128_GCM_SHA256 bits=128/128);
        Tue, 03 Nov 2026 12:34:54 -0800 (PST)
Received-SPF: pass (google.com: domain of alert@subwrite.se designates 209.85.208.52 as permitted sender) client-ip=209.85.208.52;
Authentication-Results: mx.google.com;
       dkim=pass header.i=@subwrite.se header.s=20230601 header.b=w7Y12a;
       spf=pass (google.com: domain of alert@subwrite.se designates 209.85.208.52 as permitted sender) smtp.mailfrom=alert@subwrite.se;
       dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=subwrite.se
From: "Naval Command HQ" <alert@subwrite.se>
To: "R136 HMS Västervik" <commander@subwrite.se>
Subject: Tactical Transmission // Swedish Navy CIC Telemetry Status
Date: Tue, 03 Nov 2026 20:34:50 +0000
Message-ID: <cic-20261103-9941@subwrite.se>
Return-Path: <alert@subwrite.se>
DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=subwrite.se; s=20230601;
        h=from:to:subject:date:message-id:return-path;
        bh=kO8m9...; b=w7Y12a...`;

export const MailHeaderTool: React.FC = () => {
  const isPaneActive = useIsPaneActive();
  const [headerInput, setHeaderInput] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MailHeaderAnalysis | null>(null);
  const [showAllHeaders, setShowAllHeaders] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'all' | 'hops' | 'auth'>('all');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const copyText = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      sound.playCopy();
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 1600);
    } catch {
      sound.playError();
    }
  }, []);

  const analyzeHeaders = useCallback((textToAnalyze?: string) => {
    const raw = (textToAnalyze !== undefined ? textToAnalyze : headerInput).trim();
    if (!raw) return;

    sound.playRadarPing();
    const result = parseEmailMessageHeader(raw);

    if (result.error) {
      // Rule 2.2: "Navy Mail Header Format Not DETECTED!" and clear input
      setError(result.error);
      setHeaderInput('');
      setData(null);
      sound.playError();
      return;
    }

    if (result.data) {
      setData(result.data);
      setError(null);
      setShowAllHeaders(false);
      sound.playClick();
    }
  }, [headerInput]);

  // Overall copy payloads
  const hopsOverallPayload = useMemo(() => {
    if (!data) return '';
    const lines = [
      `=== EMAIL MESSAGE TRACE & HOPS (${data.summary.subject}) ===`,
      `From: ${data.summary.from}`,
      `To: ${data.summary.to}`,
      `Date: ${data.summary.date}`,
      `Message-ID: ${data.summary.messageId}`,
      `Total Hops: ${data.hops.length}`,
      '',
      '--- CHRONOLOGICAL TRANSPORT HOPS ---',
    ];
    for (const hop of data.hops) {
      lines.push(
        `#${hop.hop}: From [${hop.from}] -> By [${hop.by}] via ${hop.protocol}${hop.ip ? ` (${hop.ip})` : ''} | Delay: +${hop.delaySeconds}s | Time: ${hop.timestamp || hop.dateString}`
      );
      if (hop.tls) lines.push(`     TLS: ${hop.tls}`);
    }
    return lines.join('\n');
  }, [data]);

  const authOverallPayload = useMemo(() => {
    if (!data) return '';
    const lines = [
      `=== SENDER SECURITY & AUTHENTICATION AUDIT (${data.summary.subject}) ===`,
      `SPF: [${data.auth.spf.status}] ${data.auth.spf.details || 'No SPF record found in headers'}`,
      `DKIM: [${data.auth.dkim.status}] ${data.auth.dkim.details || 'No DKIM signatures recorded'}`,
      `DMARC: [${data.auth.dmarc.status}] ${data.auth.dmarc.details || 'No DMARC result found in headers'}`,
      `ARC: [${data.auth.arc.status}] ${data.auth.arc.details || 'Not present'}`,
    ];
    if (data.auth.dkim.signatures.length > 0) {
      lines.push('', '--- DKIM SIGNATURE DETAILS ---');
      for (const sig of data.auth.dkim.signatures) {
        lines.push(`Domain (d=): ${sig.domain} | Selector (s=): ${sig.selector} | Alg: ${sig.algorithm}`);
      }
    }
    return lines.join('\n');
  }, [data]);

  const rawHeadersCopyPayload = useMemo(() => {
    if (!data) return '';
    return data.allHeaders.map((h) => `${h.name}: ${h.value}`).join('\n');
  }, [data]);

  // Keyboard shortcuts
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
        textareaRef.current?.focus();
        textareaRef.current?.select();
        return;
      }

      if (k === 'r') {
        e.preventDefault();
        analyzeHeaders();
        return;
      }

      if (!data) return;

      // 1: Shortcut [C] fallback when not on a tab-focused item
      if (k === 'c') {
        e.preventDefault();
        if (activeTab === 'auth') {
          void copyText(authOverallPayload, 'auth-all');
        } else {
          void copyText(hopsOverallPayload, 'hops-all');
        }
        return;
      }

      if (k === 'a') {
        e.preventDefault();
        sound.playClick();
        setActiveTab('all');
      } else if (k === 'h') {
        e.preventDefault();
        sound.playClick();
        setActiveTab('hops');
      } else if (k === 'u') {
        e.preventDefault();
        sound.playClick();
        setActiveTab('auth');
      } else if (k === 'v') {
        e.preventDefault();
        sound.playClick();
        setShowAllHeaders((v) => !v);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPaneActive, data, activeTab, analyzeHeaders, copyText, hopsOverallPayload, authOverallPayload]);

  return (
    <div className="tool-panel">
      {/* INPUT QUERY BAR */}
      <form
        className="query-bar c64-box"
        onSubmit={(e) => {
          e.preventDefault();
          analyzeHeaders();
        }}
      >
        <div className="section-title-row">
          <span className="prompt-chevron" title="Press [Q] to focus textarea">
            PASTE EMAIL MESSAGE HEADERS [Q]&gt;
          </span>
          <div className="section-header-right">
            <button
              type="button"
              className="navy-chip-btn"
              onClick={() => {
                setHeaderInput(SAMPLE_MAIL_HEADERS);
                analyzeHeaders(SAMPLE_MAIL_HEADERS);
              }}
            >
              SAMPLE GMAIL/ESMTP HEADER
            </button>
            <button
              type="button"
              className="navy-btn btn-xs"
              onClick={() => {
                setHeaderInput('');
                setData(null);
                setError(null);
              }}
            >
              CLEAR
            </button>
          </div>
        </div>

        <textarea
          ref={textareaRef}
          rows={7}
          value={headerInput}
          onChange={(e) => setHeaderInput(e.target.value)}
          placeholder="Paste raw email message headers (Received:, From:, To:, DKIM-Signature:, Authentication-Results:, etc.)..."
          className="navy-input cert-textarea"
          spellCheck={false}
        />

        <div className="query-input-group">
          <button type="submit" disabled={!headerInput.trim()} className="navy-btn btn-primary">
            ► ANALYZE EMAIL HEADERS [R]
          </button>
        </div>
      </form>

      {/* ERROR BANNER (Rule 2.2: "Navy Mail Header Format Not DETECTED!") */}
      {error && (
        <div className="alert-banner status-err c64-box">
          ⚠ {error}
        </div>
      )}

      {!data && !error && (
        <div className="empty-prompt c64-box">
          Paste any raw email message header above and press <kbd>ENTER</kbd> or <strong>ANALYZE HEADERS [R]</strong> to
          trace mail server hops, verify SPF / DKIM / DMARC authentication, and diagnose transport latency.
        </div>
      )}

      {data && (
        <>
          {/* TELEMETRY STRIP */}
          <div className="telemetry-strip c64-box">
            <div className="tele-cell">
              <span className="tele-lbl">TOTAL HOPS</span>
              <span className="tele-val text-gold">{data.summary.totalHops} HOPS</span>
            </div>
            <div className="tele-cell">
              <span className="tele-lbl">SPF</span>
              <span
                className={`tele-val ${
                  data.auth.spf.status === 'PASS'
                    ? 'status-ok'
                    : data.auth.spf.status === 'NOT DETECTED'
                    ? 'status-warn'
                    : 'status-err'
                }`}
              >
                {data.auth.spf.status}
              </span>
            </div>
            <div className="tele-cell">
              <span className="tele-lbl">DKIM</span>
              <span
                className={`tele-val ${
                  data.auth.dkim.status === 'PASS' || data.auth.dkim.status === 'SIGNED'
                    ? 'status-ok'
                    : data.auth.dkim.status === 'NOT DETECTED'
                    ? 'status-warn'
                    : 'status-err'
                }`}
              >
                {data.auth.dkim.status}
              </span>
            </div>
            <div className="tele-cell">
              <span className="tele-lbl">DMARC</span>
              <span
                className={`tele-val ${
                  data.auth.dmarc.status === 'PASS'
                    ? 'status-ok'
                    : data.auth.dmarc.status === 'NOT DETECTED'
                    ? 'status-warn'
                    : 'status-err'
                }`}
              >
                {data.auth.dmarc.status}
              </span>
            </div>
          </div>

          {/* VIEW FILTER TABS */}
          <div className="sub-tabs-row">
            {(
              [
                { id: 'all', label: 'ALL INTEL [A]' },
                { id: 'hops', label: 'MESSAGE TRACE / HOPS [H]' },
                { id: 'auth', label: 'SPF / DKIM / DMARC AUDIT [U]' },
              ] as Array<{ id: 'all' | 'hops' | 'auth'; label: string }>
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

          {/* 1. MESSAGE SUMMARY & HOPS TRACE */}
          {(activeTab === 'all' || activeTab === 'hops') && (
            <CopyableIntelSection
              title="► EMAIL MESSAGE TRANSPORT TRACE & HOPS"
              badge={`${data.summary.totalHops} HOPS`}
              copyPayload={hopsOverallPayload}
            >
              {/* ENVELOPE METADATA TILES (HORIZONTAL TILES, TAB-SELECTABLE & COPYABLE) */}
              <div className="horizontal-tiles-list">
                {[
                  {
                    key: 'meta-subject',
                    label: 'SUBJECT',
                    val: data.summary.subject,
                    payload: `Subject: ${data.summary.subject}`,
                    highlight: 'text-gold',
                  },
                  {
                    key: 'meta-from',
                    label: 'SENDER (FROM)',
                    val: data.summary.from,
                    payload: `From: ${data.summary.from}`,
                    highlight: 'text-cyan',
                  },
                  {
                    key: 'meta-to',
                    label: 'RECIPIENT (TO)',
                    val: data.summary.to,
                    payload: `To: ${data.summary.to}`,
                    highlight: '',
                  },
                  {
                    key: 'meta-date',
                    label: 'ORIGINATION DATE',
                    val: data.summary.date || '—',
                    payload: `Date: ${data.summary.date}`,
                    highlight: '',
                  },
                  ...(data.summary.messageId
                    ? [
                        {
                          key: 'meta-msgid',
                          label: 'MESSAGE-ID',
                          val: data.summary.messageId,
                          payload: `Message-ID: ${data.summary.messageId}`,
                          highlight: 'text-gold',
                        },
                      ]
                    : []),
                  ...(data.summary.deliveredTo
                    ? [
                        {
                          key: 'meta-delivered',
                          label: 'DELIVERED TO',
                          val: data.summary.deliveredTo,
                          payload: `Delivered-To: ${data.summary.deliveredTo}`,
                          highlight: '',
                        },
                      ]
                    : []),
                ].map((tile) => (
                  <div
                    key={tile.key}
                    tabIndex={0}
                    className={`nav-tile focusable-row ${copiedKey === tile.key ? 'row-copied' : ''}`}
                    aria-label={`${tile.label}: ${tile.val} — Press C to copy`}
                    onKeyDown={(e) => {
                      if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'c' || e.key === 'C' || e.key === 'Enter')) {
                        e.preventDefault();
                        e.stopPropagation();
                        void copyText(tile.payload, tile.key);
                      }
                    }}
                  >
                    <div className="tile-badge-col">
                      <span className="tile-hdr-badge">{tile.label}</span>
                    </div>
                    <div className="tile-content-col">
                      <span className={`tile-main-val code-wrap-inline ${tile.highlight}`}>{tile.val}</span>
                    </div>
                    <div className="tile-action-col">
                      <button
                        type="button"
                        tabIndex={-1}
                        className={`navy-btn btn-xs ${copiedKey === tile.key ? 'btn-copied' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void copyText(tile.payload, tile.key);
                        }}
                      >
                        {copiedKey === tile.key ? '✓ COPIED' : 'COPY [C]'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* CHRONOLOGICAL HOP TABLE (HORIZONTAL TILES, TAB-SELECTABLE & COPYABLE) */}
              <div className="sub-card mt-8">
                <div className="sub-card-hdr">
                  CHRONOLOGICAL TRANSPORT HOPS (ORIGINATOR ➔ FINAL DESTINATION)
                </div>
                {data.hops.length === 0 ? (
                  <div className="dim-note">No Received: header hops detected in payload.</div>
                ) : (
                  <div className="horizontal-tiles-list">
                    {data.hops.map((hop) => {
                      const hopKey = `hop-${hop.hop}`;
                      const hopPayload = `Hop #${hop.hop}: From [${hop.from}] -> By [${hop.by}] via ${hop.protocol}${hop.ip ? ` (${hop.ip})` : ''} | Delay: +${hop.delaySeconds}s | Time: ${hop.timestamp || hop.dateString}${hop.tls ? `\nTLS: ${hop.tls}` : ''}\nRaw: ${hop.raw}`;
                      return (
                        <div
                          key={hopKey}
                          tabIndex={0}
                          className={`nav-tile focusable-row ${copiedKey === hopKey ? 'row-copied' : ''}`}
                          aria-label={`Hop #${hop.hop}: From ${hop.from} by ${hop.by} — Press C to copy`}
                          onKeyDown={(e) => {
                            if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'c' || e.key === 'C' || e.key === 'Enter')) {
                              e.preventDefault();
                              e.stopPropagation();
                              void copyText(hopPayload, hopKey);
                            }
                          }}
                        >
                          <div className="tile-badge-col">
                            <span className="hop-badge">HOP #{hop.hop}</span>
                            <span
                              className={`hop-delay-badge ${
                                hop.delaySeconds > 60
                                  ? 'status-err'
                                  : hop.delaySeconds > 10
                                  ? 'status-warn'
                                  : 'status-ok'
                              }`}
                            >
                              +{hop.delaySeconds}s
                            </span>
                          </div>
                          <div className="tile-content-col">
                            <div className="hop-route-line">
                              <span className="text-cyan">FROM:</span> <code>{hop.from}</code>
                              {' ➔ '}
                              <span className="text-gold">BY:</span> <code>{hop.by}</code>
                            </div>
                            <div className="hop-meta-line">
                              <span>Proto: <strong>{hop.protocol}</strong></span>
                              {hop.ip && <span>IP: <code>{hop.ip}</code></span>}
                              {hop.tls && <span className="status-ok">TLS: {hop.tls}</span>}
                              {hop.forRecipient && <span>For: <code>{hop.forRecipient}</code></span>}
                            </div>
                            <div className="hop-time-line dim-inline">
                              {hop.timestamp ? new Date(hop.timestamp).toUTCString() : hop.dateString}
                            </div>
                          </div>
                          <div className="tile-action-col">
                            <button
                              type="button"
                              tabIndex={-1}
                              className={`navy-btn btn-xs ${copiedKey === hopKey ? 'btn-copied' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                void copyText(hopPayload, hopKey);
                              }}
                            >
                              {copiedKey === hopKey ? '✓ COPIED' : 'COPY [C]'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </CopyableIntelSection>
          )}

          {/* 2. AUTHENTICATION & SECURITY AUDIT */}
          {(activeTab === 'all' || activeTab === 'auth') && (
            <CopyableIntelSection
              title="► SENDER AUTHENTICATION (SPF / DKIM / DMARC / ARC)"
              copyPayload={authOverallPayload}
            >
              {/* HORIZONTAL TILES FOR SPF, DKIM, DMARC, ARC (1.1 & 1.2) */}
              <div className="horizontal-tiles-list">
                {/* SPF TILE */}
                {(() => {
                  const spfKey = 'auth-spf';
                  const spfPayload = `SPF (Sender Policy Framework): [${data.auth.spf.status}]\n${data.auth.spf.details || 'No SPF record evaluated in headers'}`;
                  return (
                    <div
                      tabIndex={0}
                      className={`nav-tile focusable-row ${copiedKey === spfKey ? 'row-copied' : ''}`}
                      aria-label={`SPF: ${data.auth.spf.status} — Press C to copy`}
                      onKeyDown={(e) => {
                        if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'c' || e.key === 'C' || e.key === 'Enter')) {
                          e.preventDefault();
                          e.stopPropagation();
                          void copyText(spfPayload, spfKey);
                        }
                      }}
                    >
                      <div className="tile-badge-col">
                        <span className="tile-hdr-badge">SPF</span>
                        <span
                          className={`auth-status-pill ${
                            data.auth.spf.status === 'PASS'
                              ? 'status-ok'
                              : data.auth.spf.status === 'NOT DETECTED'
                              ? 'status-warn'
                              : 'status-err'
                          }`}
                        >
                          {data.auth.spf.status}
                        </span>
                      </div>
                      <div className="tile-content-col">
                        <div className="tile-title-line">
                          <strong>SENDER POLICY FRAMEWORK (SPF)</strong>
                        </div>
                        <p className="policy-note">
                          {data.auth.spf.details || 'No SPF evaluation found in Authentication-Results or Received-SPF.'}
                        </p>
                      </div>
                      <div className="tile-action-col">
                        <button
                          type="button"
                          tabIndex={-1}
                          className={`navy-btn btn-xs ${copiedKey === spfKey ? 'btn-copied' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void copyText(spfPayload, spfKey);
                          }}
                        >
                          {copiedKey === spfKey ? '✓ COPIED' : 'COPY [C]'}
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* DKIM TILE */}
                {(() => {
                  const dkimKey = 'auth-dkim';
                  const sigDetails = data.auth.dkim.signatures
                    .map((s) => `d=${s.domain} s=${s.selector} (${s.algorithm})`)
                    .join('\n');
                  const dkimPayload = `DKIM (DomainKeys Identified Mail): [${data.auth.dkim.status}]\n${data.auth.dkim.details || ''}\n${sigDetails}`;
                  return (
                    <div
                      tabIndex={0}
                      className={`nav-tile focusable-row ${copiedKey === dkimKey ? 'row-copied' : ''}`}
                      aria-label={`DKIM: ${data.auth.dkim.status} — Press C to copy`}
                      onKeyDown={(e) => {
                        if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'c' || e.key === 'C' || e.key === 'Enter')) {
                          e.preventDefault();
                          e.stopPropagation();
                          void copyText(dkimPayload, dkimKey);
                        }
                      }}
                    >
                      <div className="tile-badge-col">
                        <span className="tile-hdr-badge">DKIM</span>
                        <span
                          className={`auth-status-pill ${
                            data.auth.dkim.status === 'PASS' || data.auth.dkim.status === 'SIGNED'
                              ? 'status-ok'
                              : data.auth.dkim.status === 'NOT DETECTED'
                              ? 'status-warn'
                              : 'status-err'
                          }`}
                        >
                          {data.auth.dkim.status}
                        </span>
                      </div>
                      <div className="tile-content-col">
                        <div className="tile-title-line">
                          <strong>DOMAINKEYS IDENTIFIED MAIL (DKIM)</strong>
                        </div>
                        <p className="policy-note">
                          {data.auth.dkim.details ||
                            (data.auth.dkim.signatures.length > 0
                              ? `Found ${data.auth.dkim.signatures.length} DKIM cryptographic signature(s).`
                              : 'No DKIM signatures found in headers.')}
                        </p>
                        {data.auth.dkim.signatures.map((sig, idx) => (
                          <div key={`sig-${idx}`} className="kv-row">
                            <span className="text-gold">d={sig.domain}</span>
                            <span className="dim-inline">
                              s={sig.selector} ({sig.algorithm})
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="tile-action-col">
                        <button
                          type="button"
                          tabIndex={-1}
                          className={`navy-btn btn-xs ${copiedKey === dkimKey ? 'btn-copied' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void copyText(dkimPayload, dkimKey);
                          }}
                        >
                          {copiedKey === dkimKey ? '✓ COPIED' : 'COPY [C]'}
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* DMARC TILE */}
                {(() => {
                  const dmarcKey = 'auth-dmarc';
                  const dmarcPayload = `DMARC Policy Alignment: [${data.auth.dmarc.status}]\n${data.auth.dmarc.details || 'No DMARC result evaluated in mail headers'}`;
                  return (
                    <div
                      tabIndex={0}
                      className={`nav-tile focusable-row ${copiedKey === dmarcKey ? 'row-copied' : ''}`}
                      aria-label={`DMARC: ${data.auth.dmarc.status} — Press C to copy`}
                      onKeyDown={(e) => {
                        if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'c' || e.key === 'C' || e.key === 'Enter')) {
                          e.preventDefault();
                          e.stopPropagation();
                          void copyText(dmarcPayload, dmarcKey);
                        }
                      }}
                    >
                      <div className="tile-badge-col">
                        <span className="tile-hdr-badge">DMARC</span>
                        <span
                          className={`auth-status-pill ${
                            data.auth.dmarc.status === 'PASS'
                              ? 'status-ok'
                              : data.auth.dmarc.status === 'NOT DETECTED'
                              ? 'status-warn'
                              : 'status-err'
                          }`}
                        >
                          {data.auth.dmarc.status}
                        </span>
                      </div>
                      <div className="tile-content-col">
                        <div className="tile-title-line">
                          <strong>DMARC POLICY ALIGNMENT</strong>
                        </div>
                        <p className="policy-note">
                          {data.auth.dmarc.details || 'No DMARC result evaluated in mail headers.'}
                        </p>
                      </div>
                      <div className="tile-action-col">
                        <button
                          type="button"
                          tabIndex={-1}
                          className={`navy-btn btn-xs ${copiedKey === dmarcKey ? 'btn-copied' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void copyText(dmarcPayload, dmarcKey);
                          }}
                        >
                          {copiedKey === dmarcKey ? '✓ COPIED' : 'COPY [C]'}
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* ARC TILE */}
                {(() => {
                  const arcKey = 'auth-arc';
                  const arcPayload = `ARC (Authenticated Received Chain): [${data.auth.arc.status}]\n${data.auth.arc.details || 'No ARC forwarding authentication chain present'}`;
                  return (
                    <div
                      tabIndex={0}
                      className={`nav-tile focusable-row ${copiedKey === arcKey ? 'row-copied' : ''}`}
                      aria-label={`ARC: ${data.auth.arc.status} — Press C to copy`}
                      onKeyDown={(e) => {
                        if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'c' || e.key === 'C' || e.key === 'Enter')) {
                          e.preventDefault();
                          e.stopPropagation();
                          void copyText(arcPayload, arcKey);
                        }
                      }}
                    >
                      <div className="tile-badge-col">
                        <span className="tile-hdr-badge">ARC</span>
                        <span className={`auth-status-pill ${data.auth.arc.status === 'PRESENT' ? 'status-ok' : 'status-warn'}`}>
                          {data.auth.arc.status}
                        </span>
                      </div>
                      <div className="tile-content-col">
                        <div className="tile-title-line">
                          <strong>AUTHENTICATED RECEIVED CHAIN (ARC)</strong>
                        </div>
                        <p className="policy-note">
                          {data.auth.arc.details || 'No ARC forwarding authentication chain present.'}
                        </p>
                      </div>
                      <div className="tile-action-col">
                        <button
                          type="button"
                          tabIndex={-1}
                          className={`navy-btn btn-xs ${copiedKey === arcKey ? 'btn-copied' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void copyText(arcPayload, arcKey);
                          }}
                        >
                          {copiedKey === arcKey ? '✓ COPIED' : 'COPY [C]'}
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </CopyableIntelSection>
          )}

          {/* 3. RAW HEADERS EXPLORER */}
          <div className="c64-box">
            <div className="section-title-row">
              <button
                type="button"
                className="navy-btn btn-sm"
                onClick={() => {
                  sound.playClick();
                  setShowAllHeaders((v) => !v);
                }}
              >
                {showAllHeaders
                  ? `▼ HIDE RAW HEADERS (${data.allHeaders.length}) [V]`
                  : `► VIEW ALL RAW HEADERS (${data.allHeaders.length}) [V]`}
              </button>
              {showAllHeaders && (
                <button
                  type="button"
                  className="navy-btn btn-xs"
                  onClick={async () => {
                    await navigator.clipboard.writeText(rawHeadersCopyPayload);
                    sound.playCopy();
                  }}
                >
                  📋 COPY ALL RAW HEADERS
                </button>
              )}
            </div>

            {showAllHeaders && (
              <div className="mt-8">
                <table className="headers-table">
                  <tbody>
                    {data.allHeaders.map((h, idx) => (
                      <tr key={`hdr-${idx}`}>
                        <td className="hdr-name text-cyan">{h.name}:</td>
                        <td className="hdr-val code-wrap-inline">{h.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default MailHeaderTool;
