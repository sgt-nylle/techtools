import dns from 'node:dns';
import net from 'node:net';
import https from 'node:https';
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
          'User-Agent': 'SubWrite-TechTools/0.1.2 (+https://techtools.subwrite.se)',
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
// MAIN MODULAR API HANDLER (Shared by Vite Dev & Production Node Server)
// ============================================================================
function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
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

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
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
    if (pathname === '/api/health') {
      sendJson(res, 200, {
        ok: true,
        service: 'techtools.subwrite.se',
        version: '0.1.2',
        timestamp: new Date().toISOString(),
      });
      return true;
    }

    if (pathname === '/api/dns') {
      const domain = urlObj.searchParams.get('domain') || '';
      const serverParam = urlObj.searchParams.get('server') || '';
      const result = await handleDnsLookup(domain, serverParam);
      sendJson(res, result.status, result.body);
      return true;
    }

    if (pathname === '/api/ip') {
      const target = urlObj.searchParams.get('target') || '';
      const result = await handleIpLookup(req, target);
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
