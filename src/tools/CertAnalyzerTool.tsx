import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { CopyableIntelSection } from '../components/CopyableIntelSection';
import { sound } from '../utils/audio';
import { useIsPaneActive } from '../utils/paneContext';
import type { CertAnalysisPayload } from './certTypes';

const SAMPLE_CERT = `-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----`;

const SAMPLE_CSR = `-----BEGIN CERTIFICATE REQUEST-----
MIICvDCCAaQCAQAwdzELMAkGA1UEBhMCU0UxFDASBgNVBAgMC1N0b2NraG9sbXN1
MRMwEQYDVQQHDApTdG9ja2hvbG0xHDAaBgNVBAoME1JveWFsIFN3ZWRpc2ggTmF2
eTEhMB8GA1UEAwwYdGVjaHRvb2xzLnN1YndyaXRlLnNlMIIBIjANBgkqhkiG9w0B
AQEFAAOCAQ8AMIIBCgKCAQEA3e5tY4590hP0Q7m389eJk22Y6/gDkP0tH3V0Z9b2
h2V3A1h7O8I4R0l2q6yV02X4X+A2F4j1m7A3Z4J6m4I2V3X7g2V3m4A1Z4J6e3V7
f2Z4J6A1Z4e3X7f2Z4J6e3X7h4J6e3V7A2X4m7f2Z4J6A1Z4m7A3Z4J6A1Z4m7A3
Z4J6A1Z4m7A3Z4J6A1Z4m7A3Z4J6A1Z4m7A3Z4J6A1Z4m7A3Z4J6A1Z4m7A3Z4J6
A1Z4m7A3Z4J6A1Z4m7A3Z4J6A1Z4m7A3Z4J6A1Z4m7A3Z4J6A1Z4m7A3Z4J6A1Z4
m7A3Z4J6A1Z4m7A3Z4J6A1Z4m7A3Z4J6A1Z4m7A3Z4J6A1Z4m7A3Z4J6A1Z4m7A3
Z4J6A1Z4m7A3Z4J6A1Z4m7A3Z4J6A1Z4m7A3Z4J6A1Z4m7A3Z4J6A1Z4m7A3AgMB
AAGgADANBgkqhkiG9w0BAQsFAAOCAQEAX8Z5V3m4A1Z4e3X7f2Z4J6A1Z4e3X7f2
Z4J6A1Z4e3X7f2Z4J6A1Z4e3X7f2Z4J6A1Z4e3X7f2Z4J6A1Z4e3X7f2Z4J6A1Z4
e3X7f2Z4J6A1Z4e3X7f2Z4J6A1Z4e3X7f2Z4J6A1Z4e3X7f2Z4J6A1Z4e3X7f2Z4
e3X7f2Z4J6A1Z4e3X7f2Z4J6A1Z4e3X7f2Z4J6A1Z4e3X7f2Z4J6A1Z4e3X7f2Z4
e3X7f2Z4J6A1Z4e3X7f2Z4J6A1Z4e3X7f2Z4J6A1Z4e3X7f2Z4J6A1Z4e3X7==
-----END CERTIFICATE REQUEST-----`;

export const CertAnalyzerTool: React.FC = () => {
  const isPaneActive = useIsPaneActive();
  const [certInput, setCertInput] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [securityAlert, setSecurityAlert] = useState<boolean>(false);
  const [data, setData] = useState<CertAnalysisPayload | null>(null);
  const [showRaw, setShowRaw] = useState<boolean>(false);
  const [copiedChain, setCopiedChain] = useState<boolean>(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const analyzeCertText = useCallback(async (textToAnalyze?: string) => {
    const raw = (textToAnalyze !== undefined ? textToAnalyze : certInput).trim();
    if (!raw) return;

    // Check for private key client-side immediately
    if (/-----BEGIN[ A-Z0-9_-]*(?:PRIVATE|ENCRYPTED)[ A-Z0-9_-]*KEY-----/i.test(raw)) {
      setSecurityAlert(true);
      setError('Security alert! We will not process private keys! Abandon Ship!');
      setData(null);
      sound.playError();
      return;
    }

    setLoading(true);
    setError(null);
    setSecurityAlert(false);
    sound.playRadarPing();

    try {
      const res = await fetch('/api/cert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: raw }),
      });
      const json = await res.json();

      if (!res.ok) {
        if (json.securityAlert) {
          setSecurityAlert(true);
          setError(json.error || 'Security alert! We will not process private keys! Abandon Ship!');
          setData(null);
          sound.playError();
        } else if (json.invalidFormat) {
          // Rule 1.4: "Navy Cert Format Not DETECTED!" and clear input
          setError('Navy Cert Format Not DETECTED!');
          setCertInput('');
          setData(null);
          sound.playError();
        } else {
          setError(json.error || 'Certificate parsing failed.');
          sound.playError();
        }
      } else {
        setData(json as CertAnalysisPayload);
        setShowRaw(false);
      }
    } catch {
      setError('Network failure contacting diagnostic console.');
      sound.playError();
    } finally {
      setLoading(false);
    }
  }, [certInput]);

  const handleCopyChain = useCallback(async () => {
    if (!data?.fullChainPem) return;
    try {
      await navigator.clipboard.writeText(data.fullChainPem);
      sound.playCopy();
      setCopiedChain(true);
      window.setTimeout(() => setCopiedChain(false), 1600);
    } catch {
      sound.playError();
    }
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
        if (!loading) void analyzeCertText();
        return;
      }

      if (k === 'x') {
        e.preventDefault();
        sound.playClick();
        if (data?.chainAvailable) void handleCopyChain();
        return;
      }

      if (k === 'v') {
        e.preventDefault();
        sound.playClick();
        setShowRaw((v) => !v);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPaneActive, loading, data, analyzeCertText, handleCopyChain]);

  // Formatted copy payload
  const formattedSummaryPayload = useMemo(() => {
    if (!data) return '';
    const lines: string[] = [`=== CERTIFICATE TELEMETRY (${data.formatType}) ===`];
    if (data.certRole) lines.push(`Role: ${data.certRole}`);
    lines.push(`Subject: ${data.subject}`);
    if (data.issuer) lines.push(`Issuer: ${data.issuer}`);
    if (data.validFrom) lines.push(`Valid From: ${data.validFrom}`);
    if (data.validTo) lines.push(`Valid To: ${data.validTo}`);
    if (data.validity) {
      lines.push(`Status: ${data.validity.status} (${data.validity.daysRemaining} days remaining)`);
    }
    if (data.trust) {
      lines.push(`Trust: ${data.trust.trusted ? 'TRUSTED ROOT' : 'UNTRUSTED'} [${data.trust.status}]`);
      lines.push(`Trust Note: ${data.trust.details}`);
    }
    if (data.sans && data.sans.length > 0) {
      lines.push(`Subject Alt Names (SAN): ${data.sans.join(', ')}`);
    }
    if (data.extendedKeyUsage && data.extendedKeyUsage.length > 0) {
      lines.push(`Extended Key Usage (EKU): ${data.extendedKeyUsage.join(', ')}`);
    }
    if (data.keyUsage && data.keyUsage.length > 0) {
      lines.push(`Key Usage: ${data.keyUsage.join(', ')}`);
    }
    if (data.publicKey?.type || data.publicKey?.algorithm) {
      lines.push(`Public Key: ${data.publicKey.type || data.publicKey.algorithm}`);
    }
    if (data.serialNumber) lines.push(`Serial: ${data.serialNumber}`);
    if (data.fingerprint256) lines.push(`SHA-256 Fingerprint: ${data.fingerprint256}`);
    if (data.chainAvailable) {
      lines.push(`Cert Chain: ${data.chainCount} certificates available in chain`);
    }
    return lines.join('\n');
  }, [data]);

  return (
    <div className="tool-panel">
      {/* INPUT FORM */}
      <form
        className="query-bar c64-box"
        onSubmit={(e) => {
          e.preventDefault();
          void analyzeCertText();
        }}
      >
        <div className="section-title-row">
          <span className="prompt-chevron" title="Press [Q] to focus textarea">
            PASTE CERTIFICATE / CSR / PUBLIC KEY [Q]&gt;
          </span>
          <div className="section-header-right">
            <button
              type="button"
              className="navy-chip-btn"
              onClick={() => {
                setCertInput(SAMPLE_CERT);
                void analyzeCertText(SAMPLE_CERT);
              }}
            >
              SAMPLE ROOT CERT
            </button>
            <button
              type="button"
              className="navy-chip-btn"
              onClick={() => {
                setCertInput(SAMPLE_CSR);
                void analyzeCertText(SAMPLE_CSR);
              }}
            >
              SAMPLE CSR
            </button>
            <button
              type="button"
              className="navy-btn btn-xs"
              onClick={() => {
                setCertInput('');
                setData(null);
                setError(null);
                setSecurityAlert(false);
              }}
            >
              CLEAR
            </button>
          </div>
        </div>

        <textarea
          ref={textareaRef}
          rows={7}
          value={certInput}
          onChange={(e) => setCertInput(e.target.value)}
          placeholder="Paste Base64 or PEM certificate (-----BEGIN CERTIFICATE-----), CSR (-----BEGIN CERTIFICATE REQUEST-----), or Public Key..."
          className="navy-input cert-textarea"
          spellCheck={false}
        />

        <div className="query-input-group">
          <button type="submit" disabled={loading || !certInput.trim()} className="navy-btn btn-primary">
            {loading ? 'ANALYZING CERTIFICATE...' : '► ANALYZE CERTIFICATE [R]'}
          </button>
          {data?.chainAvailable && (
            <button
              type="button"
              className={`navy-btn btn-gold ${copiedChain ? 'btn-copied' : ''}`}
              onClick={handleCopyChain}
              title="Copy Full Certificate Chain in Base64 PEM [X]"
            >
              {copiedChain ? '✓ CHAIN COPIED' : '📋 EXPORT FULL CHAIN [X]'}
            </button>
          )}
        </div>
      </form>

      {/* SECURITY ALERT BANNER (Rule 1.3: Private Key Detected) */}
      {securityAlert && (
        <div className="alert-banner status-err c64-box security-alert-card">
          <div className="security-alert-title">🚨 NAVAL SECURITY INTERCEPT // PRIVATE KEY DETECTED 🚨</div>
          <div className="security-alert-msg text-gold">Security alert! We will not process private keys! Abandon Ship!</div>
          <div className="dim-note mt-8">
            Private cryptographic keys must never be pasted into diagnostic consoles or transmitted across networks.
          </div>
        </div>
      )}

      {/* ERROR BANNER */}
      {error && !securityAlert && (
        <div className="alert-banner status-err c64-box">
          ⚠ {error}
        </div>
      )}

      {!data && !loading && !error && !securityAlert && (
        <div className="empty-prompt c64-box">
          Paste any X.509 Certificate (<kbd>.crt</kbd>, <kbd>.cer</kbd>, <kbd>.pem</kbd>, or raw Base64), Certificate
          Signing Request (<kbd>CSR</kbd>), or Public Key above and press <kbd>ENTER</kbd> or <strong>ANALYZE [R]</strong>.
        </div>
      )}

      {loading && (
        <div className="loading-radar c64-box">
          <span className="radar-spinner">◎</span> DECODING ASN.1 PARSING EXTENSIONS &amp; VALIDATING TRUST CHAIN...
        </div>
      )}

      {data && !loading && (
        <>
          {/* TELEMETRY STRIP */}
          <div className="telemetry-strip c64-box">
            <div className="tele-cell">
              <span className="tele-lbl">PAYLOAD TYPE</span>
              <span className="tele-val text-gold">{data.formatType}</span>
            </div>
            <div className="tele-cell">
              <span className="tele-lbl">ROLE / LEVEL</span>
              <span className="tele-val text-cyan">
                {data.certRole || (data.formatType === 'CSR' ? 'CERT REQUEST' : 'PUBLIC KEY')}
              </span>
            </div>
            <div className="tele-cell">
              <span className="tele-lbl">TRUST STATUS</span>
              <span
                className={`tele-val ${
                  data.trust?.trusted
                    ? 'status-ok'
                    : data.trust?.status === 'SELF_SIGNED'
                    ? 'status-warn'
                    : data.trust
                    ? 'status-err'
                    : 'text-cyan'
                }`}
              >
                {data.trust ? (data.trust.trusted ? 'TRUSTED ROOT' : data.trust.status) : 'N/A'}
              </span>
            </div>
            <div className="tele-cell">
              <span className="tele-lbl">EXPIRATION</span>
              <span
                className={`tele-val ${
                  data.validity?.isExpired
                    ? 'status-err'
                    : (data.validity?.daysRemaining ?? 100) < 30
                    ? 'status-warn'
                    : 'status-ok'
                }`}
              >
                {data.validity
                  ? data.validity.isExpired
                    ? 'EXPIRED'
                    : `${data.validity.daysRemaining} DAYS`
                  : 'N/A'}
              </span>
            </div>
          </div>

          {/* MAIN DIAGNOSTIC SECTIONS */}
          <CopyableIntelSection
            title={`► ${data.formatType} IDENTITY & SUBJECT DETAILS`}
            badge={data.certRole || data.formatType}
            copyPayload={formattedSummaryPayload}
          >
            <div className="whois-grid">
              <div className="whois-item">
                <span className="tele-lbl">SUBJECT</span>
                <span className="tele-val text-gold code-wrap-inline">{data.subject}</span>
              </div>
              {data.issuer && (
                <div className="whois-item">
                  <span className="tele-lbl">ISSUER (CA)</span>
                  <span className="tele-val text-cyan code-wrap-inline">{data.issuer}</span>
                </div>
              )}
              {data.validFrom && (
                <div className="whois-item">
                  <span className="tele-lbl">VALID FROM (NOT BEFORE)</span>
                  <span className="tele-val">{data.validFrom}</span>
                </div>
              )}
              {data.validTo && (
                <div className="whois-item">
                  <span className="tele-lbl">VALID UNTIL (NOT AFTER)</span>
                  <span
                    className={`tele-val ${
                      data.validity?.isExpired ? 'status-err' : 'text-gold'
                    }`}
                  >
                    {data.validTo}
                  </span>
                </div>
              )}
              {data.trust && (
                <div className="whois-item">
                  <span className="tele-lbl">TRUST VERIFICATION</span>
                  <span
                    className={`tele-val ${
                      data.trust.trusted ? 'status-ok' : 'status-warn'
                    }`}
                  >
                    {data.trust.details}
                  </span>
                </div>
              )}
              <div className="whois-item">
                <span className="tele-lbl">PUBLIC KEY ALGORITHM</span>
                <span className="tele-val text-cyan">
                  {data.publicKey.type || data.publicKey.algorithm || 'Unknown'}
                  {typeof data.publicKey.details === 'object' && data.publicKey.details?.modulusLength
                    ? ` (${data.publicKey.details.modulusLength}-bit)`
                    : typeof data.publicKey.details === 'string'
                    ? ` (${data.publicKey.details})`
                    : ''}
                </span>
              </div>
              {data.serialNumber && (
                <div className="whois-item">
                  <span className="tele-lbl">SERIAL NUMBER</span>
                  <span className="tele-val code-wrap-inline text-gold">{data.serialNumber}</span>
                </div>
              )}
              {data.fingerprint256 && (
                <div className="whois-item">
                  <span className="tele-lbl">SHA-256 FINGERPRINT</span>
                  <span className="tele-val code-wrap-inline">{data.fingerprint256}</span>
                </div>
              )}
            </div>

            {/* SUBJECT ALTERNATIVE NAMES (SAN) */}
            {data.sans && data.sans.length > 0 && (
              <div className="sub-card mt-8">
                <div className="sub-card-hdr">
                  SUBJECT ALTERNATIVE NAMES (SAN) — {data.sans.length} ENTRIES
                </div>
                <div className="san-tags-grid">
                  {data.sans.map((san) => (
                    <span key={san} className="cap-tag">
                      {san}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* EXTENDED KEY USAGE (SERVER / CLIENT / CODE SIGNING) */}
            {data.extendedKeyUsage && data.extendedKeyUsage.length > 0 && (
              <div className="sub-card mt-8">
                <div className="sub-card-hdr">EXTENDED KEY USAGE (EKU / ROLES)</div>
                <div className="san-tags-grid">
                  {data.extendedKeyUsage.map((eku) => (
                    <span
                      key={eku}
                      className={`cap-tag ${
                        eku.includes('Server') || eku.includes('Client') ? 'status-ok' : ''
                      }`}
                    >
                      {eku}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* KEY USAGE */}
            {data.keyUsage && data.keyUsage.length > 0 && (
              <div className="sub-card mt-8">
                <div className="sub-card-hdr">KEY USAGE CONSTRAINTS</div>
                <div className="san-tags-grid">
                  {data.keyUsage.map((ku) => (
                    <span key={ku} className="cap-tag">
                      {ku}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* FULL CERTIFICATE CHAIN EXPORT (Rule 1.1) */}
            {data.chainAvailable && data.fullChainPem && (
              <div className="sub-card mt-8">
                <div className="sub-card-hdr">
                  FULL CERTIFICATE CHAIN ({data.chainCount} CERTIFICATES DISCOVERED)
                </div>
                <p className="policy-note">
                  Complete trust path from End-Entity through Intermediate CA(s) to Root CA is ready for export.
                </p>
                <div className="action-bar-right mt-8">
                  <button
                    type="button"
                    className={`navy-btn btn-gold ${copiedChain ? 'btn-copied' : ''}`}
                    onClick={handleCopyChain}
                  >
                    {copiedChain ? '✓ CHAIN COPIED' : '📋 EXPORT FULL CHAIN IN BASE64 [X]'}
                  </button>
                </div>
              </div>
            )}

            {/* OPENSSL TEXT RAW DECODE */}
            {data.opensslText && (
              <div className="mt-8">
                <button
                  type="button"
                  className="navy-btn btn-sm"
                  onClick={() => {
                    sound.playClick();
                    setShowRaw((v) => !v);
                  }}
                >
                  {showRaw ? '▼ HIDE OPENSSL ASN.1 TEXT [V]' : '► VIEW OPENSSL ASN.1 TEXT [V]'}
                </button>
                {showRaw && (
                  <pre
                    tabIndex={0}
                    className="raw-pre-box copyable-pre"
                    aria-label="Raw ASN.1 Certificate text output"
                  >
                    {data.opensslText}
                  </pre>
                )}
              </div>
            )}
          </CopyableIntelSection>
        </>
      )}
    </div>
  );
};

export default CertAnalyzerTool;
