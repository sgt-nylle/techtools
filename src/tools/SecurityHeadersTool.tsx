import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { CopyableIntelSection } from '../components/CopyableIntelSection';
import { sound } from '../utils/audio';
import { useIsPaneActive } from '../utils/paneContext';

type ComplianceVerdict = 'PASS' | 'WARN' | 'FAIL';
type ChecklistFilter = 'all' | 'issues' | 'csp' | 'raw';

interface HeaderCheckResult {
  id: string;
  headerName: string;
  title: string;
  verdict: ComplianceVerdict;
  scoreEarned: number;
  maxScore: number;
  rawValue: string | null;
  summary: string;
  findings: string[];
  recommendation: string;
}

interface CspDirectiveBreakdown {
  directive: string;
  values: string[];
  hasUnsafeInline: boolean;
  hasUnsafeEval: boolean;
  hasWildcard: boolean;
  hasDataOrBlob: boolean;
}

interface ProbeSecurityPayload {
  finalUrl: string;
  hostname: string;
  port: number;
  reachability: string;
  totalDurationMs: number;
  dns: {
    resolvedIp: string | null;
    dnsMs: number;
  };
  tls: {
    connected: boolean;
    protocol: string | null;
  } | null;
  http: {
    httpVersion: string;
    statusCode: number;
    statusMessage: string;
    headers: Array<{ name: string; value: string }>;
    securityHeaders: {
      hsts: string | null;
      csp: string | null;
      cspReportOnly?: string | null;
      xFrameOptions: string | null;
      xContentTypeOptions: string | null;
      referrerPolicy: string | null;
      permissionsPolicy?: string | null;
      crossOriginOpenerPolicy?: string | null;
      crossOriginResourcePolicy?: string | null;
      crossOriginEmbedderPolicy?: string | null;
    };
  } | null;
}

function getHeaderCaseInsensitive(headers: Array<{ name: string; value: string }>, target: string): string | null {
  const lower = target.toLowerCase();
  const matches = headers.filter((h) => h.name.toLowerCase() === lower);
  if (matches.length === 0) return null;
  return matches.map((m) => m.value).join('; ');
}

function parseCspDirectives(cspRaw: string | null): CspDirectiveBreakdown[] {
  if (!cspRaw || !cspRaw.trim()) return [];
  const segments = cspRaw
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  return segments.map((seg) => {
    const tokens = seg.split(/\s+/).filter(Boolean);
    const directive = (tokens[0] || '').toLowerCase();
    const values = tokens.slice(1);
    const lowerVals = values.map((v) => v.toLowerCase());

    return {
      directive,
      values,
      hasUnsafeInline: lowerVals.some((v) => v.includes("'unsafe-inline'")),
      hasUnsafeEval: lowerVals.some((v) => v.includes("'unsafe-eval'") || v.includes("'wasm-unsafe-eval'")),
      hasWildcard: lowerVals.some((v) => v === '*' || v === 'http:' || v === 'https:' || v.startsWith('*.')),
      hasDataOrBlob: lowerVals.some((v) => v === 'data:' || v === 'blob:'),
    };
  });
}

function evaluateSecurityCompliance(payload: ProbeSecurityPayload): {
  totalScore: number;
  maxScore: number;
  grade: string;
  gradeLabel: string;
  checks: HeaderCheckResult[];
  cspDirectives: CspDirectiveBreakdown[];
} {
  const headers = payload.http?.headers || [];
  const sec = payload.http?.securityHeaders;

  const hstsRaw = sec?.hsts ?? getHeaderCaseInsensitive(headers, 'strict-transport-security');
  const cspRaw = sec?.csp ?? getHeaderCaseInsensitive(headers, 'content-security-policy');
  const cspReportOnlyRaw =
    sec?.cspReportOnly ?? getHeaderCaseInsensitive(headers, 'content-security-policy-report-only');
  const xfoRaw = sec?.xFrameOptions ?? getHeaderCaseInsensitive(headers, 'x-frame-options');
  const xctoRaw = sec?.xContentTypeOptions ?? getHeaderCaseInsensitive(headers, 'x-content-type-options');
  const refRaw = sec?.referrerPolicy ?? getHeaderCaseInsensitive(headers, 'referrer-policy');
  const permRaw = sec?.permissionsPolicy ?? getHeaderCaseInsensitive(headers, 'permissions-policy');

  const cspDirectives = parseCspDirectives(cspRaw || cspReportOnlyRaw);
  const checks: HeaderCheckResult[] = [];

  // 1. HSTS (Strict-Transport-Security) — Max 20 pts
  {
    const maxScore = 20;
    if (!hstsRaw) {
      checks.push({
        id: 'hsts',
        headerName: 'Strict-Transport-Security',
        title: 'HSTS (HTTP STRICT TRANSPORT SECURITY)',
        verdict: 'FAIL',
        scoreEarned: 0,
        maxScore,
        rawValue: null,
        summary: 'Missing Strict-Transport-Security header — clients are vulnerable to SSL stripping / downgrade.',
        findings: ['Header not returned by endpoint.'],
        recommendation: 'Publish Strict-Transport-Security: max-age=31536000; includeSubDomains; preload',
      });
    } else {
      const mAgeMatch = hstsRaw.match(/max-age\s*=\s*(\d+)/i);
      const maxAge = mAgeMatch ? Number(mAgeMatch[1]) : 0;
      const hasSub = /includesubdomains/i.test(hstsRaw);
      const hasPreload = /preload/i.test(hstsRaw);
      const findings: string[] = [`max-age=${maxAge}s (~${Math.round(maxAge / 86400)} days)`];
      if (hasSub) findings.push('includeSubDomains enabled');
      if (hasPreload) findings.push('preload token present');

      if (maxAge >= 31_536_000) {
        checks.push({
          id: 'hsts',
          headerName: 'Strict-Transport-Security',
          title: 'HSTS (HTTP STRICT TRANSPORT SECURITY)',
          verdict: 'PASS',
          scoreEarned: 20,
          maxScore,
          rawValue: hstsRaw,
          summary: `Strong HSTS policy enforced (${Math.round(maxAge / 86400)} days${hasSub ? ' + includeSubDomains' : ''}).`,
          findings,
          recommendation: hasSub
            ? 'HSTS configuration meets naval & OWASP baseline.'
            : 'Consider adding includeSubDomains to protect all child hosts.',
        });
      } else if (maxAge > 0) {
        checks.push({
          id: 'hsts',
          headerName: 'Strict-Transport-Security',
          title: 'HSTS (HTTP STRICT TRANSPORT SECURITY)',
          verdict: 'WARN',
          scoreEarned: 12,
          maxScore,
          rawValue: hstsRaw,
          summary: `HSTS is enabled, but max-age (${maxAge}s) is shorter than the recommended 1 year (31536000s).`,
          findings,
          recommendation: 'Increase max-age to at least 31536000 (1 year).',
        });
      } else {
        checks.push({
          id: 'hsts',
          headerName: 'Strict-Transport-Security',
          title: 'HSTS (HTTP STRICT TRANSPORT SECURITY)',
          verdict: 'FAIL',
          scoreEarned: 0,
          maxScore,
          rawValue: hstsRaw,
          summary: 'HSTS max-age is 0 or malformed, which immediately disables HSTS caching.',
          findings,
          recommendation: 'Set Strict-Transport-Security: max-age=31536000; includeSubDomains',
        });
      }
    }
  }

  // 2. CSP (Content-Security-Policy) — Max 30 pts
  {
    const maxScore = 30;
    if (!cspRaw) {
      checks.push({
        id: 'csp',
        headerName: 'Content-Security-Policy',
        title: 'CSP (CONTENT SECURITY POLICY)',
        verdict: cspReportOnlyRaw ? 'WARN' : 'FAIL',
        scoreEarned: cspReportOnlyRaw ? 10 : 0,
        maxScore,
        rawValue: cspReportOnlyRaw ? `[REPORT-ONLY] ${cspReportOnlyRaw}` : null,
        summary: cspReportOnlyRaw
          ? 'Only Content-Security-Policy-Report-Only is present (not actively blocking XSS).'
          : 'No Content-Security-Policy header published — browser lacks XSS & script injection guardrails.',
        findings: cspReportOnlyRaw
          ? ['Policy is in Report-Only mode; violations are logged but not blocked.']
          : ['Header not returned by endpoint.'],
        recommendation:
          "Publish an enforced Content-Security-Policy with default-src 'self' and avoid 'unsafe-inline' / 'unsafe-eval'.",
      });
    } else {
      const unsafeInlineDirs = cspDirectives.filter((d) => d.hasUnsafeInline).map((d) => d.directive);
      const unsafeEvalDirs = cspDirectives.filter((d) => d.hasUnsafeEval).map((d) => d.directive);
      const wildcardDirs = cspDirectives.filter((d) => d.hasWildcard).map((d) => d.directive);
      const hasDefaultOrScript = cspDirectives.some(
        (d) => d.directive === 'default-src' || d.directive === 'script-src'
      );

      const findings: string[] = [`${cspDirectives.length} directive(s) parsed`];
      let warnings = 0;

      if (unsafeInlineDirs.length > 0) {
        findings.push(`⚠ 'unsafe-inline' permitted in: ${unsafeInlineDirs.join(', ')}`);
        warnings++;
      }
      if (unsafeEvalDirs.length > 0) {
        findings.push(`⚠ 'unsafe-eval' permitted in: ${unsafeEvalDirs.join(', ')}`);
        warnings++;
      }
      if (wildcardDirs.length > 0) {
        findings.push(`⚠ Wildcard (*) origin permitted in: ${wildcardDirs.join(', ')}`);
        warnings++;
      }
      if (!hasDefaultOrScript) {
        findings.push('⚠ Missing default-src or script-src fallback directive');
        warnings++;
      }

      if (warnings === 0) {
        checks.push({
          id: 'csp',
          headerName: 'Content-Security-Policy',
          title: 'CSP (CONTENT SECURITY POLICY)',
          verdict: 'PASS',
          scoreEarned: 30,
          maxScore,
          rawValue: cspRaw,
          summary: "Strict CSP enforced with zero 'unsafe-inline', 'unsafe-eval', or wildcard (*) script origins.",
          findings,
          recommendation: 'CSP policy is hardened against XSS and arbitrary script execution.',
        });
      } else {
        const score = Math.max(12, 30 - warnings * 6);
        checks.push({
          id: 'csp',
          headerName: 'Content-Security-Policy',
          title: 'CSP (CONTENT SECURITY POLICY)',
          verdict: 'WARN',
          scoreEarned: score,
          maxScore,
          rawValue: cspRaw,
          summary: `CSP is active, but contains ${warnings} permissive directive warning(s) (${[
            unsafeInlineDirs.length ? "'unsafe-inline'" : '',
            unsafeEvalDirs.length ? "'unsafe-eval'" : '',
            wildcardDirs.length ? 'wildcard (*)' : '',
          ]
            .filter(Boolean)
            .join(', ') || 'missing default-src'}).`,
          findings,
          recommendation:
            "Replace 'unsafe-inline' with cryptographic nonces/hashes, remove 'unsafe-eval', and restrict wildcard (*) origins.",
        });
      }
    }
  }

  // 3. X-Frame-Options (or CSP frame-ancestors) — Max 15 pts
  {
    const maxScore = 15;
    const frameAncestors = cspDirectives.find((d) => d.directive === 'frame-ancestors');
    if (xfoRaw) {
      const clean = xfoRaw.trim().toUpperCase();
      const isStrong = clean === 'DENY' || clean === 'SAMEORIGIN';
      checks.push({
        id: 'xfo',
        headerName: 'X-Frame-Options',
        title: 'CLICKJACKING DEFENSE (X-FRAME-OPTIONS)',
        verdict: isStrong ? 'PASS' : 'WARN',
        scoreEarned: isStrong ? 15 : 8,
        maxScore,
        rawValue: xfoRaw,
        summary: isStrong
          ? `Clickjacking protection enforced via X-Frame-Options: ${clean}.`
          : `Non-standard or deprecated X-Frame-Options value (${xfoRaw}).`,
        findings: [
          `X-Frame-Options: ${xfoRaw}`,
          ...(frameAncestors ? [`Also reinforced by CSP frame-ancestors ${frameAncestors.values.join(' ')}`] : []),
        ],
        recommendation: 'Use DENY or SAMEORIGIN (and optionally CSP frame-ancestors).',
      });
    } else if (frameAncestors) {
      checks.push({
        id: 'xfo',
        headerName: 'X-Frame-Options',
        title: 'CLICKJACKING DEFENSE (X-FRAME-OPTIONS / FRAME-ANCESTORS)',
        verdict: 'PASS',
        scoreEarned: 15,
        maxScore,
        rawValue: `CSP frame-ancestors ${frameAncestors.values.join(' ')}`,
        summary: 'Clickjacking protection enforced via modern CSP frame-ancestors directive.',
        findings: ['X-Frame-Options omitted, but CSP frame-ancestors is present.'],
        recommendation: 'Optionally add X-Frame-Options: SAMEORIGIN for legacy user-agent compatibility.',
      });
    } else {
      checks.push({
        id: 'xfo',
        headerName: 'X-Frame-Options',
        title: 'CLICKJACKING DEFENSE (X-FRAME-OPTIONS)',
        verdict: 'FAIL',
        scoreEarned: 0,
        maxScore,
        rawValue: null,
        summary: 'Missing X-Frame-Options (and no CSP frame-ancestors) — page can be framed for clickjacking.',
        findings: ['Neither X-Frame-Options nor CSP frame-ancestors found.'],
        recommendation: "Set X-Frame-Options: DENY (or SAMEORIGIN) and CSP frame-ancestors 'none'.",
      });
    }
  }

  // 4. X-Content-Type-Options: nosniff — Max 15 pts
  {
    const maxScore = 15;
    if (xctoRaw && xctoRaw.trim().toLowerCase() === 'nosniff') {
      checks.push({
        id: 'xcto',
        headerName: 'X-Content-Type-Options',
        title: 'MIME SNIFFING GUARD (X-CONTENT-TYPE-OPTIONS)',
        verdict: 'PASS',
        scoreEarned: 15,
        maxScore,
        rawValue: xctoRaw,
        summary: 'X-Content-Type-Options: nosniff is active, preventing MIME-confusion attacks.',
        findings: ['nosniff strictly enforced.'],
        recommendation: 'Meets compliance baseline.',
      });
    } else if (xctoRaw) {
      checks.push({
        id: 'xcto',
        headerName: 'X-Content-Type-Options',
        title: 'MIME SNIFFING GUARD (X-CONTENT-TYPE-OPTIONS)',
        verdict: 'WARN',
        scoreEarned: 5,
        maxScore,
        rawValue: xctoRaw,
        summary: `Unexpected X-Content-Type-Options value "${xctoRaw}" (expected "nosniff").`,
        findings: [`Received: ${xctoRaw}`],
        recommendation: 'Set exact header X-Content-Type-Options: nosniff',
      });
    } else {
      checks.push({
        id: 'xcto',
        headerName: 'X-Content-Type-Options',
        title: 'MIME SNIFFING GUARD (X-CONTENT-TYPE-OPTIONS)',
        verdict: 'FAIL',
        scoreEarned: 0,
        maxScore,
        rawValue: null,
        summary: 'Missing X-Content-Type-Options: nosniff header.',
        findings: ['Browsers may attempt to MIME-sniff responses away from declared Content-Type.'],
        recommendation: 'Add X-Content-Type-Options: nosniff to all HTTP responses.',
      });
    }
  }

  // 5. Referrer-Policy — Max 10 pts
  {
    const maxScore = 10;
    const safePolicies = new Set([
      'no-referrer',
      'same-origin',
      'strict-origin',
      'strict-origin-when-cross-origin',
    ]);
    const weakPolicies = new Set(['unsafe-url', 'no-referrer-when-downgrade', 'origin', 'origin-when-cross-origin']);

    if (!refRaw) {
      checks.push({
        id: 'referrer',
        headerName: 'Referrer-Policy',
        title: 'REFERRER PRIVACY POLICY (REFERRER-POLICY)',
        verdict: 'FAIL',
        scoreEarned: 0,
        maxScore,
        rawValue: null,
        summary: 'Missing explicit Referrer-Policy header.',
        findings: ['Header not published.'],
        recommendation: 'Set Referrer-Policy: strict-origin-when-cross-origin or no-referrer.',
      });
    } else {
      const tokens = refRaw
        .toLowerCase()
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const effective = tokens[tokens.length - 1] || '';

      if (safePolicies.has(effective)) {
        checks.push({
          id: 'referrer',
          headerName: 'Referrer-Policy',
          title: 'REFERRER PRIVACY POLICY (REFERRER-POLICY)',
          verdict: 'PASS',
          scoreEarned: 10,
          maxScore,
          rawValue: refRaw,
          summary: `Privacy-preserving Referrer-Policy active (${effective}).`,
          findings: [`Effective policy: ${effective}`],
          recommendation: 'Meets compliance baseline.',
        });
      } else if (weakPolicies.has(effective)) {
        checks.push({
          id: 'referrer',
          headerName: 'Referrer-Policy',
          title: 'REFERRER PRIVACY POLICY (REFERRER-POLICY)',
          verdict: 'WARN',
          scoreEarned: 4,
          maxScore,
          rawValue: refRaw,
          summary: `Referrer-Policy (${effective}) may leak full URL paths or cross-origin parameters.`,
          findings: [`Effective policy: ${effective}`],
          recommendation: 'Harden to strict-origin-when-cross-origin or same-origin.',
        });
      } else {
        checks.push({
          id: 'referrer',
          headerName: 'Referrer-Policy',
          title: 'REFERRER PRIVACY POLICY (REFERRER-POLICY)',
          verdict: 'WARN',
          scoreEarned: 5,
          maxScore,
          rawValue: refRaw,
          summary: `Unrecognized Referrer-Policy token "${refRaw}".`,
          findings: [`Received: ${refRaw}`],
          recommendation: 'Set Referrer-Policy: strict-origin-when-cross-origin',
        });
      }
    }
  }

  // 6. Permissions-Policy — Max 10 pts
  {
    const maxScore = 10;
    if (!permRaw) {
      checks.push({
        id: 'permissions',
        headerName: 'Permissions-Policy',
        title: 'BROWSER FEATURE LOCKDOWN (PERMISSIONS-POLICY)',
        verdict: 'FAIL',
        scoreEarned: 0,
        maxScore,
        rawValue: null,
        summary: 'Missing Permissions-Policy header — sensitive browser APIs (camera, mic, geolocation) not explicitly restricted.',
        findings: ['Header not published.'],
        recommendation: 'Publish Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()',
      });
    } else {
      const hasWildcardAllow = /\*|\bself\b/i.test(permRaw) && !/=\(\s*\)/.test(permRaw);
      checks.push({
        id: 'permissions',
        headerName: 'Permissions-Policy',
        title: 'BROWSER FEATURE LOCKDOWN (PERMISSIONS-POLICY)',
        verdict: hasWildcardAllow ? 'WARN' : 'PASS',
        scoreEarned: hasWildcardAllow ? 6 : 10,
        maxScore,
        rawValue: permRaw,
        summary: hasWildcardAllow
          ? 'Permissions-Policy is published, but permits broad feature origins.'
          : 'Permissions-Policy actively restricts sensitive browser capabilities.',
        findings: [`Policy: ${permRaw}`],
        recommendation: 'Disable unused hardware/sensor APIs with empty allowlists e.g. camera=(), microphone=().',
      });
    }
  }

  const totalScore = checks.reduce((sum, c) => sum + c.scoreEarned, 0);
  const maxScore = checks.reduce((sum, c) => sum + c.maxScore, 0);

  let grade = 'F';
  let gradeLabel = 'CRITICAL NON-COMPLIANCE';
  if (totalScore >= 95) {
    grade = 'A+';
    gradeLabel = 'NAVAL FORTRESS GRADE';
  } else if (totalScore >= 85) {
    grade = 'A';
    gradeLabel = 'COMPLIANT & HARDENED';
  } else if (totalScore >= 70) {
    grade = 'B';
    gradeLabel = 'MODERATE POSTURE';
  } else if (totalScore >= 55) {
    grade = 'C';
    gradeLabel = 'PARTIAL HEADERS';
  } else if (totalScore >= 35) {
    grade = 'D';
    gradeLabel = 'WEAK SECURITY HEADERS';
  }

  return {
    totalScore,
    maxScore,
    grade,
    gradeLabel,
    checks,
    cspDirectives,
  };
}

export const SecurityHeadersTool: React.FC = () => {
  const isPaneActive = useIsPaneActive();
  const [urlInput, setUrlInput] = useState<string>('');
  const [followRedirects, setFollowRedirects] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ProbeSecurityPayload | null>(null);
  const [filter, setFilter] = useState<ChecklistFilter>('all');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const copyValue = useCallback(async (text: string, key: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      sound.playCopy();
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 1500);
    } catch {
      sound.playError();
    }
  }, []);

  const runEvaluation = useCallback(
    async (targetOverride?: string) => {
      const targetUrl = (targetOverride ?? urlInput).trim();
      if (!targetUrl) {
        setError('Enter a target URL or hostname to evaluate HTTP security headers (e.g. https://subwrite.se).');
        sound.playError();
        inputRef.current?.focus();
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
            port: 443,
            method: 'GET',
            followRedirects,
            tlsMode: 'auto',
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          setError(json.error || 'Failed to fetch target URL headers.');
          sound.playError();
        } else if (!json.http) {
          setError(
            json.tcp?.errorMessage ||
              json.tls?.errorMessage ||
              json.httpError ||
              `Target "${targetUrl}" did not return an HTTP response.`
          );
          sound.playError();
        } else {
          setData(json as ProbeSecurityPayload);
        }
      } catch {
        setError('Network error communicating with backend header inspection proxy.');
        sound.playError();
      } finally {
        setLoading(false);
      }
    },
    [urlInput, followRedirects]
  );

  // Single-letter keyboard shortcuts scoped to active pane
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
      } else if (k === 'r') {
        e.preventDefault();
        if (!loading) void runEvaluation();
      } else if (k === 'f') {
        e.preventDefault();
        sound.playClick();
        setFollowRedirects((v) => !v);
      } else if (data) {
        if (k === 'a') {
          e.preventDefault();
          sound.playClick();
          setFilter('all');
        } else if (k === 'w') {
          e.preventDefault();
          sound.playClick();
          setFilter('issues');
        } else if (k === 'p') {
          e.preventDefault();
          sound.playClick();
          setFilter('csp');
        } else if (k === 'v') {
          e.preventDefault();
          sound.playClick();
          setFilter('raw');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPaneActive, loading, data, runEvaluation]);

  const evaluation = useMemo(() => {
    if (!data || !data.http) return null;
    return evaluateSecurityCompliance(data);
  }, [data]);

  const copyReportPayload = useMemo(() => {
    if (!data || !evaluation) return '';
    const lines = [
      `=== HTTP SECURITY HEADERS & CSP COMPLIANCE REPORT ===`,
      `Target Endpoint: ${data.finalUrl} (${data.dns.resolvedIp || 'unresolved'})`,
      `Overall Security Score: ${evaluation.totalScore}/${evaluation.maxScore} — GRADE ${evaluation.grade} (${evaluation.gradeLabel})`,
      '',
      `--- RETRO TERMINAL COMPLIANCE CHECKLIST ---`,
      ...evaluation.checks.map(
        (c) =>
          `[${c.verdict}] ${c.headerName} (${c.scoreEarned}/${c.maxScore} pts): ${c.summary}${
            c.rawValue ? `\n       Value: ${c.rawValue}` : ''
          }\n       Recommendation: ${c.recommendation}`
      ),
    ];
    return lines.join('\n');
  }, [data, evaluation]);

  const passCount = evaluation ? evaluation.checks.filter((c) => c.verdict === 'PASS').length : 0;
  const warnCount = evaluation ? evaluation.checks.filter((c) => c.verdict === 'WARN').length : 0;
  const failCount = evaluation ? evaluation.checks.filter((c) => c.verdict === 'FAIL').length : 0;

  return (
    <div className="tool-panel">
      {/* TARGET URL BAR */}
      <form
        className="query-bar c64-box"
        onSubmit={(e) => {
          e.preventDefault();
          void runEvaluation();
        }}
      >
        <div className="query-input-group">
          <span className="prompt-chevron" title="Press [Q] to focus URL input">
            URL [Q]&gt;
          </span>
          <input
            ref={inputRef}
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://subwrite.se or corporate portal URL (ESC unlocks shortcuts)"
            className="navy-input"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
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
          <button type="submit" disabled={loading} className="navy-btn btn-primary">
            {loading ? 'AUDITING...' : '► EVALUATE HEADERS [R]'}
          </button>
        </div>

        <div className="quick-samples-row">
          <span className="quick-lbl">QUICK TARGETS:</span>
          {['https://subwrite.se', 'https://techtools.subwrite.se', 'https://github.com', 'https://cloudflare.com'].map(
            (sample) => (
              <button
                key={sample}
                type="button"
                className="navy-chip-btn"
                onClick={() => {
                  setUrlInput(sample);
                  void runEvaluation(sample);
                }}
              >
                {sample.replace(/^https:\/\//, '')}
              </button>
            )
          )}
        </div>
      </form>

      {error && <div className="alert-banner status-err c64-box">⚠ {error}</div>}

      {!data && !loading && !error && (
        <div className="empty-prompt c64-box">
          Enter any public URL above (<kbd>Q</kbd>) and press <kbd>ENTER</kbd> or <kbd>R</kbd> to inspect and score{' '}
          <strong className="text-gold">HSTS</strong>, <strong className="text-cyan">Content-Security-Policy (CSP)</strong>{' '}
          (flagging <code>&apos;unsafe-inline&apos;</code>, <code>&apos;unsafe-eval&apos;</code>, and wildcards),{' '}
          <code>X-Frame-Options</code>, <code>X-Content-Type-Options: nosniff</code>, <code>Referrer-Policy</code>, and{' '}
          <code>Permissions-Policy</code>.
        </div>
      )}

      {loading && (
        <div className="loading-radar c64-box">
          <span className="radar-spinner">◎</span> INTERROGATING TARGET HTTP SECURITY HEADERS &amp; PARSING CSP
          DIRECTIVES...
        </div>
      )}

      {data && evaluation && !loading && (
        <>
          {/* SCORE & VERDICT TELEMETRY STRIP */}
          <div className="telemetry-strip c64-box">
            <div className="tele-cell">
              <span className="tele-lbl">COMPLIANCE GRADE</span>
              <span
                className={`tele-val ${
                  evaluation.totalScore >= 85
                    ? 'status-ok'
                    : evaluation.totalScore >= 55
                    ? 'status-warn'
                    : 'status-err'
                }`}
              >
                GRADE {evaluation.grade} ({evaluation.totalScore}/{evaluation.maxScore})
              </span>
            </div>
            <div className="tele-cell">
              <span className="tele-lbl">CHECKLIST TALLY</span>
              <span className="tele-val">
                <span className="status-ok">{passCount} PASS</span> •{' '}
                <span className="status-warn">{warnCount} WARN</span> •{' '}
                <span className="status-err">{failCount} FAIL</span>
              </span>
            </div>
            <div className="tele-cell">
              <span className="tele-lbl">FINAL ENDPOINT</span>
              <span className="tele-val text-cyan">{data.finalUrl}</span>
            </div>
            <div className="tele-cell">
              <span className="tele-lbl">HTTP / TLS</span>
              <span className="tele-val text-gold">
                HTTP/{data.http?.httpVersion} {data.http?.statusCode} • {data.tls?.protocol || 'PLAIN'}
              </span>
            </div>
          </div>

          {/* VIEW FILTER TABS */}
          <div className="sub-tabs-row">
            <button
              type="button"
              className={`navy-tab-btn ${filter === 'all' ? 'active' : ''}`}
              onClick={() => {
                sound.playClick();
                setFilter('all');
              }}
            >
              ALL CHECKS ({evaluation.checks.length}) [A]
            </button>
            <button
              type="button"
              className={`navy-tab-btn ${filter === 'issues' ? 'active' : ''}`}
              onClick={() => {
                sound.playClick();
                setFilter('issues');
              }}
            >
              WARNINGS &amp; FAILURES ({warnCount + failCount}) [W]
            </button>
            <button
              type="button"
              className={`navy-tab-btn ${filter === 'csp' ? 'active' : ''}`}
              onClick={() => {
                sound.playClick();
                setFilter('csp');
              }}
            >
              CSP DIRECTIVE MATRIX ({evaluation.cspDirectives.length}) [P]
            </button>
            <button
              type="button"
              className={`navy-tab-btn ${filter === 'raw' ? 'active' : ''}`}
              onClick={() => {
                sound.playClick();
                setFilter('raw');
              }}
            >
              RAW HTTP HEADERS ({data.http?.headers.length || 0}) [V]
            </button>
          </div>

          {/* 1. RETRO TERMINAL COMPLIANCE CHECKLIST */}
          {(filter === 'all' || filter === 'issues') && (
            <CopyableIntelSection
              title="► RETRO TERMINAL SECURITY HEADER COMPLIANCE CHECKLIST"
              badge={`${evaluation.gradeLabel} • ${evaluation.totalScore}/${evaluation.maxScore} PTS`}
              copyPayload={copyReportPayload}
            >
              <div className="horizontal-tiles-list">
                {evaluation.checks
                  .filter((c) => (filter === 'issues' ? c.verdict !== 'PASS' : true))
                  .map((chk) => {
                    const rowKey = `chk-${chk.id}`;
                    const copyLine = `[${chk.verdict}] ${chk.headerName}: ${chk.rawValue || 'MISSING'}\n${chk.summary}\nRecommendation: ${chk.recommendation}`;
                    return (
                      <div
                        key={chk.id}
                        tabIndex={0}
                        className={`nav-tile focusable-row ${copiedKey === rowKey ? 'row-copied' : ''}`}
                        onClick={() => void copyValue(copyLine, rowKey)}
                        onKeyDown={(e) => {
                          if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'c' || e.key === 'C' || e.key === 'Enter')) {
                            e.preventDefault();
                            e.stopPropagation();
                            void copyValue(copyLine, rowKey);
                          }
                        }}
                      >
                        <div className="tile-badge-col">
                          <span
                            className={`compliance-badge ${
                              chk.verdict === 'PASS'
                                ? 'verdict-pass'
                                : chk.verdict === 'WARN'
                                ? 'verdict-warn'
                                : 'verdict-fail'
                            }`}
                          >
                            {chk.verdict === 'PASS' ? '✓ PASS' : chk.verdict === 'WARN' ? '⚠ WARN' : '✗ FAIL'}
                          </span>
                          <span className="auth-status-pill text-gold">
                            {chk.scoreEarned}/{chk.maxScore} PTS
                          </span>
                        </div>

                        <div className="tile-content-col">
                          <div className="tile-title-line">
                            <strong>{chk.title}</strong> <span className="dim-inline">({chk.headerName})</span>
                          </div>
                          <p className="policy-note">{chk.summary}</p>
                          {chk.rawValue && (
                            <code className="code-wrap-box">
                              {chk.headerName}: {chk.rawValue}
                            </code>
                          )}
                          {chk.findings.length > 0 && (
                            <div className="hop-meta-line">
                              {chk.findings.map((f, i) => (
                                <span
                                  key={`${chk.id}-f-${i}`}
                                  className={f.startsWith('⚠') ? 'status-warn' : 'text-cyan'}
                                >
                                  {f}
                                </span>
                              ))}
                            </div>
                          )}
                          {chk.verdict !== 'PASS' && (
                            <div className="dim-note">
                              <strong className="text-gold">FIX:</strong> {chk.recommendation}
                            </div>
                          )}
                        </div>

                        <div className="tile-action-col">
                          <button
                            type="button"
                            tabIndex={-1}
                            className={`navy-btn btn-xs ${copiedKey === rowKey ? 'btn-copied' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              void copyValue(copyLine, rowKey);
                            }}
                          >
                            {copiedKey === rowKey ? '✓ COPIED' : 'COPY [C]'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </CopyableIntelSection>
          )}

          {/* 2. CSP DIRECTIVE PARSER & UNSAFE TOKEN AUDITOR */}
          {(filter === 'all' || filter === 'csp') && (
            <CopyableIntelSection
              title="► CONTENT-SECURITY-POLICY (CSP) DIRECTIVE BREAKDOWN"
              badge={`${evaluation.cspDirectives.length} DIRECTIVES`}
              copyPayload={
                evaluation.cspDirectives
                  .map((d) => `${d.directive}: ${d.values.join(' ')}`)
                  .join('\n') || 'No CSP directives present.'
              }
            >
              {evaluation.cspDirectives.length === 0 ? (
                <div className="dim-note">
                  No <code>Content-Security-Policy</code> header was returned by <code>{data.finalUrl}</code>.
                </div>
              ) : (
                <div className="horizontal-tiles-list">
                  {evaluation.cspDirectives.map((dir, idx) => {
                    const hasIssue = dir.hasUnsafeInline || dir.hasUnsafeEval || dir.hasWildcard;
                    return (
                      <div key={`${dir.directive}-${idx}`} className="nav-tile">
                        <div className="tile-badge-col">
                          <span className="tile-hdr-badge">{dir.directive}</span>
                          <span className={`auth-status-pill ${hasIssue ? 'status-warn' : 'status-ok'}`}>
                            {hasIssue ? '⚠ PERMISSIVE' : '✓ STRICT'}
                          </span>
                        </div>
                        <div className="tile-content-col">
                          <div className="san-tags-grid">
                            {dir.values.length === 0 ? (
                              <span className="cap-tag">(none / boolean directive)</span>
                            ) : (
                              dir.values.map((val, vIdx) => {
                                const lower = val.toLowerCase();
                                const isBad =
                                  lower.includes("'unsafe-inline'") ||
                                  lower.includes("'unsafe-eval'") ||
                                  lower === '*' ||
                                  lower === 'http:' ||
                                  lower === 'https:';
                                return (
                                  <span
                                    key={`${dir.directive}-v-${vIdx}`}
                                    className={`cap-tag ${isBad ? 'status-err' : ''}`}
                                  >
                                    {val}
                                  </span>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CopyableIntelSection>
          )}

          {/* 3. RAW HTTP RESPONSE HEADERS */}
          {filter === 'raw' && data.http && (
            <CopyableIntelSection
              title={`► RAW HTTP RESPONSE HEADERS (${data.finalUrl})`}
              badge={`${data.http.headers.length} HEADERS`}
              copyPayload={data.http.headers.map((h) => `${h.name}: ${h.value}`).join('\n')}
            >
              <table className="headers-table">
                <tbody>
                  {data.http.headers.map((h, idx) => (
                    <tr key={`raw-hdr-${idx}`}>
                      <td className="hdr-name text-cyan">{h.name}:</td>
                      <td className="hdr-val code-wrap-inline">{h.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CopyableIntelSection>
          )}
        </>
      )}
    </div>
  );
};

export default SecurityHeadersTool;
