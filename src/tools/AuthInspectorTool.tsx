import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { CopyableIntelSection } from '../components/CopyableIntelSection';
import { sound } from '../utils/audio';
import { useIsPaneActive } from '../utils/paneContext';

type AuthInspectMode = 'jwt' | 'saml';

interface DecodedTimestampClaim {
  claim: string;
  label: string;
  epochSeconds: number;
  localTime: string;
  utcTime: string;
  relativeNote: string;
  status: 'ACTIVE' | 'EXPIRED' | 'FUTURE' | 'INFO';
}

interface HighlightedClaim {
  key: string;
  label: string;
  category: 'ENTRA_ID' | 'OIDC' | 'STANDARD';
  valueDisplay: string;
  rawValue: string;
}

interface DecodedJwtResult {
  rawHeaderB64: string;
  rawPayloadB64: string;
  rawSignatureB64: string;
  signatureByteLength: number;
   signatureHexPreview: string;
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  headerPretty: string;
  payloadPretty: string;
  algorithm: string;
  tokenType: string;
  keyId: string | null;
  issuer: string | null;
  subject: string | null;
  audience: string | null;
  overallStatus: 'ACTIVE' | 'EXPIRED' | 'NOT_YET_VALID' | 'NO_EXP';
  overallStatusBadge: string;
  timestamps: DecodedTimestampClaim[];
  entraAndOidcClaims: HighlightedClaim[];
}

interface DecodedSamlResult {
  rootElement: string;
  issuer: string | null;
  destination: string | null;
  inResponseTo: string | null;
  issueInstant: string | null;
  statusCode: string | null;
  nameId: string | null;
  notBefore: string | null;
  notOnOrAfter: string | null;
  audience: string | null;
  validityBadge: string;
  validityStatus: 'ACTIVE' | 'EXPIRED' | 'INFO';
  attributes: Array<{ name: string; values: string[] }>;
  formattedXml: string;
}

// Well-known Microsoft Entra ID Directory Role Template IDs (wids)
const ENTRA_WID_ROLES: Record<string, string> = {
  '62e90394-69f5-4237-9190-012177145e10': 'Global Administrator',
  'fe930be7-5e62-47db-91af-98c3a49a38b1': 'User Administrator',
  '194ae4cb-b126-40b2-bd5b-6091b380977d': 'Security Administrator',
  'f28a1f50-f6e7-4571-818b-6a12f2af6b6c': 'SharePoint Administrator',
  '29232cdf-9323-42fd-ade2-1d097af3e4de': 'Exchange Administrator',
  'b1be1c3e-b65d-4f19-8427-f6fa0d97feb9': 'Conditional Access Administrator',
  '9b895d92-2cd3-44c7-9d02-a6ac2d5ea5c3': 'Application Administrator',
  '158c047a-c907-4556-b7ef-446551a6b5f7': 'Cloud Application Administrator',
  'e8611ab8-c189-46e8-94e1-60213ab1f814': 'Privileged Role Administrator',
  '729827e3-9c14-49f7-bb1b-9608f156bbb8': 'Helpdesk Administrator',
  'b0f54661-2d74-4c50-afa3-1ec803f12efe': 'Billing Administrator',
};

function encodeBase64UrlJson(obj: Record<string, unknown>): string {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createSampleEntraJwt(): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    kid: 'R136_Vastervik_SigningKey_2026',
    x5t: 'nOo3ZDrODXEK1jKWhXslHR_KXEg',
  };
  const payload = {
    aud: 'api://techtools.subwrite.se/naval-cic-console',
    iss: 'https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/v2.0',
    iat: nowSec - 300,
    nbf: nowSec - 300,
    exp: nowSec + 2880,
    aio: 'E2ZgYDBkZGLi4uLiCgA=',
    amr: ['pwd', 'mfa', 'hwk'],
    azp: '9b895d92-2cd3-44c7-9d02-a6ac2d5ea5c3',
    name: 'Kommendörkapten Karlsson (R136)',
    oid: 'd4a9183e-52f8-4e9a-8812-3f9b0a11c136',
    preferred_username: 'k.karlsson@flottan.mil.se',
    upn: 'k.karlsson@flottan.mil.se',
    rh: '0.AXkAv4j5cvGGv0GRqy180BHbR5Jd',
    roles: ['CIC.TacticalOperator', 'Fleet.NetworkAdmin', 'Sonar.ReadWrite'],
    scp: 'User.Read Network.Diagnose.All',
    groups: ['grp-r136-bridge-crew', 'grp-swedish-navy-sysops', 'grp-secops-tier3'],
    sub: 'R136_HMS_Vastervik_Subject_8821',
    tid: '72f988bf-86f1-41af-91ab-2d7cd011db47',
    uti: 'v9A81kLm02_NavalToken',
    ver: '2.0',
    wids: ['62e90394-69f5-4237-9190-012177145e10', '194ae4cb-b126-40b2-bd5b-6091b380977d'],
  };
  const fakeSig = 'Naval_RS256_Signature_R136_HMS_Vastervik_9LV200_Verified_Payload_Block_884210';
  const sigB64 = btoa(fakeSig).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${encodeBase64UrlJson(header)}.${encodeBase64UrlJson(payload)}.${sigB64}`;
}

function createSampleSamlBase64(): string {
  const now = new Date();
  const notBefore = new Date(now.getTime() - 5 * 60_000).toISOString();
  const notOnOrAfter = new Date(now.getTime() + 45 * 60_000).toISOString();
  const issueInstant = now.toISOString();
  const xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r136_saml_resp_9941" Version="2.0" IssueInstant="${issueInstant}" Destination="https://techtools.subwrite.se/sso/acs" InResponseTo="_cic_auth_req_104"><saml:Issuer>https://sts.windows.net/72f988bf-86f1-41af-91ab-2d7cd011db47/</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status><saml:Assertion ID="_assertion_hms_vastervik" Version="2.0" IssueInstant="${issueInstant}"><saml:Issuer>https://sts.windows.net/72f988bf-86f1-41af-91ab-2d7cd011db47/</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">k.karlsson@flottan.mil.se</saml:NameID></saml:Subject><saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}"><saml:AudienceRestriction><saml:Audience>spn:techtools.subwrite.se</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AttributeStatement><saml:Attribute Name="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn"><saml:AttributeValue>k.karlsson@flottan.mil.se</saml:AttributeValue></saml:Attribute><saml:Attribute Name="http://schemas.microsoft.com/identity/claims/objectidentifier"><saml:AttributeValue>d4a9183e-52f8-4e9a-8812-3f9b0a11c136</saml:AttributeValue></saml:Attribute><saml:Attribute Name="http://schemas.microsoft.com/identity/claims/tenantid"><saml:AttributeValue>72f988bf-86f1-41af-91ab-2d7cd011db47</saml:AttributeValue></saml:Attribute><saml:Attribute Name="http://schemas.microsoft.com/ws/2008/06/identity/claims/role"><saml:AttributeValue>CIC.TacticalOperator</saml:AttributeValue><saml:AttributeValue>Fleet.NetworkAdmin</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion></samlp:Response>`;
  return btoa(xml);
}

function decodeBase64UrlToUint8Array(b64Url: string): Uint8Array<ArrayBuffer> {
  let base64 = b64Url.trim().replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeBase64UrlToUtf8(b64Url: string): string {
  const bytes = decodeBase64UrlToUint8Array(b64Url);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function formatDurationDelta(diffSeconds: number): string {
  const abs = Math.abs(Math.round(diffSeconds));
  if (abs < 60) return `${abs}s`;
  const mins = Math.floor(abs / 60);
  const secs = abs % 60;
  if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 48) return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

function inspectJwtToken(rawInput: string): { result?: DecodedJwtResult; error?: string } {
  let cleaned = rawInput.trim();
  if (!cleaned) {
    return { error: 'Paste a JWT or OIDC Bearer token to decode.' };
  }
  // Strip optional "Bearer " prefix
  cleaned = cleaned.replace(/^Bearer\s+/i, '').trim();

  const parts = cleaned.split('.');
  if (parts.length !== 3 && parts.length !== 2) {
    return {
      error: `Invalid JWT structure (expected 3 dot-separated Base64URL segments header.payload.signature, found ${parts.length}).`,
    };
  }

  let headerObj: Record<string, unknown>;
  let payloadObj: Record<string, unknown>;

  try {
    const hdrJson = decodeBase64UrlToUtf8(parts[0]);
    headerObj = JSON.parse(hdrJson) as Record<string, unknown>;
  } catch {
    return { error: 'Failed to decode JWT Header (segment #1 is not valid Base64URL JSON).' };
  }

  try {
    const payJson = decodeBase64UrlToUtf8(parts[1]);
    payloadObj = JSON.parse(payJson) as Record<string, unknown>;
  } catch {
    return { error: 'Failed to decode JWT Payload (segment #2 is not valid Base64URL JSON).' };
  }

  let sigBytes = new Uint8Array(0);
  if (parts[2]) {
    try {
      sigBytes = decodeBase64UrlToUint8Array(parts[2]);
    } catch {
      sigBytes = new Uint8Array(0);
    }
  }
  const sigHex = Array.from(sigBytes.slice(0, 32), (b) => b.toString(16).padStart(2, '0')).join(':');

  const nowSec = Math.floor(Date.now() / 1000);
  const timestamps: DecodedTimestampClaim[] = [];

  const timeFields: Array<{ key: string; label: string }> = [
    { key: 'iat', label: 'ISSUED AT (iat)' },
    { key: 'nbf', label: 'NOT BEFORE (nbf)' },
    { key: 'exp', label: 'EXPIRES AT (exp)' },
    { key: 'auth_time', label: 'AUTH TIME (auth_time)' },
  ];

  let overallStatus: DecodedJwtResult['overallStatus'] = 'NO_EXP';
  let overallStatusBadge = 'NO EXPIRY CLAIM (exp)';

  for (const tf of timeFields) {
    const val = payloadObj[tf.key];
    if (typeof val === 'number' && Number.isFinite(val)) {
      const date = new Date(val * 1000);
      const localStr = date.toLocaleString();
      const utcStr = date.toUTCString();
      const diff = val - nowSec;

      let status: DecodedTimestampClaim['status'] = 'INFO';
      let relativeNote = '';

      if (tf.key === 'exp') {
        if (diff > 0) {
          status = 'ACTIVE';
          relativeNote = `ACTIVE (expires in ${formatDurationDelta(diff)})`;
          overallStatus = 'ACTIVE';
          overallStatusBadge = relativeNote;
        } else {
          status = 'EXPIRED';
          relativeNote = `EXPIRED (${formatDurationDelta(diff)} ago)`;
          overallStatus = 'EXPIRED';
          overallStatusBadge = relativeNote;
        }
      } else if (tf.key === 'nbf') {
        if (diff > 0) {
          status = 'FUTURE';
          relativeNote = `NOT YET VALID (starts in ${formatDurationDelta(diff)})`;
          if (overallStatus !== 'EXPIRED') {
            overallStatus = 'NOT_YET_VALID';
            overallStatusBadge = relativeNote;
          }
        } else {
          status = 'ACTIVE';
          relativeNote = `VALID (since ${formatDurationDelta(diff)} ago)`;
        }
      } else {
        relativeNote = diff <= 0 ? `Issued ${formatDurationDelta(diff)} ago` : `In ${formatDurationDelta(diff)}`;
      }

      timestamps.push({
        claim: tf.key,
        label: tf.label,
        epochSeconds: val,
        localTime: localStr,
        utcTime: utcStr,
        relativeNote,
        status,
      });
    }
  }

  // Extract & highlight Microsoft Entra ID & OIDC claims
  const claimDefs: Array<{
    key: string;
    label: string;
    category: HighlightedClaim['category'];
  }> = [
    { key: 'upn', label: 'USER PRINCIPAL NAME (upn)', category: 'ENTRA_ID' },
    { key: 'preferred_username', label: 'PREFERRED USERNAME', category: 'OIDC' },
    { key: 'name', label: 'DISPLAY NAME (name)', category: 'OIDC' },
    { key: 'email', label: 'EMAIL ADDRESS (email)', category: 'OIDC' },
    { key: 'oid', label: 'ENTRA OBJECT ID (oid)', category: 'ENTRA_ID' },
    { key: 'tid', label: 'ENTRA TENANT ID (tid)', category: 'ENTRA_ID' },
    { key: 'roles', label: 'APP / DIRECTORY ROLES (roles)', category: 'ENTRA_ID' },
    { key: 'groups', label: 'SECURITY GROUPS (groups)', category: 'ENTRA_ID' },
    { key: 'wids', label: 'ENTRA DIRECTORY ROLE TEMPLATES (wids)', category: 'ENTRA_ID' },
    { key: 'scp', label: 'DELEGATED OAUTH2 SCOPES (scp)', category: 'ENTRA_ID' },
    { key: 'azp', label: 'AUTHORIZED PARTY / CLIENT APP (azp)', category: 'OIDC' },
    { key: 'appid', label: 'APPLICATION ID (appid)', category: 'ENTRA_ID' },
    { key: 'amr', label: 'AUTHENTICATION METHODS (amr)', category: 'OIDC' },
    { key: 'acr', label: 'AUTH CONTEXT CLASS (acr)', category: 'OIDC' },
    { key: 'iss', label: 'TOKEN ISSUER (iss)', category: 'STANDARD' },
    { key: 'sub', label: 'SUBJECT IDENTIFIER (sub)', category: 'STANDARD' },
    { key: 'aud', label: 'AUDIENCE (aud)', category: 'STANDARD' },
    { key: 'ver', label: 'TOKEN SCHEMA VERSION (ver)', category: 'ENTRA_ID' },
  ];

  const entraAndOidcClaims: HighlightedClaim[] = [];

  for (const def of claimDefs) {
    const rawVal = payloadObj[def.key];
    if (rawVal === undefined || rawVal === null) continue;

    let display = '';
    if (def.key === 'wids' && Array.isArray(rawVal)) {
      display = rawVal
        .map((id) => {
          const s = String(id);
          const roleName = ENTRA_WID_ROLES[s.toLowerCase()];
          return roleName ? `${s} (${roleName})` : s;
        })
        .join(' • ');
    } else if (Array.isArray(rawVal)) {
      display = rawVal.map((item) => String(item)).join(', ');
    } else if (typeof rawVal === 'object') {
      display = JSON.stringify(rawVal);
    } else {
      display = String(rawVal);
    }

    entraAndOidcClaims.push({
      key: def.key,
      label: def.label,
      category: def.category,
      valueDisplay: display,
      rawValue: typeof rawVal === 'string' ? rawVal : JSON.stringify(rawVal),
    });
  }

  return {
    result: {
      rawHeaderB64: parts[0],
      rawPayloadB64: parts[1],
      rawSignatureB64: parts[2] || '',
      signatureByteLength: sigBytes.length,
      signatureHexPreview: sigHex ? `${sigHex}${sigBytes.length > 32 ? '...' : ''}` : 'NONE (Unsigned / alg=none)',
      header: headerObj,
      payload: payloadObj,
      headerPretty: JSON.stringify(headerObj, null, 2),
      payloadPretty: JSON.stringify(payloadObj, null, 2),
      algorithm: String(headerObj.alg || 'UNKNOWN'),
      tokenType: String(headerObj.typ || 'JWT'),
      keyId: headerObj.kid ? String(headerObj.kid) : null,
      issuer: payloadObj.iss ? String(payloadObj.iss) : null,
      subject: payloadObj.sub ? String(payloadObj.sub) : null,
      audience: Array.isArray(payloadObj.aud)
        ? payloadObj.aud.join(', ')
        : payloadObj.aud
        ? String(payloadObj.aud)
        : null,
      overallStatus,
      overallStatusBadge,
      timestamps,
      entraAndOidcClaims,
    },
  };
}

function prettyFormatXml(xmlInput: string): string {
  const cleaned = xmlInput.trim().replace(/>\s+</g, '><');
  const tokens = cleaned.replace(/(>)(<)(\/*)/g, '$1\n$2$3').split('\n');
  let pad = 0;
  const lines: string[] = [];

  for (const rawLine of tokens) {
    const line = rawLine.trim();
    if (!line) continue;

    let indent = pad;
    if (/^<\/\w/.test(line)) {
      pad = Math.max(0, pad - 1);
      indent = pad;
    } else if (/^<[^!?/][^>]*[^/]>$/.test(line) && !line.includes('</')) {
      pad += 1;
    }

    lines.push(`${'  '.repeat(indent)}${line}`);
  }
  return lines.join('\n');
}

function inspectSamlPayload(rawInput: string): { result?: DecodedSamlResult; error?: string } {
  let trimmed = rawInput.trim();
  if (!trimmed) {
    return { error: 'Paste a Base64-encoded SAMLResponse or raw SAML XML document.' };
  }

  // Handle URL-encoded SAMLResponse= parameter
  if (trimmed.includes('SAMLResponse=')) {
    const match = trimmed.match(/SAMLResponse=([^&\s]+)/);
    if (match?.[1]) {
      try {
        trimmed = decodeURIComponent(match[1]);
      } catch {
        trimmed = match[1];
      }
    }
  } else if (trimmed.includes('%3C') || trimmed.includes('%2B') || trimmed.includes('%3D')) {
    try {
      trimmed = decodeURIComponent(trimmed);
    } catch {
      // Keep original if not valid URI component
    }
  }

  let xmlText = trimmed;
  if (!trimmed.startsWith('<')) {
    try {
      const cleanedB64 = trimmed.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(cleanedB64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      xmlText = new TextDecoder('utf-8', { fatal: false }).decode(bytes).trim();
    } catch {
      return { error: 'Input is neither valid Base64 nor raw SAML XML.' };
    }
  }

  if (!xmlText.startsWith('<') || !/saml|Assertion|Response|EntityDescriptor/i.test(xmlText)) {
    return { error: 'Decoded payload does not appear to be a valid SAML 2.0 XML document.' };
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const parseErr = doc.querySelector('parsererror');
  if (parseErr) {
    return { error: 'XML Parser Error: Malformed SAML XML structure.' };
  }

  const rootEl = doc.documentElement;
  const findFirstText = (localNames: string[]): string | null => {
    const all = doc.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (localNames.includes(el.localName) && el.textContent?.trim()) {
        return el.textContent.trim();
      }
    }
    return null;
  };

  const findFirstEl = (localName: string): Element | null => {
    const all = doc.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) {
      if (all[i].localName === localName) return all[i];
    }
    return null;
  };

  const statusCodeEl = findFirstEl('StatusCode');
  const conditionsEl = findFirstEl('Conditions');

  const notBefore = conditionsEl?.getAttribute('NotBefore') || null;
  const notOnOrAfter = conditionsEl?.getAttribute('NotOnOrAfter') || null;

  let validityStatus: DecodedSamlResult['validityStatus'] = 'INFO';
  let validityBadge = 'NO CONDITIONS WINDOW';
  if (notOnOrAfter) {
    const expMs = Date.parse(notOnOrAfter);
    if (!Number.isNaN(expMs)) {
      const diffSec = (expMs - Date.now()) / 1000;
      if (diffSec > 0) {
        validityStatus = 'ACTIVE';
        validityBadge = `ACTIVE (expires in ${formatDurationDelta(diffSec)})`;
      } else {
        validityStatus = 'EXPIRED';
        validityBadge = `EXPIRED (${formatDurationDelta(diffSec)} ago)`;
      }
    }
  }

  const attributes: Array<{ name: string; values: string[] }> = [];
  const allEls = doc.getElementsByTagName('*');
  for (let i = 0; i < allEls.length; i++) {
    const el = allEls[i];
    if (el.localName === 'Attribute') {
      const attrName = el.getAttribute('Name') || el.getAttribute('FriendlyName') || 'Attribute';
      const vals: string[] = [];
      for (let j = 0; j < el.children.length; j++) {
        const child = el.children[j];
        if (child.localName === 'AttributeValue' && child.textContent) {
          vals.push(child.textContent.trim());
        }
      }
      attributes.push({ name: attrName, values: vals });
    }
  }

  return {
    result: {
      rootElement: rootEl.tagName,
      issuer: findFirstText(['Issuer']),
      destination: rootEl.getAttribute('Destination') || null,
      inResponseTo: rootEl.getAttribute('InResponseTo') || null,
      issueInstant: rootEl.getAttribute('IssueInstant') || null,
      statusCode: statusCodeEl?.getAttribute('Value') || null,
      nameId: findFirstText(['NameID']),
      notBefore,
      notOnOrAfter,
      audience: findFirstText(['Audience']),
      validityBadge,
      validityStatus,
      attributes,
      formattedXml: prettyFormatXml(xmlText),
    },
  };
}

export const AuthInspectorTool: React.FC = () => {
  const isPaneActive = useIsPaneActive();
  const [mode, setMode] = useState<AuthInspectMode>('jwt');
  const [jwtInput, setJwtInput] = useState<string>(() => createSampleEntraJwt());
  const [samlInput, setSamlInput] = useState<string>(() => createSampleSamlBase64());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const jwtInspection = useMemo(() => inspectJwtToken(jwtInput), [jwtInput]);
  const samlInspection = useMemo(() => inspectSamlPayload(samlInput), [samlInput]);

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

  // Keyboard shortcuts scoped to active pane
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
      } else if (k === 'j') {
        e.preventDefault();
        sound.playClick();
        setMode('jwt');
      } else if (k === 'm') {
        e.preventDefault();
        sound.playClick();
        setMode('saml');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPaneActive]);

  const jwtData = jwtInspection.result;
  const samlData = samlInspection.result;

  const jwtCopyPayloads = useMemo(() => {
    if (!jwtData) return { timestamps: '', claims: '', json: '' };
    const tsLines = [
      `=== JWT / OIDC TOKEN VALIDITY & TIMESTAMPS ===`,
      `Status Verdict: ${jwtData.overallStatusBadge}`,
      `Algorithm: ${jwtData.algorithm} (${jwtData.tokenType})`,
      ...jwtData.timestamps.map(
        (t) => `${t.label}: ${t.localTime} (Epoch: ${t.epochSeconds}) — [${t.relativeNote}]`
      ),
    ];

    const claimLines = [
      `=== MICROSOFT ENTRA ID & OIDC IDENTITY CLAIMS ===`,
      ...jwtData.entraAndOidcClaims.map((c) => `${c.label}: ${c.valueDisplay}`),
    ];

    const jsonLines = [
      `=== DECODED JWT HEADER ===`,
      jwtData.headerPretty,
      '',
      `=== DECODED JWT PAYLOAD ===`,
      jwtData.payloadPretty,
      '',
      `=== SIGNATURE (${jwtData.signatureByteLength} BYTES) ===`,
      jwtData.rawSignatureB64 || 'UNSIGNED',
    ];

    return {
      timestamps: tsLines.join('\n'),
      claims: claimLines.join('\n'),
      json: jsonLines.join('\n'),
    };
  }, [jwtData]);

  return (
    <div className="tool-panel">
      {/* MODE SWITCHER & CLIENT-SIDE PRIVACY BANNER */}
      <div className="sub-tabs-row">
        <button
          type="button"
          className={`navy-tab-btn ${mode === 'jwt' ? 'active' : ''}`}
          onClick={() => {
            sound.playClick();
            setMode('jwt');
          }}
        >
          🪙 JWT &amp; OIDC INSPECTOR [J]
        </button>
        <button
          type="button"
          className={`navy-tab-btn ${mode === 'saml' ? 'active' : ''}`}
          onClick={() => {
            sound.playClick();
            setMode('saml');
          }}
        >
          📄 SAML 2.0 RESPONSE XML VIEWER [M]
        </button>
      </div>

      {/* ==================== 1. JWT / OIDC MODE ==================== */}
      {mode === 'jwt' && (
        <>
          <div className="query-bar c64-box">
            <div className="section-title-row">
              <span className="prompt-chevron" title="Press [Q] to focus token input">
                PASTE JWT / OIDC BEARER TOKEN (100% LOCAL BROWSER DECODE) [Q]&gt;
              </span>
              <div className="section-header-right">
                <button
                  type="button"
                  className="navy-chip-btn"
                  onClick={() => {
                    sound.playClick();
                    setJwtInput(createSampleEntraJwt());
                  }}
                >
                  SAMPLE ENTRA ID / OIDC JWT
                </button>
                <button
                  type="button"
                  className="navy-btn btn-xs"
                  onClick={() => {
                    sound.playClick();
                    setJwtInput('');
                  }}
                >
                  CLEAR
                </button>
              </div>
            </div>

            <textarea
              ref={textareaRef}
              rows={4}
              value={jwtInput}
              onChange={(e) => setJwtInput(e.target.value)}
              placeholder="Paste eyJ... JWT or OIDC access/ID token (decoded 100% locally in your browser — never sent over the network)..."
              className="navy-input cert-textarea"
              spellCheck={false}
            />
          </div>

          {jwtInspection.error && <div className="alert-banner status-err c64-box">⚠ {jwtInspection.error}</div>}

          {jwtData && (
            <>
              {/* TELEMETRY STRIP */}
              <div className="telemetry-strip c64-box">
                <div className="tele-cell">
                  <span className="tele-lbl">TOKEN STATUS</span>
                  <span
                    className={`tele-val ${
                      jwtData.overallStatus === 'ACTIVE'
                        ? 'status-ok'
                        : jwtData.overallStatus === 'EXPIRED'
                        ? 'status-err'
                        : 'status-warn'
                    }`}
                  >
                    {jwtData.overallStatusBadge}
                  </span>
                </div>
                <div className="tele-cell">
                  <span className="tele-lbl">ALGORITHM / TYPE</span>
                  <span className="tele-val text-gold">
                    {jwtData.algorithm} • {jwtData.tokenType}
                  </span>
                </div>
                <div className="tele-cell">
                  <span className="tele-lbl">KEY ID (kid)</span>
                  <span className="tele-val text-cyan">{jwtData.keyId || '—'}</span>
                </div>
                <div className="tele-cell">
                  <span className="tele-lbl">PRIVACY GUARD</span>
                  <span className="tele-val status-ok">100% CLIENT-SIDE</span>
                </div>
              </div>

              {/* TIMESTAMPS & LIFETIME STATUS */}
              <CopyableIntelSection
                title="► TOKEN LIFETIME & HUMAN-READABLE TIMESTAMPS (iat / nbf / exp)"
                badge={jwtData.overallStatusBadge}
                copyPayload={jwtCopyPayloads.timestamps}
              >
                {jwtData.timestamps.length === 0 ? (
                  <div className="dim-note">No standard numeric timestamp claims (iat, nbf, exp) present in payload.</div>
                ) : (
                  <div className="horizontal-tiles-list">
                    {jwtData.timestamps.map((ts) => {
                      const rowKey = `ts-${ts.claim}`;
                      return (
                        <div
                          key={rowKey}
                          tabIndex={0}
                          className={`nav-tile focusable-row ${copiedKey === rowKey ? 'row-copied' : ''}`}
                          onClick={() => void copyValue(`${ts.label}: ${ts.localTime} (${ts.epochSeconds})`, rowKey)}
                          onKeyDown={(e) => {
                            if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'c' || e.key === 'C' || e.key === 'Enter')) {
                              e.preventDefault();
                              e.stopPropagation();
                              void copyValue(`${ts.label}: ${ts.localTime} (${ts.epochSeconds})`, rowKey);
                            }
                          }}
                        >
                          <div className="tile-badge-col">
                            <span className="tile-hdr-badge">{ts.claim.toUpperCase()}</span>
                            <span
                              className={`auth-status-pill ${
                                ts.status === 'ACTIVE'
                                  ? 'status-ok'
                                  : ts.status === 'EXPIRED'
                                  ? 'status-err'
                                  : 'text-cyan'
                              }`}
                            >
                              {ts.status}
                            </span>
                          </div>
                          <div className="tile-content-col">
                            <div className="tile-title-line">{ts.label}</div>
                            <div className="tile-main-val">
                              <strong className="text-gold">{ts.localTime}</strong>{' '}
                              <span className="dim-inline">({ts.utcTime})</span>
                            </div>
                            <div className="hop-meta-line">
                              <span>
                                Epoch: <code>{ts.epochSeconds}</code>
                              </span>
                              <span
                                className={
                                  ts.status === 'ACTIVE'
                                    ? 'status-ok'
                                    : ts.status === 'EXPIRED'
                                    ? 'status-err'
                                    : 'text-cyan'
                                }
                              >
                                <strong>{ts.relativeNote}</strong>
                              </span>
                            </div>
                          </div>
                          <div className="tile-action-col">
                            <button
                              type="button"
                              tabIndex={-1}
                              className={`navy-btn btn-xs ${copiedKey === rowKey ? 'btn-copied' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                void copyValue(`${ts.label}: ${ts.localTime} (${ts.epochSeconds})`, rowKey);
                              }}
                            >
                              {copiedKey === rowKey ? '✓ COPIED' : 'COPY [C]'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CopyableIntelSection>

              {/* MICROSOFT ENTRA ID & OIDC CLAIMS HIGHLIGHTER */}
              <CopyableIntelSection
                title="► MICROSOFT ENTRA ID & OIDC CLAIMS HIGHLIGHTER (upn, oid, tid, roles, groups, wids)"
                badge={`${jwtData.entraAndOidcClaims.length} CLAIMS DETECTED`}
                copyPayload={jwtCopyPayloads.claims}
              >
                {jwtData.entraAndOidcClaims.length === 0 ? (
                  <div className="dim-note">No standard Entra ID or OIDC claims found in token payload.</div>
                ) : (
                  <div className="horizontal-tiles-list">
                    {jwtData.entraAndOidcClaims.map((claim) => {
                      const rowKey = `claim-${claim.key}`;
                      return (
                        <div
                          key={rowKey}
                          tabIndex={0}
                          className={`nav-tile focusable-row ${copiedKey === rowKey ? 'row-copied' : ''}`}
                          onClick={() => void copyValue(claim.rawValue, rowKey)}
                          onKeyDown={(e) => {
                            if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'c' || e.key === 'C' || e.key === 'Enter')) {
                              e.preventDefault();
                              e.stopPropagation();
                              void copyValue(claim.rawValue, rowKey);
                            }
                          }}
                        >
                          <div className="tile-badge-col">
                            <span className="tile-hdr-badge">{claim.key}</span>
                            <span
                              className={`auth-status-pill ${
                                claim.category === 'ENTRA_ID' ? 'text-gold' : 'text-cyan'
                              }`}
                            >
                              {claim.category}
                            </span>
                          </div>
                          <div className="tile-content-col">
                            <div className="tile-title-line">{claim.label}</div>
                            <code className="tile-main-val code-wrap-inline text-gold">{claim.valueDisplay}</code>
                          </div>
                          <div className="tile-action-col">
                            <button
                              type="button"
                              tabIndex={-1}
                              className={`navy-btn btn-xs ${copiedKey === rowKey ? 'btn-copied' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                void copyValue(claim.rawValue, rowKey);
                              }}
                            >
                              {copiedKey === rowKey ? '✓ COPIED' : 'COPY [C]'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CopyableIntelSection>

              {/* DECODED HEADER, PAYLOAD & SIGNATURE */}
              <CopyableIntelSection
                title="► DECODED JWT HEADER, PAYLOAD & SIGNATURE"
                badge={`${jwtData.signatureByteLength}B SIGNATURE`}
                copyPayload={jwtCopyPayloads.json}
              >
                <div className="record-grid-two">
                  <div className="sub-card">
                    <div className="sub-card-hdr">
                      1. JOSE HEADER (ALGORITHM &amp; KEY METADATA)
                    </div>
                    <pre className="raw-pre-box">{jwtData.headerPretty}</pre>
                  </div>
                  <div className="sub-card">
                    <div className="sub-card-hdr">
                      2. JWT CLAIMS PAYLOAD (FULL JSON)
                    </div>
                    <pre className="raw-pre-box">{jwtData.payloadPretty}</pre>
                  </div>
                </div>

                <div className="sub-card mt-8">
                  <div className="sub-card-hdr">
                    3. CRYPTOGRAPHIC SIGNATURE ({jwtData.algorithm} • {jwtData.signatureByteLength} BYTES)
                  </div>
                  <div className="kv-row">
                    <span className="tele-lbl">BASE64URL SIGNATURE:</span>
                    <code className="code-wrap-inline text-cyan">{jwtData.rawSignatureB64 || '(Empty)'}</code>
                  </div>
                  <div className="kv-row">
                    <span className="tele-lbl">HEX DIGEST PREVIEW:</span>
                    <code className="code-wrap-inline text-gold">{jwtData.signatureHexPreview}</code>
                  </div>
                </div>
              </CopyableIntelSection>
            </>
          )}
        </>
      )}

      {/* ==================== 2. SAML 2.0 XML MODE ==================== */}
      {mode === 'saml' && (
        <>
          <div className="query-bar c64-box">
            <div className="section-title-row">
              <span className="prompt-chevron" title="Press [Q] to focus SAML input">
                PASTE BASE64 SAMLResponse OR RAW SAML 2.0 XML [Q]&gt;
              </span>
              <div className="section-header-right">
                <button
                  type="button"
                  className="navy-chip-btn"
                  onClick={() => {
                    sound.playClick();
                    setSamlInput(createSampleSamlBase64());
                  }}
                >
                  SAMPLE ENTRA SAML 2.0 RESPONSE
                </button>
                <button
                  type="button"
                  className="navy-btn btn-xs"
                  onClick={() => {
                    sound.playClick();
                    setSamlInput('');
                  }}
                >
                  CLEAR
                </button>
              </div>
            </div>

            <textarea
              ref={textareaRef}
              rows={4}
              value={samlInput}
              onChange={(e) => setSamlInput(e.target.value)}
              placeholder="Paste Base64-encoded SAMLResponse (PHNhbWxwOlJlc3BvbnNl...) or raw XML..."
              className="navy-input cert-textarea"
              spellCheck={false}
            />
          </div>

          {samlInspection.error && <div className="alert-banner status-err c64-box">⚠ {samlInspection.error}</div>}

          {samlData && (
            <>
              <div className="telemetry-strip c64-box">
                <div className="tele-cell">
                  <span className="tele-lbl">SAML ROOT ELEMENT</span>
                  <span className="tele-val text-gold">&lt;{samlData.rootElement}&gt;</span>
                </div>
                <div className="tele-cell">
                  <span className="tele-lbl">STATUS CODE</span>
                  <span
                    className={`tele-val ${
                      samlData.statusCode?.includes('Success') ? 'status-ok' : 'text-cyan'
                    }`}
                  >
                    {samlData.statusCode?.split(':').pop() || 'PARSED'}
                  </span>
                </div>
                <div className="tele-cell">
                  <span className="tele-lbl">ASSERTION WINDOW</span>
                  <span
                    className={`tele-val ${
                      samlData.validityStatus === 'ACTIVE'
                        ? 'status-ok'
                        : samlData.validityStatus === 'EXPIRED'
                        ? 'status-err'
                        : 'text-cyan'
                    }`}
                  >
                    {samlData.validityBadge}
                  </span>
                </div>
                <div className="tele-cell">
                  <span className="tele-lbl">SUBJECT NAMEID</span>
                  <span className="tele-val text-cyan">{samlData.nameId || '—'}</span>
                </div>
              </div>

              <CopyableIntelSection
                title="► SAML 2.0 ASSERTION SUMMARY & ATTRIBUTE STATEMENT"
                badge={`${samlData.attributes.length} ATTRIBUTES`}
                copyPayload={samlData.formattedXml}
              >
                <div className="whois-grid">
                  <div className="whois-item">
                    <span className="tele-lbl">ISSUER (IdP ENTITY ID)</span>
                    <span className="tele-val text-gold code-wrap-inline">{samlData.issuer || '—'}</span>
                  </div>
                  <div className="whois-item">
                    <span className="tele-lbl">SUBJECT NAMEID</span>
                    <span className="tele-val text-cyan code-wrap-inline">{samlData.nameId || '—'}</span>
                  </div>
                  <div className="whois-item">
                    <span className="tele-lbl">DESTINATION (ACS URL)</span>
                    <span className="tele-val code-wrap-inline">{samlData.destination || '—'}</span>
                  </div>
                  <div className="whois-item">
                    <span className="tele-lbl">AUDIENCE RESTRICTION</span>
                    <span className="tele-val text-gold code-wrap-inline">{samlData.audience || '—'}</span>
                  </div>
                  <div className="whois-item">
                    <span className="tele-lbl">NOT BEFORE</span>
                    <span className="tele-val">
                      {samlData.notBefore ? new Date(samlData.notBefore).toLocaleString() : '—'}
                    </span>
                  </div>
                  <div className="whois-item">
                    <span className="tele-lbl">NOT ON OR AFTER</span>
                    <span className="tele-val text-gold">
                      {samlData.notOnOrAfter ? new Date(samlData.notOnOrAfter).toLocaleString() : '—'}
                    </span>
                  </div>
                </div>

                {samlData.attributes.length > 0 && (
                  <div className="sub-card mt-8">
                    <div className="sub-card-hdr">SAML ATTRIBUTE STATEMENT CLAIMS</div>
                    {samlData.attributes.map((attr, idx) => (
                      <div key={`${attr.name}-${idx}`} className="kv-row">
                        <span className="text-cyan code-wrap-inline">{attr.name}</span>
                        <code className="text-gold">{attr.values.join(', ')}</code>
                      </div>
                    ))}
                  </div>
                )}

                <div className="sub-card mt-8">
                  <div className="sub-card-hdr">FORMATTED SAML 2.0 XML DOCUMENT</div>
                  <pre tabIndex={0} className="raw-pre-box copyable-pre">
                    {samlData.formattedXml}
                  </pre>
                </div>
              </CopyableIntelSection>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default AuthInspectorTool;
