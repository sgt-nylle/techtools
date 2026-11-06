import dns from 'node:dns';
import net from 'node:net';
import tls from 'node:tls';
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync, execFile } from 'node:child_process';
import { domainToASCII } from 'node:url';

const defaultResolver = new dns.promises.Resolver({ timeout: 3000, tries: 2 });
defaultResolver.setServers(['8.8.8.8', '1.1.1.1', '9.9.9.9']);

// ============================================================================
// SLIDING-WINDOW RATE LIMITER (Protects public DNS/WHOIS/IP endpoints)
// ============================================================================
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 60;
const rateBuckets = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const key = ip || 'unknown';
  const timestamps = (rateBuckets.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (timestamps.length >= RATE_MAX_REQUESTS) {
    rateBuckets.set(key, timestamps);
    return false;
  }
  timestamps.push(now);
  rateBuckets.set(key, timestamps);

  if (rateBuckets.size > 2000) {
    for (const [k, list] of rateBuckets.entries()) {
      if (list.every((t) => now - t >= RATE_WINDOW_MS)) {
        rateBuckets.delete(k);
      }
    }
  }
  return true;
}

// ============================================================================
// HELPERS: CLIENT IP, TIMEOUTS, HTTPS JSON, PORT-43 WHOIS
// ============================================================================
export function normalizeIp(raw) {
  if (!raw) return '';
  let ip = String(raw).trim();
  if (ip.includes(',')) {
    ip = ip.split(',')[0].trim();
  }
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }
  return ip;
}

export function isPrivateOrLoopbackIp(ip) {
  if (!ip) return true;
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::' || ip === 'localhost') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('127.') || ip.startsWith('0.')) return true;
  if (ip.startsWith('169.254.') || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) {
    return true;
  }
  const m172 = ip.match(/^172\.(\d+)\./);
  if (m172) {
    const second = Number(m172[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

/**
 * Strict SSRF guard for user-supplied custom DNS server IPs.
 * Allows only globally routable unicast IPv4 / IPv6 addresses.
 */
function isPublicRoutableIp(ip) {
  const ver = net.isIP(ip);
  if (ver === 4) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
    const [a, b, c] = parts;
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // RFC 6598 CGNAT
    if (a === 169 && b === 254) return false; // Link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false; // RFC 1918
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // IETF / TEST-NET-1
    if (a === 192 && b === 168) return false; // RFC 1918
    if (a === 198 && (b === 18 || b === 19)) return false; // Benchmarking
    if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
    if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
    if (a >= 224) return false; // Multicast & Reserved
    return true;
  }
  if (ver === 6) {
    const s = ip.toLowerCase();
    if (s === '::' || s === '::1' || s.startsWith('::ffff:')) return false;
    if (s.startsWith('fc') || s.startsWith('fd')) return false; // ULA fc00::/7
    if (/^fe[89ab]/.test(s)) return false; // Link-local fe80::/10
    if (s.startsWith('ff')) return false; // Multicast ff00::/8
    if (s.startsWith('2001:db8:') || s.startsWith('2001:0db8:')) return false; // Documentation
    return true;
  }
  return false;
}

export function extractClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return normalizeIp(forwarded);
  }
  const realIp = req.headers['x-real-ip'] || req.headers['cf-connecting-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    return normalizeIp(realIp);
  }
  return normalizeIp(req.socket?.remoteAddress || '');
}

function withTimeout(promise, ms, fallbackValue = null) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallbackValue), ms);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(fallbackValue);
      });
  });
}

function fetchJsonHttps(urlStr, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      urlStr,
      {
        family: 4,
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'SubWrite-TechTools/0.2.3 (+https://techtools.subwrite.se)',
          Accept: 'application/json',
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          fetchJsonHttps(res.headers.location, timeoutMs).then(resolve).catch(reject);
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          if (body.length < 512_000) body += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error('Request timed out'));
    });
    req.on('error', reject);
  });
}

function queryWhoisSocket(server, query, timeoutMs = 4500) {
  return new Promise((resolve, reject) => {
    const safeQuery = String(query).replace(/[\r\n\0]/g, '').trim();
    const socket = net.createConnection({ host: server, port: 43 });
    let out = '';
    socket.setEncoding('utf8');
    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      const payload = server.includes('verisign') ? `domain ${safeQuery}\r\n` : `${safeQuery}\r\n`;
      socket.write(payload);
    });
    socket.on('data', (chunk) => {
      if (out.length < 150_000) out += chunk;
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(out);
    });
    socket.on('end', () => resolve(out));
    socket.on('error', reject);
  });
}

const tldWhoisCache = new Map([
  ['se', 'whois.iis.se'],
  ['nu', 'whois.iis.nu'],
  ['com', 'whois.verisign-grs.com'],
  ['net', 'whois.verisign-grs.com'],
  ['org', 'whois.pir.org'],
  ['eu', 'whois.eu'],
  ['io', 'whois.nic.io'],
  ['dev', 'whois.nic.google'],
  ['app', 'whois.nic.google'],
  ['ai', 'whois.nic.ai'],
  ['dk', 'whois.punktum.dk'],
  ['no', 'whois.norid.no'],
  ['fi', 'whois.fi'],
  ['de', 'whois.denic.de'],
  ['uk', 'whois.nic.uk'],
]);

async function resolveTldWhoisServer(tld) {
  const cleanTld = tld.toLowerCase();
  if (tldWhoisCache.has(cleanTld)) {
    return tldWhoisCache.get(cleanTld);
  }
  try {
    const ianaResp = await queryWhoisSocket('whois.iana.org', cleanTld, 3500);
    const match = ianaResp.match(/^whois:\s*(\S+)/im);
    if (match && match[1]) {
      tldWhoisCache.set(cleanTld, match[1].trim());
      return match[1].trim();
    }
  } catch {
    // Ignore referral lookup failure
  }
  return null;
}

const MULTI_PART_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.nz',
  'co.jp',
  'com.br',
]);

function getRegistrableDomain(hostname) {
  const parts = hostname.split('.').filter(Boolean);
  if (parts.length <= 2) return hostname;
  const lastTwo = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  if (MULTI_PART_SUFFIXES.has(lastTwo) && parts.length >= 3) {
    return `${parts[parts.length - 3]}.${lastTwo}`;
  }
  return lastTwo;
}

function parseWhoisSummary(rawText, queriedDomain) {
  if (!rawText) return null;
  const lines = rawText.split(/\r?\n/);

  const summary = {
    domain: queriedDomain,
    registrar: '',
    holder: '',
    created: '',
    expires: '',
    updated: '',
    dnssec: '',
    statuses: [],
    nameservers: [],
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('%') || line.startsWith('#') || line.startsWith('>>>')) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const val = line.slice(colonIdx + 1).trim();
    if (!val) continue;

    if (!summary.domain && (key === 'domain' || key === 'domain name')) {
      summary.domain = val.toLowerCase();
    } else if (!summary.registrar && (key === 'registrar' || key === 'sponsoring registrar')) {
      summary.registrar = val;
    } else if (!summary.holder && (key === 'holder' || key === 'registrant organization' || key === 'org')) {
      summary.holder = val;
    } else if (!summary.created && (key === 'created' || key === 'creation date' || key === 'registered' || key === 'created on')) {
      summary.created = val;
    } else if (
      !summary.expires &&
      (key === 'expires' ||
        key === 'registry expiry date' ||
        key === 'registrar registration expiration date' ||
        key === 'expiration date' ||
        key === 'paid-till')
    ) {
      summary.expires = val;
    } else if (!summary.updated && (key === 'modified' || key === 'updated date' || key === 'last-updated' || key === 'changed')) {
      summary.updated = val;
    } else if (!summary.dnssec && key === 'dnssec') {
      summary.dnssec = val;
    } else if (key === 'status' || key === 'state' || key === 'domain status') {
      const cleanStatus = val.split(/\s+https?:\/\//)[0].trim();
      if (cleanStatus && !summary.statuses.includes(cleanStatus)) {
        summary.statuses.push(cleanStatus);
      }
    } else if (key === 'nserver' || key === 'name server' || key === 'nameserver') {
      const ns = val.split(/\s+/)[0].toLowerCase();
      if (ns && !summary.nameservers.includes(ns)) {
        summary.nameservers.push(ns);
      }
    }
  }

  return summary;
}

async function lookupDomainWhois(domain) {
  const apex = getRegistrableDomain(domain);
  const parts = apex.split('.');
  const tld = parts[parts.length - 1];
  const whoisServer = await resolveTldWhoisServer(tld);
  if (!whoisServer) {
    return { apexDomain: apex, whoisServer: null, summary: null, raw: '' };
  }

  try {
    let raw = await queryWhoisSocket(whoisServer, apex, 4500);
    // Follow Registrar WHOIS referral if Verisign thin response provides one and lacks details
    const referralMatch = raw.match(/Registrar WHOIS Server:\s*(\S+)/i);
    const summary = parseWhoisSummary(raw, apex);

    // Strip verbose legal boilerplate header if > 40 lines while preserving core output
    const cleanedLines = raw
      .split(/\r?\n/)
      .filter((l, idx) => !(idx < 25 && (l.startsWith('#') || l.startsWith('%'))))
      .join('\n')
      .trim();

    return {
      apexDomain: apex,
      whoisServer,
      registrarWhoisServer: referralMatch ? referralMatch[1] : null,
      summary,
      raw: cleanedLines.slice(0, 12_000),
    };
  } catch {
    return { apexDomain: apex, whoisServer, summary: null, raw: '' };
  }
}

// ============================================================================
// MODULE 2 BACKEND: DNS & EMAIL SECURITY & REGISTRY INSPECTOR
// ============================================================================
function sanitizeDomainInput(raw) {
  if (!raw) return '';
  let input = String(raw).trim();
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input)) {
    try {
      input = new URL(input).hostname;
    } catch {
      input = input.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
    }
  }
  input = input.split('/')[0].split('?')[0].split('#')[0].trim();
  // Handle bracketed IPv6 e.g. [2001:4860:4860::8888]:53
  if (input.startsWith('[')) {
    const closeIdx = input.indexOf(']');
    if (closeIdx !== -1) {
      input = input.slice(1, closeIdx);
    }
  } else {
    const colonCount = (input.match(/:/g) || []).length;
    if (colonCount === 1 && /^\S+:\d+$/.test(input)) {
      input = input.replace(/:\d+$/, '');
    }
  }
  input = input.replace(/\.+$/, '').toLowerCase();
  if (!input || input.length > 253 || /[\s\r\n\0]/.test(input)) return '';
  if (net.isIP(input)) return input;
  const ascii = domainToASCII(input);
  return ascii || '';
}

const KNOWN_DNS_LABELS = new Map([
  ['8.8.8.8', 'Google (8.8.8.8)'],
  ['8.8.4.4', 'Google Secondary (8.8.4.4)'],
  ['2001:4860:4860::8888', 'Google IPv6 (2001:4860:4860::8888)'],
  ['1.1.1.1', 'Cloudflare (1.1.1.1)'],
  ['1.0.0.1', 'Cloudflare Secondary (1.0.0.1)'],
  ['2606:4700:4700::1111', 'Cloudflare IPv6 (2606:4700:4700::1111)'],
  ['9.9.9.9', 'Quad9 (9.9.9.9)'],
  ['208.67.222.222', 'OpenDNS (208.67.222.222)'],
]);

async function resolveRequestedDnsServer(rawServerParam) {
  const raw = String(rawServerParam || '').trim();
  if (!raw || raw === '8.8.8.8' || raw.toLowerCase() === 'google') {
    return {
      ip: '8.8.8.8',
      label: 'Google (8.8.8.8)',
      preset: 'google',
      resolvedFrom: null,
    };
  }
  if (raw === '1.1.1.1' || raw.toLowerCase() === 'cloudflare') {
    return {
      ip: '1.1.1.1',
      label: 'Cloudflare (1.1.1.1)',
      preset: 'cloudflare',
      resolvedFrom: null,
    };
  }

  const cleanedServer = sanitizeDomainInput(raw);
  if (!cleanedServer) {
    return { error: 'Enter a valid public DNS server IP address (e.g. 9.9.9.9) or hostname.' };
  }

  if (net.isIP(cleanedServer)) {
    if (!isPublicRoutableIp(cleanedServer)) {
      return {
        error: `DNS server "${cleanedServer}" is not a public routable IP address (private, loopback, and reserved ranges are blocked).`,
      };
    }
    return {
      ip: cleanedServer,
      label: KNOWN_DNS_LABELS.get(cleanedServer) || `Custom (${cleanedServer})`,
      preset: 'custom',
      resolvedFrom: null,
    };
  }

  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(cleanedServer)) {
    return { error: `Invalid custom DNS server "${raw}". Enter an IPv4/IPv6 address or DNS hostname.` };
  }

  const v4 = await withTimeout(defaultResolver.resolve4(cleanedServer), 3000, []);
  const v6 = v4?.length ? [] : await withTimeout(defaultResolver.resolve6(cleanedServer), 3000, []);
  const resolvedIp = (Array.isArray(v4) && v4[0]) || (Array.isArray(v6) && v6[0]) || '';
  if (!resolvedIp) {
    return { error: `Could not resolve custom DNS server hostname "${cleanedServer}".` };
  }
  if (!isPublicRoutableIp(resolvedIp)) {
    return {
      error: `Custom DNS hostname "${cleanedServer}" resolved to non-public IP ${resolvedIp}, which is not permitted.`,
    };
  }

  return {
    ip: resolvedIp,
    label: `${cleanedServer} (${resolvedIp})`,
    preset: 'custom',
    resolvedFrom: cleanedServer,
  };
}

function queryWithErrorCapture(promise, timeoutMs, fallbackValue, errorSet) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      errorSet.add('ETIMEOUT');
      resolve(fallbackValue);
    }, timeoutMs);
    promise
      .then((val) => {
        clearTimeout(timer);
        errorSet.add('OK');
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        const code = err && typeof err.code === 'string' ? err.code : 'ERROR';
        errorSet.add(code);
        resolve(fallbackValue);
      });
  });
}

function analyzeSpf(txtRecords) {
  const spfRecords = txtRecords.filter((t) => /^v=spf1(\s|$)/i.test(t.trim()));
  if (spfRecords.length === 0) {
    return {
      present: false,
      status: 'MISSING',
      record: null,
      count: 0,
      note: 'No v=spf1 TXT record published on this host.',
      mechanisms: [],
    };
  }
  if (spfRecords.length > 1) {
    return {
      present: true,
      status: 'WARN_MULTIPLE',
      record: spfRecords[0],
      count: spfRecords.length,
      note: `RFC 7208 violation: ${spfRecords.length} SPF records found (must be exactly 1).`,
      mechanisms: spfRecords[0].split(/\s+/).slice(1),
    };
  }
  const rec = spfRecords[0].trim();
  const tokens = rec.split(/\s+/).slice(1);
  let status = 'CONFIGURED';
  let note = 'SPF policy published.';
  if (tokens.includes('-all')) {
    status = 'STRICT (-all)';
    note = 'HardFail (-all): unauthorized senders are strictly rejected.';
  } else if (tokens.includes('~all')) {
    status = 'SOFTFAIL (~all)';
    note = 'SoftFail (~all): unauthorized mail marked suspicious / quarantined.';
  } else if (tokens.includes('+all') || tokens.includes('all')) {
    status = 'DANGER (+all)';
    note = 'CRITICAL: +all allows any server on the internet to spoof this domain!';
  } else if (tokens.some((t) => t.startsWith('redirect='))) {
    status = 'REDIRECTED';
    note = 'SPF policy delegates evaluation via redirect= modifier.';
  }
  return {
    present: true,
    status,
    record: rec,
    count: 1,
    note,
    mechanisms: tokens,
  };
}

function analyzeDmarc(dmarcTxtRecords, queriedHost) {
  const dmarc = dmarcTxtRecords.find((t) => /^v=DMARC1/i.test(t.trim()));
  if (!dmarc) {
    return {
      present: false,
      host: queriedHost,
      policy: 'MISSING',
      record: null,
      note: `No DMARC TXT record found at ${queriedHost}.`,
    };
  }
  const pMatch = dmarc.match(/(?:^|;\s*)p=([a-zA-Z]+)/i);
  const policy = pMatch ? pMatch[1].toLowerCase() : 'unknown';
  let note = `DMARC policy active (p=${policy}).`;
  if (policy === 'reject') note = 'Enforced (p=reject): unauthenticated mail is rejected.';
  else if (policy === 'quarantine') note = 'Enforced (p=quarantine): unauthenticated mail routed to spam.';
  else if (policy === 'none') note = 'Monitoring only (p=none): reports collected without blocking.';

  return {
    present: true,
    host: queriedHost,
    policy: policy.toUpperCase(),
    record: dmarc,
    note,
  };
}

async function handleDnsLookup(rawTarget, rawServerParam) {
  const startedAt = Date.now();
  const cleaned = sanitizeDomainInput(rawTarget);
  if (!cleaned) {
    return { status: 400, body: { error: 'Please enter a valid domain name, hostname, or IP address.' } };
  }

  const dnsServerInfo = await resolveRequestedDnsServer(rawServerParam);
  if (dnsServerInfo.error) {
    return { status: 400, body: { error: dnsServerInfo.error } };
  }

  const activeResolver = new dns.promises.Resolver({ timeout: 2200, tries: 1 });
  try {
    const serverAddr = net.isIP(dnsServerInfo.ip) === 6 ? `[${dnsServerInfo.ip}]` : dnsServerInfo.ip;
    activeResolver.setServers([serverAddr]);
  } catch {
    return { status: 400, body: { error: `Unable to configure DNS resolver "${dnsServerInfo.ip}".` } };
  }

  const dnsOutcomes = new Set();

  // If user entered a raw IP address in DNS tool, perform reverse PTR + IP summary
  if (net.isIP(cleaned)) {
    const ptr =
      (await queryWithErrorCapture(activeResolver.reverse(cleaned), 3200, [], dnsOutcomes)) || [];

    if (!dnsOutcomes.has('OK') && !dnsOutcomes.has('ENOTFOUND') && !dnsOutcomes.has('ENODATA')) {
      if (dnsOutcomes.has('EREFUSED')) {
        return {
          status: 502,
          body: {
            error: `DNS server ${dnsServerInfo.label} refused reverse query for ${cleaned} (recursion disabled or restricted).`,
          },
        };
      }
      if (dnsOutcomes.has('ETIMEOUT') || dnsOutcomes.has('ECONNREFUSED')) {
        return {
          status: 502,
          body: {
            error: `DNS server ${dnsServerInfo.label} did not respond on port 53 (unreachable or timed out).`,
          },
        };
      }
    }

    return {
      status: 200,
      body: {
        query: cleaned,
        isIpQuery: true,
        apexDomain: null,
        dnsServer: dnsServerInfo,
        durationMs: Date.now() - startedAt,
        records: {
          A: net.isIP(cleaned) === 4 ? [cleaned] : [],
          AAAA: net.isIP(cleaned) === 6 ? [cleaned] : [],
          CNAME: [],
          MX: [],
          NS: [],
          TXT: [],
          CAA: [],
          SOA: null,
          PTR: [{ ip: cleaned, hostnames: ptr }],
        },
        emailSecurity: { spf: null, dmarc: null },
        whois: null,
      },
    };
  }

  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(cleaned)) {
    return { status: 400, body: { error: `Invalid domain or hostname: "${cleaned}"` } };
  }

  const apexDomain = getRegistrableDomain(cleaned);
  const dmarcHost = `_dmarc.${cleaned}`;
  const apexDmarcHost = `_dmarc.${apexDomain}`;

  const [aRes, aaaaRes, cnameRes, mxRes, nsRes, txtRes, soaRes, caaRes, dmarcRes, whoisData] =
    await Promise.all([
      queryWithErrorCapture(activeResolver.resolve4(cleaned, { ttl: true }), 3200, [], dnsOutcomes),
      queryWithErrorCapture(activeResolver.resolve6(cleaned, { ttl: true }), 3200, [], dnsOutcomes),
      queryWithErrorCapture(activeResolver.resolveCname(cleaned), 3200, [], dnsOutcomes),
      queryWithErrorCapture(activeResolver.resolveMx(cleaned), 3200, [], dnsOutcomes),
      queryWithErrorCapture(activeResolver.resolveNs(cleaned), 3200, [], dnsOutcomes),
      queryWithErrorCapture(activeResolver.resolveTxt(cleaned), 3200, [], dnsOutcomes),
      queryWithErrorCapture(activeResolver.resolveSoa(cleaned), 3200, null, dnsOutcomes),
      queryWithErrorCapture(activeResolver.resolveCaa(cleaned), 3200, [], dnsOutcomes),
      withTimeout(activeResolver.resolveTxt(dmarcHost), 3000, null),
      lookupDomainWhois(cleaned),
    ]);

  // Surface clear error if the chosen DNS server itself is unreachable or refuses queries
  const answeredAnyDnsPacket =
    dnsOutcomes.has('OK') || dnsOutcomes.has('ENOTFOUND') || dnsOutcomes.has('ENODATA');
  if (!answeredAnyDnsPacket) {
    if (dnsOutcomes.has('EREFUSED')) {
      return {
        status: 502,
        body: {
          error: `DNS server ${dnsServerInfo.label} refused the query (EREFUSED — recursion disabled or not authoritative for "${cleaned}").`,
        },
      };
    }
    if (dnsOutcomes.has('ETIMEOUT') || dnsOutcomes.has('ECONNREFUSED')) {
      return {
        status: 502,
        body: {
          error: `DNS server ${dnsServerInfo.label} did not respond on port 53 (unreachable or timed out).`,
        },
      };
    }
    if (dnsOutcomes.has('ESERVFAIL')) {
      return {
        status: 502,
        body: {
          error: `DNS server ${dnsServerInfo.label} returned SERVFAIL for "${cleaned}".`,
        },
      };
    }
  }

  let effectiveDmarcTxt = dmarcRes ? dmarcRes.map((chunks) => chunks.join('')) : [];
  let effectiveDmarcHost = dmarcHost;
  if (effectiveDmarcTxt.length === 0 && apexDomain !== cleaned) {
    const fallbackDmarc = await withTimeout(activeResolver.resolveTxt(apexDmarcHost), 2800, []);
    if (fallbackDmarc && fallbackDmarc.length > 0) {
      effectiveDmarcTxt = fallbackDmarc.map((chunks) => chunks.join(''));
      effectiveDmarcHost = apexDmarcHost;
    }
  }

  // If NS or SOA wasn't on subdomain, check apex NS as helpful context
  let nsList = Array.isArray(nsRes) ? [...nsRes].sort() : [];
  let nsInheritedFrom = null;
  if (nsList.length === 0 && apexDomain !== cleaned) {
    const apexNs = await withTimeout(activeResolver.resolveNs(apexDomain), 2800, []);
    if (Array.isArray(apexNs) && apexNs.length > 0) {
      nsList = [...apexNs].sort();
      nsInheritedFrom = apexDomain;
    }
  }

  const aRecords = Array.isArray(aRes) ? aRes : [];
  const aaaaRecords = Array.isArray(aaaaRes) ? aaaaRes : [];

  // Resolve PTRs for up to 4 A/AAAA records & resolve MX host IPs in parallel
  const allIps = [...aRecords.map((r) => r.address), ...aaaaRecords.map((r) => r.address)].slice(0, 4);
  const sortedMx = Array.isArray(mxRes)
    ? [...mxRes].sort((a, b) => a.priority - b.priority)
    : [];

  const [ptrEntries, mxWithIps] = await Promise.all([
    Promise.all(
      allIps.map(async (ip) => {
        const hosts = (await withTimeout(activeResolver.reverse(ip), 2500, [])) || [];
        return { ip, hostnames: hosts };
      })
    ),
    Promise.all(
      sortedMx.slice(0, 8).map(async (mx) => {
        const ips = (await withTimeout(activeResolver.resolve4(mx.exchange), 2500, [])) || [];
        return {
          priority: mx.priority,
          exchange: mx.exchange,
          ips,
        };
      })
    ),
  ]);

  const flatTxt = Array.isArray(txtRes) ? txtRes.map((chunks) => chunks.join('')) : [];
  let spf = analyzeSpf(flatTxt);
  if (!spf.present && apexDomain !== cleaned) {
    const apexTxtRaw = await withTimeout(activeResolver.resolveTxt(apexDomain), 2800, []);
    const apexTxt = Array.isArray(apexTxtRaw) ? apexTxtRaw.map((c) => c.join('')) : [];
    const apexSpf = analyzeSpf(apexTxt);
    if (apexSpf.present) {
      spf = { ...apexSpf, note: `${apexSpf.note} (Published on apex ${apexDomain})` };
    }
  }

  const dmarc = analyzeDmarc(effectiveDmarcTxt, effectiveDmarcHost);

  return {
    status: 200,
    body: {
      query: cleaned,
      isIpQuery: false,
      apexDomain,
      nsInheritedFrom,
      dnsServer: dnsServerInfo,
      durationMs: Date.now() - startedAt,
      records: {
        A: aRecords,
        AAAA: aaaaRecords,
        CNAME: Array.isArray(cnameRes) ? cnameRes : [],
        MX: mxWithIps,
        NS: nsList,
        TXT: flatTxt,
        CAA: Array.isArray(caaRes) ? caaRes : [],
        SOA: soaRes || null,
        PTR: ptrEntries,
      },
      emailSecurity: {
        spf,
        dmarc,
      },
      whois: whoisData,
    },
  };
}

// ============================================================================
// MODULE 3 BACKEND: WHAT'S MY IP & NETWORK RANGE OWNER INTEL
// ============================================================================
async function fetchRipeIpIntel(ip) {
  const encoded = encodeURIComponent(ip);
  const [whoisResp, prefixResp] = await Promise.all([
    withTimeout(fetchJsonHttps(`https://stat.ripe.net/data/whois/data.json?resource=${encoded}`, 5000), 5500, null),
    withTimeout(
      fetchJsonHttps(`https://stat.ripe.net/data/prefix-overview/data.json?resource=${encoded}`, 5000),
      5500,
      null
    ),
  ]);

  const intel = {
    prefix: '',
    ipRange: '',
    netname: '',
    organization: '',
    descriptions: [],
    country: '',
    rir: '',
    asn: '',
    asnHolder: '',
    abuseContact: '',
    status: '',
    lastModified: '',
    rawAttributes: [],
  };

  if (prefixResp?.data) {
    if (prefixResp.data.resource) {
      intel.prefix = prefixResp.data.resource;
    }
    const asns = prefixResp.data.asns;
    if (Array.isArray(asns) && asns.length > 0) {
      intel.asn = `AS${asns[0].asn}`;
      intel.asnHolder = asns[0].holder || '';
    }
  }

  const recordGroups = whoisResp?.data?.records;
  if (Array.isArray(recordGroups)) {
    for (const group of recordGroups) {
      if (!Array.isArray(group)) continue;
      for (const item of group) {
        const k = String(item.key || '').toLowerCase();
        const v = String(item.value || '').trim();
        if (!v) continue;

        if (intel.rawAttributes.length < 30) {
          intel.rawAttributes.push({ key: item.key, value: v });
        }

        if (!intel.ipRange && (k === 'inetnum' || k === 'inet6num' || k === 'netrange' || k === 'cidr')) {
          intel.ipRange = v;
        } else if (!intel.netname && k === 'netname') {
          intel.netname = v;
        } else if (k === 'descr' || k === 'orgname' || k === 'org-name' || k === 'owner') {
          if (!intel.descriptions.includes(v)) intel.descriptions.push(v);
          if (!intel.organization && (k === 'orgname' || k === 'org-name' || k === 'owner')) {
            intel.organization = v;
          }
        } else if (!intel.country && k === 'country') {
          intel.country = v.toUpperCase();
        } else if (!intel.abuseContact && (k === 'abuse-mailbox' || k === 'orgabuseemail' || k === 'e-mail')) {
          intel.abuseContact = v;
        } else if (!intel.status && (k === 'status' || k === 'nettype')) {
          intel.status = v;
        } else if (!intel.lastModified && (k === 'last-modified' || k === 'updated')) {
          intel.lastModified = v;
        } else if (!intel.rir && k === 'source') {
          intel.rir = v.toUpperCase();
        } else if (!intel.asn && k === 'origin') {
          intel.asn = v.toUpperCase().startsWith('AS') ? v.toUpperCase() : `AS${v}`;
        }
      }
    }
  }

  const irrGroups = whoisResp?.data?.irr_records;
  if (Array.isArray(irrGroups)) {
    for (const group of irrGroups) {
      if (!Array.isArray(group)) continue;
      for (const item of group) {
        const k = String(item.key || '').toLowerCase();
        const v = String(item.value || '').trim();
        if (!intel.prefix && (k === 'route' || k === 'route6')) intel.prefix = v;
        if (!intel.asn && k === 'origin') {
          intel.asn = v.toUpperCase().startsWith('AS') ? v.toUpperCase() : `AS${v}`;
        }
        if (!intel.rir && k === 'source') intel.rir = v.toUpperCase();
      }
    }
  }

  if (!intel.organization) {
    if (intel.asnHolder && intel.descriptions.length > 0 && !intel.descriptions[0].toLowerCase().includes(intel.asnHolder.toLowerCase())) {
      intel.organization = `${intel.asnHolder} — ${intel.descriptions[0]}`;
    } else if (intel.descriptions.length > 0) {
      intel.organization = intel.descriptions[0];
    } else if (intel.asnHolder) {
      intel.organization = intel.asnHolder;
    }
  }
  if (!intel.rir && whoisResp?.data?.authorities?.length) {
    intel.rir = String(whoisResp.data.authorities[0]).toUpperCase();
  }

  return intel;
}

async function discoverServerOutboundWanIp() {
  const resp = await withTimeout(
    fetchJsonHttps('https://stat.ripe.net/data/whats-my-ip/data.json', 3500),
    4000,
    null
  );
  return resp?.data?.ip ? String(resp.data.ip).trim() : '';
}

async function handleIpLookup(req, targetParam) {
  const startedAt = Date.now();
  const clientSocketIp = extractClientIp(req);
  const isCustomTarget = Boolean(targetParam && targetParam.trim());

  let targetIp = '';
  let resolvedFromHost = null;
  let isLocalClient = false;

  if (isCustomTarget) {
    const cleaned = sanitizeDomainInput(targetParam);
    if (net.isIP(cleaned)) {
      targetIp = cleaned;
    } else if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(cleaned)) {
      const v4 = await withTimeout(defaultResolver.resolve4(cleaned), 3500, []);
      const v6 = v4?.length ? [] : await withTimeout(defaultResolver.resolve6(cleaned), 3500, []);
      const chosen = (v4 && v4[0]) || (v6 && v6[0]) || '';
      if (!chosen) {
        return { status: 404, body: { error: `Could not resolve IP address for host "${cleaned}".` } };
      }
      targetIp = chosen;
      resolvedFromHost = cleaned;
    } else {
      return { status: 400, body: { error: 'Enter a valid IPv4, IPv6, or hostname.' } };
    }
  } else {
    if (isPrivateOrLoopbackIp(clientSocketIp)) {
      isLocalClient = true;
      const wanIp = await discoverServerOutboundWanIp();
      targetIp = wanIp || clientSocketIp || '127.0.0.1';
    } else {
      targetIp = clientSocketIp;
    }
  }

  const ipVer = net.isIP(targetIp);
  const canQueryPublicRir = ipVer !== 0 && !isPrivateOrLoopbackIp(targetIp);

  const [ptrHostnames, networkIntel] = await Promise.all([
    ipVer !== 0 ? withTimeout(defaultResolver.reverse(targetIp), 3000, []) : Promise.resolve([]),
    canQueryPublicRir ? fetchRipeIpIntel(targetIp) : Promise.resolve(null),
  ]);

  return {
    status: 200,
    body: {
      ip: targetIp,
      ipVersion: ipVer === 6 ? 'IPv6' : 'IPv4',
      isCustomTarget,
      resolvedFromHost,
      isLocalClient,
      clientSocketIp: clientSocketIp || '127.0.0.1',
      ptr: Array.isArray(ptrHostnames) ? ptrHostnames : [],
      network: networkIntel || {
        prefix: 'LOCAL / RFC1918',
        ipRange: targetIp,
        netname: 'PRIVATE-LAN-LOOPBACK',
        organization: 'Local Development Network',
        descriptions: ['Private / Loopback Address Space'],
        country: 'LOCAL',
        rir: 'IANA-RESERVED',
        asn: 'N/A',
        asnHolder: 'Local Interface',
        abuseContact: '',
        status: 'PRIVATE',
        lastModified: '',
        rawAttributes: [],
      },
      clientMeta: isCustomTarget
        ? null
        : {
            userAgent: req.headers['user-agent'] || 'Unknown',
            acceptLanguage: req.headers['accept-language'] || 'Unknown',
            forwardedProto: req.headers['x-forwarded-proto'] || 'http',
            host: req.headers.host || 'localhost',
          },
      durationMs: Date.now() - startedAt,
    },
  };
}

// ============================================================================
// MODULE 4 BACKEND: CERTIFICATE & CSR & CHAIN ANALYZER
// ============================================================================
function readRequestBodyJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 512_000) {
        req.destroy(new Error('Request body exceeded 512 KB'));
      }
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function fetchHttpBuffer(urlStr, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const isHttps = urlStr.startsWith('https://');
    const client = isHttps ? https : http;
    const req = client.get(urlStr, { timeout: timeoutMs }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        fetchHttpBuffer(res.headers.location, timeoutMs).then(resolve).catch(reject);
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('HTTP fetch timed out')));
    req.on('error', reject);
  });
}

function parseOpensslExtensions(text) {
  const lines = text.split(/\r?\n/);
  let currentExt = null;
  const extMap = {};

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const extMatch = rawLine.match(/^\s*(X509v3 [^:]+|Requested Extensions):(?:\s*critical)?\s*(.*)$/i);
    if (extMatch) {
      currentExt = extMatch[1].trim();
      extMap[currentExt] = [];
      if (extMatch[2]?.trim()) extMap[currentExt].push(extMatch[2].trim());
    } else if (currentExt) {
      if (/^\s{4}[A-Za-z0-9 ]+:/.test(rawLine) && !rawLine.startsWith('        ')) {
        currentExt = null;
      } else {
        extMap[currentExt].push(trimmed);
      }
    }
  }
  return extMap;
}

function convertDerToPem(buffer) {
  const b64 = buffer.toString('base64');
  const formatted = b64.match(/.{1,64}/g)?.join('\n') || b64;
  return `-----BEGIN CERTIFICATE-----\n${formatted}\n-----END CERTIFICATE-----\n`;
}

async function discoverAiaCertificateChain(leafPem, maxDepth = 4) {
  const chainPems = [leafPem.trim()];
  let currentPem = leafPem.trim();

  for (let i = 0; i < maxDepth; i++) {
    try {
      const x = new crypto.X509Certificate(currentPem);
      if (x.subject === x.issuer) {
        break; // Reached self-signed root cert
      }
      const aiaLine = x.infoAccess?.split('\n').find((l) => l.includes('CA Issuers - URI:'));
      if (!aiaLine) break;
      const uri = aiaLine.split('URI:')[1]?.trim();
      if (!uri || !uri.startsWith('http')) break;

      const buf = await fetchHttpBuffer(uri, 3500);
      if (!buf || buf.length === 0) break;

      let nextPem = '';
      if (buf.toString('utf8').includes('BEGIN CERTIFICATE')) {
        nextPem = buf.toString('utf8').trim();
      } else {
        nextPem = convertDerToPem(buf).trim();
      }

      chainPems.push(nextPem);
      currentPem = nextPem;
    } catch {
      break;
    }
  }
  return chainPems;
}

function verifyCertificateTrust(chainPems) {
  if (!chainPems || chainPems.length === 0) {
    return { trusted: false, status: 'NO_CERTIFICATE', details: 'No certificate to verify.' };
  }
  const tmpPath = path.join(os.tmpdir(), `tt_verify_${Date.now()}_${Math.random().toString(36).slice(2)}.pem`);
  try {
    fs.writeFileSync(tmpPath, chainPems.join('\n'));
    const out = execSync(`openssl verify -untrusted "${tmpPath}" "${tmpPath}"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 3000,
    }).toString();
    if (out.includes('OK')) {
      return { trusted: true, status: 'TRUSTED_CA', details: 'Chain successfully verified against system Trust Store.' };
    }
    return { trusted: false, status: 'VERIFY_FAILED', details: out.trim() };
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString().trim() : err.message;
    if (stderr.includes('self-signed') || stderr.includes('self signed')) {
      return { trusted: false, status: 'SELF_SIGNED', details: 'Self-signed certificate (not signed by a public trusted root).' };
    }
    if (stderr.includes('expired')) {
      return { trusted: false, status: 'EXPIRED', details: 'Certificate or intermediate has expired.' };
    }
    if (stderr.includes('unable to get local issuer certificate')) {
      return { trusted: false, status: 'INCOMPLETE_CHAIN', details: 'Issuer not in local trust store (intermediate certificate missing).' };
    }
    return { trusted: false, status: 'UNTRUSTED', details: stderr || 'Certificate failed system store verification.' };
  } finally {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {}
  }
}

async function handleCertAnalyze(req) {
  const startedAt = Date.now();
  const body = await readRequestBodyJson(req);
  const rawInput = String(body.text || '').trim();

  if (!rawInput) {
    return { status: 400, body: { error: 'Please paste a base64 certificate, CSR, or public key.' } };
  }

  // 1.3: Private Key Guard: prompt exact warning and abort immediately
  if (/-----BEGIN[ A-Z0-9_-]*(?:PRIVATE|ENCRYPTED)[ A-Z0-9_-]*KEY-----/i.test(rawInput)) {
    return {
      status: 400,
      body: {
        securityAlert: true,
        error: 'Security alert! We will not process private keys! Abandon Ship!',
      },
    };
  }

  // Attempt format normalization: check if raw input is naked base64
  let normalized = rawInput;
  const isPemBlock = /-----BEGIN [A-Z0-9 ]+-----/i.test(rawInput);
  if (!isPemBlock) {
    const cleanB64 = rawInput.replace(/\s+/g, '');
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(cleanB64) && cleanB64.length % 4 === 0 && cleanB64.length >= 32) {
      // Naked base64: wrap in certificate header for trial
      const formatted = cleanB64.match(/.{1,64}/g)?.join('\n') || cleanB64;
      normalized = `-----BEGIN CERTIFICATE-----\n${formatted}\n-----END CERTIFICATE-----\n`;
    }
  }

  // 1. Try Certificate (CRT / CER / PEM)
  try {
    const certMatches = normalized.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/gi);
    if (certMatches && certMatches.length > 0) {
      const leafPem = certMatches[0];
      const x509 = new crypto.X509Certificate(leafPem);
      const textOut = execSync('openssl x509 -text -noout', {
        input: leafPem,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 3000,
      }).toString();

      const extMap = parseOpensslExtensions(textOut);
      const sans = extMap['X509v3 Subject Alternative Name']
        ? extMap['X509v3 Subject Alternative Name'].join(', ').split(',').map((s) => s.trim()).filter(Boolean)
        : [];
      const ekus = extMap['X509v3 Extended Key Usage']
        ? extMap['X509v3 Extended Key Usage'].join(', ').split(',').map((s) => s.trim()).filter(Boolean)
        : [];
      const keyUsages = extMap['X509v3 Key Usage']
        ? extMap['X509v3 Key Usage'].join(', ').split(',').map((s) => s.trim()).filter(Boolean)
        : [];

      const isCa = x509.ca;
      const isSelfSigned = x509.subject === x509.issuer;
      const certRole = isSelfSigned && isCa ? 'ROOT_CA' : isCa ? 'INTERMEDIATE_CA' : 'LEAF_END_ENTITY';

      const validFromDate = new Date(x509.validFrom);
      const validToDate = new Date(x509.validTo);
      const now = new Date();
      const isExpired = now > validToDate;
      const isNotYetValid = now < validFromDate;
      const daysRemaining = Math.round((validToDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      // Build chain if multiple certs pasted or fetch via AIA
      let chainPems = certMatches.map((c) => c.trim());
      if (chainPems.length === 1 && !isSelfSigned) {
        const discovered = await discoverAiaCertificateChain(leafPem, 3);
        if (discovered.length > 1) {
          chainPems = discovered;
        }
      }

      const trust = verifyCertificateTrust(chainPems);

      return {
        status: 200,
        body: {
          formatType: 'CERTIFICATE',
          certRole,
          subject: x509.subject,
          issuer: x509.issuer,
          serialNumber: x509.serialNumber,
          fingerprint256: x509.fingerprint256,
          validFrom: x509.validFrom,
          validTo: x509.validTo,
          validity: {
            daysRemaining,
            isExpired,
            isNotYetValid,
            status: isExpired ? 'EXPIRED' : isNotYetValid ? 'NOT_YET_VALID' : 'ACTIVE',
          },
          publicKey: {
            type: x509.publicKey.asymmetricKeyType?.toUpperCase() || 'UNKNOWN',
            details: x509.publicKey.asymmetricKeyDetails || null,
          },
          sans,
          extendedKeyUsage: ekus,
          keyUsage: keyUsages,
          isCa,
          isSelfSigned,
          trust,
          chainAvailable: chainPems.length > 1,
          chainCount: chainPems.length,
          fullChainPem: chainPems.join('\n'),
          rawPem: leafPem,
          opensslText: textOut,
          durationMs: Date.now() - startedAt,
        },
      };
    }
  } catch {
    // Fall through to CSR check
  }

  // 2. Try Certificate Signing Request (CSR)
  try {
    const csrMatch = normalized.match(/-----BEGIN (?:NEW )?CERTIFICATE REQUEST-----[\s\S]+?-----END (?:NEW )?CERTIFICATE REQUEST-----/i);
    const csrInput = csrMatch ? csrMatch[0] : normalized;
    const textOut = execSync('openssl req -text -noout', {
      input: csrInput,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 3000,
    }).toString();

    const subjMatch = textOut.match(/Subject:\s*([^\r\n]+)/i);
    const subject = subjMatch ? subjMatch[1].trim() : 'Unknown';

    const extMap = parseOpensslExtensions(textOut);
    const sans = extMap['X509v3 Subject Alternative Name']
      ? extMap['X509v3 Subject Alternative Name'].join(', ').split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    const ekus = extMap['X509v3 Extended Key Usage']
      ? extMap['X509v3 Extended Key Usage'].join(', ').split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    const pkMatch = textOut.match(/Public Key Algorithm:\s*([^\r\n]+)/i);
    const pkBitsMatch = textOut.match(/Public-Key:\s*\(([^)]+)\)/i);

    return {
      status: 200,
      body: {
        formatType: 'CSR',
        subject,
        publicKey: {
          algorithm: pkMatch ? pkMatch[1].trim() : 'Unknown',
          details: pkBitsMatch ? pkBitsMatch[1].trim() : '',
        },
        sans,
        extendedKeyUsage: ekus,
        rawPem: csrInput,
        opensslText: textOut,
        durationMs: Date.now() - startedAt,
      },
    };
  } catch {
    // Fall through to Public Key check
  }

  // 3. Try Public Key (PEM / base64)
  try {
    const pubKeyMatch = normalized.match(/-----BEGIN (?:RSA |EC )?PUBLIC KEY-----[\s\S]+?-----END (?:RSA |EC )?PUBLIC KEY-----/i);
    const pubInput = pubKeyMatch ? pubKeyMatch[0] : normalized;
    const keyObject = crypto.createPublicKey(pubInput);
    const textOut = execSync('openssl pkey -pubin -text -noout', {
      input: pubInput,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 3000,
    }).toString();

    return {
      status: 200,
      body: {
        formatType: 'PUBLIC_KEY',
        publicKey: {
          type: keyObject.asymmetricKeyType?.toUpperCase() || 'UNKNOWN',
          details: keyObject.asymmetricKeyDetails || null,
        },
        rawPem: pubInput,
        opensslText: textOut,
        durationMs: Date.now() - startedAt,
      },
    };
  } catch {
    // Neither cert, CSR, nor public key
  }

  // 1.4: Format not detected -> exact prompt required by user
  return {
    status: 400,
    body: {
      invalidFormat: true,
      error: 'Navy Cert Format Not DETECTED!',
    },
  };
}

// ============================================================================
// MODULE 6 BACKEND: EXTERNAL ENDPOINT & TLS PROBE (URL TESTER)
// ============================================================================
const PLAIN_BY_DEFAULT_PORTS = new Set([21, 22, 25, 80, 110, 143, 587, 8000, 8008, 8080, 8888]);
const BLOCKED_INTERNAL_SUFFIXES = ['.local', '.internal', '.lan', '.home.arpa', '.localhost', '.corp', '.intranet'];

function parseProbeUrlAndPort(rawInput, portOverride) {
  if (!rawInput || typeof rawInput !== 'string') {
    return { error: 'Please enter a target URL or hostname (e.g. https://subwrite.se or techtools.subwrite.se).' };
  }
  const trimmed = rawInput.trim();
  if (!trimmed || trimmed.length > 2048 || /[\s\r\n\0]/.test(trimmed)) {
    return { error: 'Invalid URL or hostname format (must not contain spaces or control characters).' };
  }

  let explicitScheme = null;
  const schemeMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') {
      return { error: `Unsupported protocol "${scheme}://". Enter an https://, http://, or hostname target.` };
    }
    explicitScheme = scheme;
  }

  let parsed;
  try {
    parsed = new URL(explicitScheme ? trimmed : `https://${trimmed}`);
  } catch {
    return { error: `Could not parse target URL "${trimmed}".` };
  }

  if (parsed.username || parsed.password) {
    return { error: 'Credentials in URLs (user:pass@host) are not permitted.' };
  }

  let rawHost = parsed.hostname || '';
  if (rawHost.startsWith('[') && rawHost.endsWith(']')) {
    rawHost = rawHost.slice(1, -1);
  }
  rawHost = rawHost.replace(/\.+$/, '').toLowerCase();

  if (!rawHost) {
    return { error: 'Target hostname is empty.' };
  }
  if (
    rawHost === 'localhost' ||
    BLOCKED_INTERNAL_SUFFIXES.some((sfx) => rawHost === sfx.slice(1) || rawHost.endsWith(sfx))
  ) {
    return {
      error: `Target "${rawHost}" uses a reserved local/internal suffix and cannot be probed from the public internet.`,
    };
  }

  let hostname = rawHost;
  const ipVersion = net.isIP(rawHost);
  if (ipVersion === 0) {
    const ascii = domainToASCII(rawHost);
    if (!ascii || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(ascii)) {
      return { error: `Invalid public domain or IP address: "${rawHost}".` };
    }
    hostname = ascii.toLowerCase();
  }

  let port;
  const hasOverride =
    portOverride !== undefined && portOverride !== null && String(portOverride).trim() !== '';
  if (hasOverride) {
    port = Number(String(portOverride).trim());
  } else if (parsed.port) {
    port = Number(parsed.port);
  } else {
    port = explicitScheme === 'http' ? 80 : 443;
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { error: 'Port must be a valid TCP port number between 1 and 65535.' };
  }

  const pathWithQuery = `${parsed.pathname || '/'}${parsed.search || ''}`;
  return {
    hostname,
    ipVersion,
    port,
    explicitScheme,
    urlHadExplicitPort: Boolean(parsed.port),
    pathWithQuery,
  };
}

async function resolvePublicTargetIps(hostname) {
  const dnsStart = Date.now();
  if (net.isIP(hostname)) {
    if (!isPublicRoutableIp(hostname)) {
      return {
        blocked: true,
        dnsMs: 0,
        privateIps: [hostname],
        reason: `SSRF Guard: "${hostname}" is a private, loopback, or reserved IP address. Only public internet endpoints can be tested.`,
      };
    }
    return {
      ips: [hostname],
      ipv4: net.isIP(hostname) === 4 ? [hostname] : [],
      ipv6: net.isIP(hostname) === 6 ? [hostname] : [],
      dnsMs: 0,
    };
  }

  const [v4Raw, v6Raw] = await Promise.all([
    withTimeout(defaultResolver.resolve4(hostname), 3200, []),
    withTimeout(defaultResolver.resolve6(hostname), 3200, []),
  ]);
  const dnsMs = Date.now() - dnsStart;
  const ipv4 = Array.isArray(v4Raw) ? v4Raw : [];
  const ipv6 = Array.isArray(v6Raw) ? v6Raw : [];
  const allIps = [...ipv4, ...ipv6];

  if (allIps.length === 0) {
    return {
      notFound: true,
      dnsMs,
      ips: [],
      ipv4: [],
      ipv6: [],
    };
  }

  const nonPublic = allIps.filter((ip) => !isPublicRoutableIp(ip));
  if (nonPublic.length > 0) {
    return {
      blocked: true,
      dnsMs,
      privateIps: nonPublic,
      reason: `SSRF Guard: Public DNS resolved "${hostname}" to non-public IP (${nonPublic.join(', ')}). Split-horizon or internal RFC1918 DNS record detected — outbound socket blocked.`,
    };
  }

  return {
    ips: allIps,
    ipv4,
    ipv6,
    dnsMs,
  };
}

function classifyTcpError(code, message) {
  switch (code) {
    case 'ECONNREFUSED':
      return 'CONNECTION REFUSED — Host is reachable, but TCP port is closed (RST received).';
    case 'ETIMEDOUT':
    case 'TIMEOUT':
      return 'CONNECTION TIMED OUT — Packets dropped by firewall or host offline (no SYN-ACK).';
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return 'NETWORK / HOST UNREACHABLE — No external route to destination network.';
    case 'ECONNRESET':
      return 'CONNECTION RESET — Remote endpoint or firewall forcibly closed the TCP connection.';
    default:
      return message || `TCP connection failed (${code || 'UNKNOWN'}).`;
  }
}

/**
 * Active Sonar ICMP Echo Probe (3 pulses, strict argument array, SSRF-guarded).
 */
function executeIcmpPing(ip) {
  return new Promise((resolve) => {
    if (!ip || !isPublicRoutableIp(ip)) {
      resolve(null);
      return;
    }

    const familyFlag = net.isIP(ip) === 6 ? '-6' : '-4';
    const args = [familyFlag, '-n', '-c', '3', '-i', '0.25', '-W', '1', '-w', '2', ip];

    execFile('ping', args, { timeout: 2800 }, (err, stdout = '', stderr = '') => {
      const combined = `${stdout}\n${stderr}`;
      const pktMatch = combined.match(
        /(\d+)\s+packets transmitted,\s+(\d+)\s+(?:packets\s+)?received,.*?(\d+(?:\.\d+)?)%\s+packet loss/i
      );
      const rttMatch = combined.match(
        /(?:rtt|round-trip)\s+min\/avg\/max\/(?:mdev|stddev)\s*=\s*([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)\s*ms/i
      );
      const ttlMatch = combined.match(/ttl=(\d+)/i);

      if (!pktMatch && err) {
        resolve({
          alive: false,
          status: 'ICMP UNAVAILABLE',
          transmitted: 0,
          received: 0,
          packetLossPct: 100,
          minMs: null,
          avgMs: null,
          maxMs: null,
          ttl: null,
          summary: 'ICMP socket unavailable on probe host.',
        });
        return;
      }

      const transmitted = pktMatch ? Number(pktMatch[1]) : 3;
      const received = pktMatch ? Number(pktMatch[2]) : 0;
      const packetLossPct = pktMatch ? Number(pktMatch[3]) : received > 0 ? 0 : 100;
      const minMs = rttMatch ? Number(rttMatch[1]) : null;
      const avgMs = rttMatch ? Number(rttMatch[2]) : null;
      const maxMs = rttMatch ? Number(rttMatch[3]) : null;
      const ttl = ttlMatch ? Number(ttlMatch[1]) : null;
      const alive = received > 0;

      resolve({
        alive,
        status: alive ? 'PING OK' : 'NO ECHO',
        transmitted,
        received,
        packetLossPct,
        minMs,
        avgMs,
        maxMs,
        ttl,
        summary: alive
          ? `PING OK — ${avgMs !== null ? `${avgMs.toFixed(1)} ms avg` : 'Echo reply received'}${
              minMs !== null && maxMs !== null ? ` (min ${minMs.toFixed(1)} / max ${maxMs.toFixed(1)} ms)` : ''
            } • ${received}/${transmitted} replies (${packetLossPct}% loss)${ttl !== null ? ` • TTL ${ttl}` : ''}`
          : `NO ICMP ECHO — 0/${transmitted} replies (${packetLossPct}% loss) • ICMP blocked by firewall or host silent`,
      });
    });
  });
}

async function extractLiveTlsCertificate(tlsSocket, hostname) {
  const protocol = tlsSocket.getProtocol() || 'TLS';
  const cipherObj = tlsSocket.getCipher() || null;
  const peer = tlsSocket.getPeerCertificate(true);

  if (!peer || !peer.raw) {
    return {
      protocol,
      cipher: cipherObj
        ? {
            name: cipherObj.name || '',
            standardName: cipherObj.standardName || cipherObj.name || '',
            version: cipherObj.version || '',
          }
        : null,
      authorizedByNode: Boolean(tlsSocket.authorized),
      authorizationError: tlsSocket.authorizationError ? String(tlsSocket.authorizationError) : null,
      certificate: null,
    };
  }

  const wireChainPems = [];
  const chainSummary = [];
  const seenFingerprints = new Set();
  let cursor = peer;
  let depth = 0;

  while (cursor && cursor.raw && depth < 8) {
    const fp = cursor.fingerprint256 || cursor.raw.toString('hex').slice(0, 64);
    if (seenFingerprints.has(fp)) break;
    seenFingerprints.add(fp);

    const pem = convertDerToPem(cursor.raw).trim();
    wireChainPems.push(pem);

    try {
      const cx = new crypto.X509Certificate(pem);
      chainSummary.push({
        depth,
        subject: cx.subject,
        issuer: cx.issuer,
        validFrom: cx.validFrom,
        validTo: cx.validTo,
        isCa: cx.ca,
        isSelfSigned: cx.subject === cx.issuer,
        fingerprint256: cx.fingerprint256,
      });
    } catch {
      // Ignore malformed chain entry metadata
    }

    if (!cursor.issuerCertificate || cursor.issuerCertificate === cursor) break;
    cursor = cursor.issuerCertificate;
    depth += 1;
  }

  const leafPem = wireChainPems[0];
  const x509 = new crypto.X509Certificate(leafPem);

  let sans = [];
  let ekus = [];
  let keyUsages = [];
  try {
    const textOut = execSync('openssl x509 -text -noout', {
      input: leafPem,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 2500,
    }).toString();
    const extMap = parseOpensslExtensions(textOut);
    sans = extMap['X509v3 Subject Alternative Name']
      ? extMap['X509v3 Subject Alternative Name']
          .join(', ')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    ekus = extMap['X509v3 Extended Key Usage']
      ? extMap['X509v3 Extended Key Usage']
          .join(', ')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    keyUsages = extMap['X509v3 Key Usage']
      ? extMap['X509v3 Key Usage']
          .join(', ')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  } catch {
    if (x509.subjectAltName) {
      sans = x509.subjectAltName.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }

  const validFromDate = new Date(x509.validFrom);
  const validToDate = new Date(x509.validTo);
  const now = new Date();
  const isExpired = now > validToDate;
  const isNotYetValid = now < validFromDate;
  const daysRemaining = Math.round((validToDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  let matchedIdentity = undefined;
  try {
    matchedIdentity = net.isIP(hostname) ? x509.checkIP(hostname) : x509.checkHost(hostname);
  } catch {
    matchedIdentity = undefined;
  }
  const hostnameMatch = Boolean(matchedIdentity);

  const wireTrust = verifyCertificateTrust(wireChainPems);
  let exportChainPems = wireChainPems;
  let aiaCompletedChain = false;

  if (!wireTrust.trusted && wireTrust.status === 'INCOMPLETE_CHAIN' && wireChainPems.length === 1) {
    const discovered = await discoverAiaCertificateChain(leafPem, 3);
    if (discovered.length > 1) {
      exportChainPems = discovered;
      aiaCompletedChain = true;
    }
  }

  // Combine trust + hostname check for accurate browser/client verdict
  let overallTrust = { ...wireTrust };
  if (wireTrust.trusted && !hostnameMatch) {
    overallTrust = {
      trusted: false,
      status: 'HOSTNAME_MISMATCH',
      details: `Certificate chain is signed by a trusted CA, but "${hostname}" does not match any SAN/CN on the certificate.`,
    };
  } else if (aiaCompletedChain && wireTrust.status === 'INCOMPLETE_CHAIN') {
    overallTrust = {
      trusted: false,
      status: 'INCOMPLETE_CHAIN',
      details:
        'Server only sent leaf certificate (missing intermediate CA). Browsers may fetch via AIA, but strict TLS clients/APIs will fail.',
    };
  }

  return {
    protocol,
    cipher: cipherObj
      ? {
          name: cipherObj.name || '',
          standardName: cipherObj.standardName || cipherObj.name || '',
          version: cipherObj.version || '',
        }
      : null,
    authorizedByNode: Boolean(tlsSocket.authorized),
    authorizationError: tlsSocket.authorizationError ? String(tlsSocket.authorizationError) : null,
    certificate: {
      subject: x509.subject,
      issuer: x509.issuer,
      serialNumber: x509.serialNumber,
      fingerprint256: x509.fingerprint256,
      validFrom: x509.validFrom,
      validTo: x509.validTo,
      daysRemaining,
      isExpired,
      isNotYetValid,
      validityStatus: isExpired ? 'EXPIRED' : isNotYetValid ? 'NOT_YET_VALID' : 'ACTIVE',
      hostnameMatch,
      matchedIdentity: matchedIdentity || null,
      sans,
      extendedKeyUsage: ekus,
      keyUsage: keyUsages,
      isCa: x509.ca,
      isSelfSigned: x509.subject === x509.issuer,
      publicKey: {
        type: x509.publicKey.asymmetricKeyType?.toUpperCase() || 'UNKNOWN',
        details: x509.publicKey.asymmetricKeyDetails || null,
      },
      trust: overallTrust,
      wireChainCount: wireChainPems.length,
      aiaCompletedChain,
      chainSummary,
      leafPem,
      fullChainPem: exportChainPems.join('\n'),
    },
  };
}

function sanitizeBannerText(buf) {
  if (!buf || buf.length === 0) return '';
  return buf
    .toString('utf8')
    .replace(/[^\x20-\x7E\r\n\t]/g, '.')
    .trim()
    .slice(0, 320);
}

function executeSocketProbe({ ip, hostname, port, pathWithQuery, method, useTls }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result, streamsToDestroy = []) => {
      if (settled) return;
      settled = true;
      for (const s of streamsToDestroy) {
        try {
          if (s && !s.destroyed) s.destroy();
        } catch {}
      }
      resolve(result);
    };

    const tcpStart = Date.now();
    const family = net.isIP(ip) === 6 ? 6 : 4;
    const tcpSocket = net.createConnection({ host: ip, port, family });
    tcpSocket.setNoDelay(true);

    const tcpTimer = setTimeout(() => {
      const elapsed = Date.now() - tcpStart;
      finish(
        {
          tcpConnected: false,
          tcpConnectMs: elapsed,
          tcpErrorCode: 'ETIMEDOUT',
          tcpErrorMessage: classifyTcpError('ETIMEDOUT'),
        },
        [tcpSocket]
      );
    }, 5200);

    tcpSocket.once('error', (err) => {
      clearTimeout(tcpTimer);
      const code = err?.code || 'TCP_ERROR';
      finish(
        {
          tcpConnected: false,
          tcpConnectMs: Date.now() - tcpStart,
          tcpErrorCode: code,
          tcpErrorMessage: classifyTcpError(code, err?.message),
        },
        [tcpSocket]
      );
    });

    tcpSocket.once('connect', () => {
      clearTimeout(tcpTimer);
      const tcpConnectMs = Date.now() - tcpStart;

      const runHttpOrBannerPhase = (activeSocket, tlsData, tlsHandshakeMs) => {
        const rawPeekChunks = [];
        let rawPeekBytes = 0;

        const onRawData = (chunk) => {
          if (rawPeekBytes < 1024) {
            const slice = chunk.subarray(0, 1024 - rawPeekBytes);
            rawPeekChunks.push(Buffer.from(slice));
            rawPeekBytes += slice.length;
          }
        };
        activeSocket.on('data', onRawData);

        const defaultPort = useTls ? 443 : 80;
        const formattedHost = net.isIP(hostname) === 6 ? `[${hostname}]` : hostname;
        const hostHeader = port === defaultPort ? formattedHost : `${formattedHost}:${port}`;

        const httpStart = Date.now();
        let req;
        const phaseTimer = setTimeout(() => {
          const banner = sanitizeBannerText(Buffer.concat(rawPeekChunks));
          finish(
            {
              tcpConnected: true,
              tcpConnectMs,
              tlsUsed: useTls,
              tlsConnected: useTls ? true : false,
              tlsHandshakeMs,
              tls: tlsData,
              httpResponded: false,
              protocolDetected: banner
                ? useTls
                  ? 'TLS_TCP_BANNER'
                  : 'RAW_TCP_BANNER'
                : useTls
                ? 'TLS_OPEN_NO_HTTP'
                : 'TCP_OPEN_NO_HTTP',
              banner: banner || null,
              httpError: banner
                ? 'Port is open and returned a non-HTTP service banner.'
                : 'TCP port is open, but remote service did not send an HTTP response within 4.5s.',
            },
            [req, activeSocket, tcpSocket]
          );
        }, 4500);

        const oneShotAgent = new http.Agent({ keepAlive: false });
        oneShotAgent.createConnection = () => activeSocket;

        req = http.request(
          {
            host: hostname,
            port,
            method,
            path: pathWithQuery,
            agent: oneShotAgent,
            headers: {
              Host: hostHeader,
              'User-Agent': 'SubWrite-TechTools-Probe/0.2.3 (+https://techtools.subwrite.se)',
              Accept: 'text/html,application/xhtml+xml,application/json,*/*;q=0.8',
              'Accept-Encoding': 'identity',
              Connection: 'close',
            },
          },
          (res) => {
            const ttfbMs = Date.now() - httpStart;
            const bodyChunks = [];
            let bodyBytes = 0;
            const MAX_PREVIEW_BYTES = 24_576;

            res.on('data', (chunk) => {
              if (bodyBytes < MAX_PREVIEW_BYTES) {
                const slice = chunk.subarray(0, MAX_PREVIEW_BYTES - bodyBytes);
                bodyChunks.push(Buffer.from(slice));
                bodyBytes += slice.length;
              } else {
                res.destroy();
              }
            });

            const finalizeHttp = () => {
              clearTimeout(phaseTimer);
              const totalHttpMs = Date.now() - httpStart;
              const rawBody = Buffer.concat(bodyChunks).toString('utf8');
              const contentType = String(res.headers['content-type'] || '');

              let pageTitle = null;
              const titleMatch = rawBody.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
              if (titleMatch && titleMatch[1]) {
                pageTitle = titleMatch[1]
                  .replace(/\s+/g, ' ')
                  .replace(/&amp;/gi, '&')
                  .replace(/&quot;/gi, '"')
                  .replace(/&#39;|&apos;/gi, "'")
                  .replace(/&lt;/gi, '<')
                  .replace(/&gt;/gi, '>')
                  .replace(/&ndash;/gi, '–')
                  .replace(/&mdash;/gi, '—')
                  .trim()
                  .slice(0, 180);
              }

              let bodySnippet = null;
              if (
                method !== 'HEAD' &&
                rawBody.trim() &&
                /json|text\/plain|xml/i.test(contentType)
              ) {
                bodySnippet = rawBody.replace(/[^\x20-\x7E\r\n\t]/g, '').trim().slice(0, 360);
              }

              // Preserve flat header key-value pairs cleanly
              const headersList = [];
              for (const [k, v] of Object.entries(res.headers)) {
                if (v === undefined) continue;
                headersList.push({
                  name: k,
                  value: Array.isArray(v) ? v.join('; ') : String(v),
                });
              }

              finish(
                {
                  tcpConnected: true,
                  tcpConnectMs,
                  tlsUsed: useTls,
                  tlsConnected: useTls ? true : false,
                  tlsHandshakeMs,
                  tls: tlsData,
                  httpResponded: true,
                  protocolDetected: useTls ? 'HTTPS' : 'HTTP',
                  http: {
                    httpVersion: res.httpVersion || '1.1',
                    statusCode: res.statusCode || 0,
                    statusMessage: res.statusMessage || '',
                    ttfbMs,
                    totalHttpMs,
                    headers: headersList,
                    contentType: contentType || null,
                    server: res.headers.server ? String(res.headers.server) : null,
                    location: res.headers.location ? String(res.headers.location) : null,
                    pageTitle,
                    bodySnippet,
                    sampledBytes: bodyBytes,
                    securityHeaders: {
                      hsts: res.headers['strict-transport-security']
                        ? String(res.headers['strict-transport-security'])
                        : null,
                      csp: res.headers['content-security-policy']
                        ? String(res.headers['content-security-policy'])
                        : null,
                      xFrameOptions: res.headers['x-frame-options']
                        ? String(res.headers['x-frame-options'])
                        : null,
                      xContentTypeOptions: res.headers['x-content-type-options']
                        ? String(res.headers['x-content-type-options'])
                        : null,
                      referrerPolicy: res.headers['referrer-policy']
                        ? String(res.headers['referrer-policy'])
                        : null,
                    },
                  },
                },
                [activeSocket, tcpSocket]
              );
            };

            res.once('end', finalizeHttp);
            res.once('close', finalizeHttp);
            res.once('error', finalizeHttp);
          }
        );

        req.once('error', (err) => {
          clearTimeout(phaseTimer);
          const banner = sanitizeBannerText(Buffer.concat(rawPeekChunks));
          const isNonHttpProtocol =
            err?.code === 'HPE_INVALID_CONSTANT' ||
            err?.code === 'HPE_INVALID_HEADER_TOKEN' ||
            Boolean(banner);

          finish(
            {
              tcpConnected: true,
              tcpConnectMs,
              tlsUsed: useTls,
              tlsConnected: useTls ? true : false,
              tlsHandshakeMs,
              tls: tlsData,
              httpResponded: false,
              protocolDetected: isNonHttpProtocol
                ? useTls
                  ? 'TLS_TCP_BANNER'
                  : 'RAW_TCP_BANNER'
                : useTls
                ? 'TLS_OPEN_NO_HTTP'
                : 'TCP_OPEN_NO_HTTP',
              banner: banner || null,
              httpError: isNonHttpProtocol
                ? 'TCP connection succeeded — remote port speaks a non-HTTP protocol.'
                : err?.message || 'HTTP request failed after TCP connect.',
            },
            [activeSocket, tcpSocket]
          );
        });

        req.end();
      };

      if (!useTls) {
        runHttpOrBannerPhase(tcpSocket, null, null);
        return;
      }

      const tlsStart = Date.now();
      const tlsSocket = tls.connect({
        socket: tcpSocket,
        servername: net.isIP(hostname) ? undefined : hostname,
        rejectUnauthorized: false,
        ALPNProtocols: ['http/1.1'],
      });

      const tlsTimer = setTimeout(() => {
        finish(
          {
            tcpConnected: true,
            tcpConnectMs,
            tlsUsed: true,
            tlsConnected: false,
            tlsHandshakeMs: Date.now() - tlsStart,
            tlsErrorCode: 'TLS_TIMEOUT',
            tlsErrorMessage: 'TCP connected, but SSL/TLS handshake timed out after 5s.',
          },
          [tlsSocket, tcpSocket]
        );
      }, 5000);

      tlsSocket.once('error', (err) => {
        clearTimeout(tlsTimer);
        finish(
          {
            tcpConnected: true,
            tcpConnectMs,
            tlsUsed: true,
            tlsConnected: false,
            tlsHandshakeMs: Date.now() - tlsStart,
            tlsErrorCode: err?.code || 'TLS_HANDSHAKE_ERROR',
            tlsErrorMessage: err?.message || 'SSL/TLS handshake failed.',
          },
          [tlsSocket, tcpSocket]
        );
      });

      tlsSocket.once('secureConnect', async () => {
        clearTimeout(tlsTimer);
        const tlsHandshakeMs = Date.now() - tlsStart;
        try {
          const tlsData = await extractLiveTlsCertificate(tlsSocket, hostname);
          runHttpOrBannerPhase(tlsSocket, tlsData, tlsHandshakeMs);
        } catch (err) {
          finish(
            {
              tcpConnected: true,
              tcpConnectMs,
              tlsUsed: true,
              tlsConnected: true,
              tlsHandshakeMs,
              tlsErrorCode: 'CERT_PARSE_ERROR',
              tlsErrorMessage: err?.message || 'Connected over TLS, but certificate inspection failed.',
            },
            [tlsSocket, tcpSocket]
          );
        }
      });
    });
  });
}

async function probeSingleHop({ hostname, port, pathWithQuery, method, tlsMode, explicitScheme }) {
  const dnsResult = await resolvePublicTargetIps(hostname);
  if (dnsResult.blocked) {
    return { blocked: true, dns: dnsResult, error: dnsResult.reason };
  }
  if (dnsResult.notFound) {
    return {
      reachability: 'DNS_FAILED',
      dns: dnsResult,
      icmp: null,
      resolvedIp: null,
      tcpConnected: false,
      tcpConnectMs: null,
      tcpErrorCode: 'ENOTFOUND',
      tcpErrorMessage: `External public DNS (8.8.8.8 / 1.1.1.1) could not resolve "${hostname}" (NXDOMAIN / NODATA).`,
    };
  }

  const primaryIp = dnsResult.ipv4[0] || dnsResult.ipv6[0];
  let preferTls = true;
  if (tlsMode === 'plain') {
    preferTls = false;
  } else if (tlsMode === 'tls') {
    preferTls = true;
  } else {
    // 'auto' mode
    if (explicitScheme === 'https') preferTls = true;
    else if (explicitScheme === 'http') preferTls = false;
    else if (PLAIN_BY_DEFAULT_PORTS.has(port)) preferTls = false;
    else preferTls = true;
  }

  // Fire Active Sonar ICMP Ping in parallel with TCP/TLS/HTTP socket probe
  const icmpPromise = executeIcmpPing(primaryIp);

  let attempt = await executeSocketProbe({
    ip: primaryIp,
    hostname,
    port,
    pathWithQuery,
    method,
    useTls: preferTls,
  });
  let tlsFallbackNote = null;

  // In 'auto' mode on custom ports without explicit https://, if TLS fails because remote port speaks plain HTTP/TCP, auto-fallback to plain!
  if (
    tlsMode === 'auto' &&
    preferTls &&
    explicitScheme !== 'https' &&
    port !== 443 &&
    attempt.tcpConnected &&
    attempt.tlsConnected === false &&
    /wrong version number|unknown protocol|packet length too long|alert/i.test(
      String(attempt.tlsErrorMessage || '')
    )
  ) {
    const plainRetry = await executeSocketProbe({
      ip: primaryIp,
      hostname,
      port,
      pathWithQuery,
      method,
      useTls: false,
    });
    if (plainRetry.tcpConnected) {
      attempt = plainRetry;
      tlsFallbackNote = `Port ${port} did not accept SSL/TLS; automatically probed over plain TCP/HTTP.`;
    }
  }

  // Conversely, if plain HTTP on a custom port returns 400 "plain HTTP request was sent to HTTPS port", auto-upgrade in 'auto' mode!
  if (
    tlsMode === 'auto' &&
    !preferTls &&
    explicitScheme !== 'http' &&
    attempt.http?.statusCode === 400 &&
    port !== 80
  ) {
    const tlsRetry = await executeSocketProbe({
      ip: primaryIp,
      hostname,
      port,
      pathWithQuery,
      method,
      useTls: true,
    });
    if (tlsRetry.tlsConnected) {
      attempt = tlsRetry;
      tlsFallbackNote = `Port ${port} required SSL/TLS; automatically upgraded handshake.`;
    }
  }

  let reachability = 'TCP_FAILED';
  if (attempt.tcpConnected) {
    if (attempt.tlsUsed && !attempt.tlsConnected) {
      reachability = 'TLS_FAILED';
    } else if (attempt.httpResponded) {
      reachability = 'HTTP_OK';
    } else {
      reachability = 'TCP_OPEN';
    }
  }

  const icmp = await icmpPromise;

  return {
    reachability,
    dns: dnsResult,
    icmp,
    resolvedIp: primaryIp,
    tlsFallbackNote,
    ...attempt,
  };
}

function buildDisplayUrl(scheme, hostname, port, pathWithQuery) {
  const hostPart = net.isIP(hostname) === 6 ? `[${hostname}]` : hostname;
  const isDefaultPort = (scheme === 'https' && port === 443) || (scheme === 'http' && port === 80);
  return `${scheme}://${hostPart}${isDefaultPort ? '' : `:${port}`}${pathWithQuery}`;
}

async function handleUrlProbe(req) {
  const startedAt = Date.now();
  const body = await readRequestBodyJson(req);

  const rawUrl = String(body.url || '').trim();
  const portOverride = body.port;
  const method = String(body.method || 'GET').toUpperCase() === 'HEAD' ? 'HEAD' : 'GET';
  const followRedirects = Boolean(body.followRedirects);
  const rawTlsMode = String(body.tlsMode || 'auto').toLowerCase();
  const tlsMode = rawTlsMode === 'tls' || rawTlsMode === 'plain' ? rawTlsMode : 'auto';

  const parsedTarget = parseProbeUrlAndPort(rawUrl, portOverride);
  if (parsedTarget.error) {
    return { status: 400, body: { error: parsedTarget.error } };
  }

  const MAX_REDIRECTS = 5;
  const redirectChain = [];
  let redirectWarning = null;

  let curHostname = parsedTarget.hostname;
  let curPort = parsedTarget.port;
  let curPath = parsedTarget.pathWithQuery;
  let curExplicitScheme = parsedTarget.explicitScheme;
  let curTlsMode = tlsMode;

  let finalHop = null;

  for (let hopIdx = 0; hopIdx <= MAX_REDIRECTS; hopIdx++) {
    const hopStart = Date.now();
    const hopRes = await probeSingleHop({
      hostname: curHostname,
      port: curPort,
      pathWithQuery: curPath,
      method,
      tlsMode: curTlsMode,
      explicitScheme: curExplicitScheme,
    });

    if (hopRes.blocked) {
      if (hopIdx === 0) {
        return { status: 400, body: { error: hopRes.error } };
      }
      redirectWarning = `Redirect hop #${hopIdx} blocked: ${hopRes.error}`;
      break;
    }

    const effectiveScheme = hopRes.tlsUsed ? 'https' : 'http';
    const hopUrl = buildDisplayUrl(effectiveScheme, curHostname, curPort, curPath);

    finalHop = {
      ...hopRes,
      url: hopUrl,
      hostname: curHostname,
      port: curPort,
      pathWithQuery: curPath,
    };

    const statusCode = hopRes.http?.statusCode || 0;
    const location = hopRes.http?.location || null;
    const isRedirect =
      hopRes.httpResponded &&
      [301, 302, 303, 307, 308].includes(statusCode) &&
      Boolean(location);

    redirectChain.push({
      hop: hopIdx + 1,
      url: hopUrl,
      hostname: curHostname,
      resolvedIp: hopRes.resolvedIp,
      port: curPort,
      reachability: hopRes.reachability,
      statusCode: statusCode || null,
      statusMessage: hopRes.http?.statusMessage || null,
      location,
      tlsProtocol: hopRes.tls?.protocol || null,
      durationMs: Date.now() - hopStart,
    });

    if (!followRedirects || !isRedirect) {
      break;
    }

    if (hopIdx === MAX_REDIRECTS) {
      redirectWarning = `Maximum redirect limit (${MAX_REDIRECTS} hops) reached.`;
      break;
    }

    let nextParsedUrl;
    try {
      nextParsedUrl = new URL(location, hopUrl);
    } catch {
      redirectWarning = `Malformed Redirect Location header: "${location}"`;
      break;
    }

    const nextScheme = nextParsedUrl.protocol.replace(':', '').toLowerCase();
    if (nextScheme !== 'http' && nextScheme !== 'https') {
      redirectWarning = `Redirect pointed to non-HTTP scheme "${nextScheme}://" (${location}).`;
      break;
    }

    const nextTargetCheck = parseProbeUrlAndPort(nextParsedUrl.toString(), undefined);
    if (nextTargetCheck.error) {
      redirectWarning = `Redirect target "${nextParsedUrl.hostname}" is internal or invalid: ${nextTargetCheck.error}`;
      break;
    }

    curHostname = nextTargetCheck.hostname;
    curPort = nextTargetCheck.port;
    curPath = nextTargetCheck.pathWithQuery;
    curExplicitScheme = nextScheme;
    curTlsMode = 'auto';
  }

  return {
    status: 200,
    body: {
      requestedInput: rawUrl,
      requestedPort: parsedTarget.port,
      method,
      followRedirects,
      tlsMode,
      finalUrl: finalHop.url,
      hostname: finalHop.hostname,
      port: finalHop.port,
      path: finalHop.pathWithQuery,
      reachability: finalHop.reachability,
      dns: {
        dnsMs: finalHop.dns.dnsMs,
        resolvedIp: finalHop.resolvedIp,
        ipv4: finalHop.dns.ipv4,
        ipv6: finalHop.dns.ipv6,
      },
      icmp: finalHop.icmp || null,
      tcp: {
        connected: finalHop.tcpConnected,
        connectMs: finalHop.tcpConnectMs,
        errorCode: finalHop.tcpErrorCode || null,
        errorMessage: finalHop.tcpErrorMessage || null,
      },
      tls: finalHop.tlsUsed
        ? {
            attempted: true,
            connected: Boolean(finalHop.tlsConnected),
            handshakeMs: finalHop.tlsHandshakeMs ?? null,
            errorCode: finalHop.tlsErrorCode || null,
            errorMessage: finalHop.tlsErrorMessage || null,
            protocol: finalHop.tls?.protocol || null,
            cipher: finalHop.tls?.cipher || null,
            authorizedByNode: finalHop.tls?.authorizedByNode ?? false,
            authorizationError: finalHop.tls?.authorizationError || null,
            certificate: finalHop.tls?.certificate || null,
          }
        : null,
      http: finalHop.http || null,
      protocolDetected: finalHop.protocolDetected || null,
      banner: finalHop.banner || null,
      httpError: finalHop.httpError || null,
      tlsFallbackNote: finalHop.tlsFallbackNote || null,
      redirectChain,
      redirectWarning,
      totalDurationMs: Date.now() - startedAt,
    },
  };
}

// ============================================================================
// MAIN MODULAR API HANDLER (Shared by Vite Dev & Production Node Server)
// ============================================================================
function sanitizeBigInt(val) {
  if (val === null || val === undefined) return val;
  if (typeof val === 'bigint') return Number(val);
  if (Array.isArray(val)) return val.map(sanitizeBigInt);
  if (typeof val === 'object') {
    const res = {};
    for (const [k, v] of Object.entries(val)) {
      res[k] = sanitizeBigInt(v);
    }
    return res;
  }
  return val;
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(sanitizeBigInt(payload)));
}

export async function handleApiRequest(req, res) {
  if (!req.url || !req.url.startsWith('/api/')) {
    return false;
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  const clientIp = extractClientIp(req);
  if (!checkRateLimit(clientIp)) {
    sendJson(res, 429, { error: 'Rate limit exceeded (max 60 requests/min). Stand by before retrying.' });
    return true;
  }

  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  try {
    if (pathname === '/api/health' && req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        service: 'techtools.subwrite.se',
        version: '0.2.5',
        timestamp: new Date().toISOString(),
      });
      return true;
    }

    if (pathname === '/api/dns' && req.method === 'GET') {
      const domain = urlObj.searchParams.get('domain') || '';
      const serverParam = urlObj.searchParams.get('server') || '';
      const result = await handleDnsLookup(domain, serverParam);
      sendJson(res, result.status, result.body);
      return true;
    }

    if (pathname === '/api/ip' && req.method === 'GET') {
      const target = urlObj.searchParams.get('target') || '';
      const result = await handleIpLookup(req, target);
      sendJson(res, result.status, result.body);
      return true;
    }

    if (pathname === '/api/cert' && req.method === 'POST') {
      const result = await handleCertAnalyze(req);
      sendJson(res, result.status, result.body);
      return true;
    }

    if (pathname === '/api/probe' && req.method === 'POST') {
      const result = await handleUrlProbe(req);
      sendJson(res, result.status, result.body);
      return true;
    }

    sendJson(res, 404, { error: `Unknown API endpoint: ${pathname}` });
    return true;
  } catch (err) {
    console.error('API Error:', err);
    sendJson(res, 500, { error: 'Internal diagnostic console error' });
    return true;
  }
}
