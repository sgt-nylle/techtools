/**
 * MOD-09 BACKEND: MAIL TLS TESTER (/api/mailtls) — live SMTP STARTTLS / SMTPS negotiation probe.
 *
 * Streams a checktls-style negotiation transcript as Server-Sent Events while it:
 *   1. resolves the domain's MX records (RFC 7505 null-MX + RFC 5321 implicit-MX aware),
 *   2. connects to each MX (up to MAX_MX_HOSTS) on TCP/25 (or 587 / 465),
 *   3. reads the banner, sends EHLO, issues STARTTLS (or implicit TLS on 465) and negotiates TLS,
 *   4. inspects the certificate (presence, self-signed vs. externally trusted, hostname match, expiry,
 *      key strength) plus protocol / cipher / key exchange, re-EHLOs over TLS and QUITs,
 *   5. audits domain transport-security policy: MTA-STS (TXT + HTTPS policy), TLS-RPT, DANE TLSA.
 *
 * No mail is ever sent: the session stops after EHLO-over-TLS and closes politely with QUIT.
 */
import net from 'node:net';
import tls from 'node:tls';
import https from 'node:https';
import { domainToASCII } from 'node:url';

const EHLO_NAME = (process.env.MAILTLS_EHLO_NAME || 'techtools.subwrite.se').trim();
const ALLOWED_PORTS = new Set([25, 587, 465]);
const MAX_MX_HOSTS = 3;
const CONNECT_TIMEOUT_MS = 8000;
const REPLY_TIMEOUT_MS = 15000;
const TLS_TIMEOUT_MS = 10000;
const TOTAL_BUDGET_MS = 80_000;
const HEARTBEAT_MS = 10_000;
const MAX_ACTIVE_GLOBAL = 4;
const BLOCKED_INTERNAL_SUFFIXES = ['.local', '.internal', '.lan', '.home.arpa', '.localhost', '.corp', '.intranet'];
const USER_AGENT = 'SubWrite-TechTools-MailTLS/0.8.0 (+https://techtools.subwrite.se)';

const activeByIp = new Map();
let activeGlobal = 0;

// ============================================================================
// INPUT PARSING
// ============================================================================
function parseMailTarget(raw, direct) {
  let s = String(raw || '').trim();
  if (!s) return { error: 'Enter a mail domain (e.g. subwrite.se), an e-mail address, or a mail server host.' };
  if (s.length > 320 || /[\s\0]/.test(s)) return { error: 'Invalid target (no spaces or control characters).' };
  s = s.replace(/^mailto:/i, '').replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  if (s.includes('@')) s = s.slice(s.lastIndexOf('@') + 1);
  s = s.split(/[/?#]/)[0];
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  s = s.replace(/\.+$/, '').toLowerCase();
  if (!s) return { error: 'Target is empty.' };

  if (net.isIP(s)) {
    if (!direct) return { error: 'IP addresses have no MX records — tick DIRECT HOST to probe a mail server IP directly.' };
    return { host: s, isIp: true };
  }
  if (s === 'localhost' || BLOCKED_INTERNAL_SUFFIXES.some((sfx) => s === sfx.slice(1) || s.endsWith(sfx))) {
    return { error: `"${s}" uses a reserved local/internal suffix and cannot be tested from the public internet.` };
  }
  const ascii = domainToASCII(s);
  if (!ascii || ascii.length > 253 || !/^([a-z0-9-_]{1,63}\.)+[a-z0-9-]{2,63}$/i.test(ascii)) {
    return { error: `Invalid domain or host name: "${s}".` };
  }
  return { host: ascii.toLowerCase(), isIp: false };
}

function raceTimeout(promise, ms, code) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`${code} after ${ms} ms`), { code })), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// ============================================================================
// SMTP SESSION (line-oriented reply reader that survives the STARTTLS socket swap)
// ============================================================================
class SmtpSession {
  constructor(log) {
    this.log = log;
    this.socket = null;
    this.buffer = '';
    this.pending = null;
    this.closed = false;
    this.onData = (chunk) => {
      this.buffer += chunk.toString('latin1');
      if (this.buffer.length > 65536) this.buffer = this.buffer.slice(-65536);
      this.tryResolve();
    };
    this.onClose = () => {
      this.closed = true;
      if (this.pending) {
        const { reject, timer } = this.pending;
        this.pending = null;
        clearTimeout(timer);
        reject(Object.assign(new Error('Connection closed by remote server'), { code: 'CONNECTION_CLOSED' }));
      }
    };
    this.onError = () => {};
  }

  attach(socket) {
    this.detach();
    this.socket = socket;
    this.closed = false;
    socket.on('data', this.onData);
    socket.on('close', this.onClose);
    socket.on('error', this.onError);
  }

  detach() {
    if (!this.socket) return;
    this.socket.off('data', this.onData);
    this.socket.off('close', this.onClose);
    this.socket.off('error', this.onError);
    this.socket = null;
  }

  tryResolve() {
    if (!this.pending) return;
    const lines = [];
    let pos = 0;
    let idx;
    while ((idx = this.buffer.indexOf('\n', pos)) !== -1) {
      const line = this.buffer.slice(pos, idx).replace(/\r$/, '');
      pos = idx + 1;
      lines.push(line);
      if (/^\d{3}(?: |$)/.test(line)) {
        this.buffer = this.buffer.slice(pos);
        const { resolve, timer } = this.pending;
        this.pending = null;
        clearTimeout(timer);
        lines.forEach((l) => this.log('S', l));
        resolve({ code: Number(line.slice(0, 3)), lines });
        return;
      }
    }
  }

  readReply(timeoutMs = REPLY_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(Object.assign(new Error('Connection already closed'), { code: 'CONNECTION_CLOSED' }));
        return;
      }
      const timer = setTimeout(() => {
        this.pending = null;
        reject(Object.assign(new Error(`No SMTP reply within ${Math.round(timeoutMs / 1000)} s`), { code: 'REPLY_TIMEOUT' }));
      }, timeoutMs);
      this.pending = { resolve, reject, timer };
      this.tryResolve();
    });
  }

  send(command) {
    this.log('C', command);
    this.socket?.write(`${command}\r\n`);
  }

  async command(cmd, timeoutMs) {
    this.send(cmd);
    return this.readReply(timeoutMs);
  }

  destroy() {
    const s = this.socket;
    this.detach();
    s?.destroy();
  }
}

function connectTcp(ip, port) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const sock = net.connect({ host: ip, port });
    const timer = setTimeout(() => {
      sock.destroy();
      reject(Object.assign(new Error(`TCP connect timed out after ${CONNECT_TIMEOUT_MS / 1000} s`), { code: 'ETIMEDOUT' }));
    }, CONNECT_TIMEOUT_MS);
    sock.once('connect', () => {
      clearTimeout(timer);
      resolve({ socket: sock, connectMs: Date.now() - started });
    });
    sock.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function upgradeToTls(socket, host) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tlsSocket = tls.connect({
      socket,
      servername: net.isIP(host) ? undefined : host,
      rejectUnauthorized: false, // we *report* trust instead of aborting, exactly like an opportunistic MTA
      minVersion: 'TLSv1',
      ciphers: 'DEFAULT:@SECLEVEL=0', // let legacy servers negotiate so weak setups can be reported
    });
    const timer = setTimeout(() => {
      tlsSocket.destroy();
      reject(Object.assign(new Error(`TLS handshake timed out after ${TLS_TIMEOUT_MS / 1000} s`), { code: 'TLS_TIMEOUT' }));
    }, TLS_TIMEOUT_MS);
    tlsSocket.once('secureConnect', () => {
      clearTimeout(timer);
      resolve({ tlsSocket, handshakeMs: Date.now() - started });
    });
    tlsSocket.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function parseEhloCapabilities(lines) {
  return lines
    .slice(1)
    .map((l) => l.replace(/^\d{3}[- ]/, '').trim())
    .filter(Boolean);
}

function hasCapability(caps, name) {
  return caps.some((c) => c.toUpperCase() === name || c.toUpperCase().startsWith(`${name} `));
}

function describeConnectError(err) {
  const code = err?.code || '';
  if (code === 'ETIMEDOUT') return 'TIMEOUT — no response (filtered by a firewall, or outbound SMTP blocked by the probe network)';
  if (code === 'ECONNREFUSED') return 'REFUSED — host reachable but nothing listens on this port';
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return `UNREACHABLE (${code}) — no route to host`;
  return `${code || 'ERROR'} — ${err?.message || 'connection failed'}`;
}

function keyStrength(publicKey) {
  if (!publicKey) return { label: 'UNKNOWN', ok: null };
  const d = publicKey.details || {};
  if (publicKey.type === 'RSA' || publicKey.type === 'RSA-PSS') {
    const bits = d.modulusLength || 0;
    return { label: `RSA ${bits} bit`, ok: bits >= 2048, bits };
  }
  if (publicKey.type === 'EC') return { label: `ECDSA ${d.namedCurve || ''}`.trim(), ok: true };
  if (publicKey.type === 'ED25519' || publicKey.type === 'ED448') return { label: publicKey.type, ok: true };
  return { label: publicKey.type, ok: null };
}

// ============================================================================
// PER-HOST PROBE
// ============================================================================
async function probeMailHost({ host, ip, port, priority, emitLog, extractLiveTlsCertificate, registerCleanup }) {
  const startedAt = Date.now();
  const log = (dir, text) => emitLog(dir, text, host);
  const result = {
    host,
    ip,
    ipVersion: net.isIP(ip) === 6 ? 'IPv6' : 'IPv4',
    priority,
    port,
    tcp: { ok: false, ms: null, error: null },
    banner: null,
    ehloCapabilities: [],
    ehloTlsCapabilities: [],
    starttlsAdvertised: port === 465 ? null : false,
    tls: null,
    certificate: null,
    error: null,
    stage: 'CONNECT',
    checks: [],
    score: 0,
    grade: 'F',
    durationMs: 0,
  };

  const session = new SmtpSession(log);
  registerCleanup(() => session.destroy());
  let rawSocket = null;

  try {
    log('I', `Connecting to ${host} [${ip}] port ${port}${port === 465 ? ' (implicit TLS / SMTPS)' : ''} …`);
    let connected;
    try {
      connected = await connectTcp(ip, port);
    } catch (err) {
      result.tcp.error = describeConnectError(err);
      result.tcp.errorCode = err?.code || null;
      log('ERR', `TCP connect failed: ${result.tcp.error}`);
      throw Object.assign(new Error(result.tcp.error), { handled: true });
    }
    rawSocket = connected.socket;
    registerCleanup(() => rawSocket?.destroy());
    result.tcp = { ok: true, ms: connected.connectMs, error: null };
    log('OK', `TCP connected in ${connected.connectMs} ms`);

    const runTlsHandshake = async (socket) => {
      result.stage = 'TLS';
      log('TLS', `Negotiating TLS (SNI: ${net.isIP(host) ? 'none — IP target' : host}) …`);
      const { tlsSocket, handshakeMs } = await upgradeToTls(socket, host);
      registerCleanup(() => tlsSocket.destroy());
      const eph = typeof tlsSocket.getEphemeralKeyInfo === 'function' ? tlsSocket.getEphemeralKeyInfo() : null;
      const info = await extractLiveTlsCertificate(tlsSocket, host);
      result.tls = {
        protocol: info.protocol,
        cipher: info.cipher,
        keyExchange: eph && eph.type ? `${eph.type}${eph.name ? ` ${eph.name}` : ''}${eph.size ? ` (${eph.size} bit)` : ''}` : null,
        handshakeMs,
        authorizedByNode: info.authorizedByNode,
        authorizationError: info.authorizationError,
      };
      if (info.certificate) {
        const { fullChainPem: _omit, ...cert } = info.certificate;
        result.certificate = { ...cert, keyStrength: keyStrength(cert.publicKey) };
      }
      log('OK', `TLS handshake complete in ${handshakeMs} ms — ${info.protocol}, ${info.cipher?.standardName || info.cipher?.name || 'unknown cipher'}`);
      if (result.tls.keyExchange) log('TLS', `Key exchange: ${result.tls.keyExchange}`);
      const c = result.certificate;
      if (!c) {
        log('ERR', 'Server presented NO certificate');
      } else {
        log('TLS', `Certificate subject: ${c.subject.replace(/\n/g, ', ')}`);
        log('TLS', `Issuer: ${c.issuer.replace(/\n/g, ', ')}`);
        log('TLS', `Valid ${c.validFrom} → ${c.validTo} (${c.isExpired ? 'EXPIRED' : `${c.daysRemaining} days left`})`);
        log('TLS', `Public key: ${c.keyStrength.label} • chain sent: ${c.wireChainCount} cert(s)`);
        log(c.isSelfSigned ? 'WARN' : 'TLS', c.isSelfSigned ? 'Certificate is SELF-SIGNED' : 'Certificate is CA-issued (not self-signed)');
        log(c.hostnameMatch ? 'OK' : 'WARN', c.hostnameMatch ? `Hostname "${host}" matches certificate (${c.matchedIdentity})` : `Hostname "${host}" does NOT match certificate SAN/CN`);
        log(c.trust?.trusted ? 'OK' : 'WARN', `Trust: ${c.trust?.trusted ? 'EXTERNALLY TRUSTED (public CA chain)' : `${c.trust?.status || 'UNTRUSTED'} — ${c.trust?.details || info.authorizationError || ''}`}`);
      }
      session.attach(tlsSocket);
      return tlsSocket;
    };

    if (port === 465) {
      await runTlsHandshake(rawSocket);
      result.stage = 'BANNER';
      const banner = await session.readReply();
      result.banner = banner.lines.join(' | ');
      if (banner.code !== 220) throw new Error(`Unexpected banner reply ${banner.code}`);
    } else {
      session.attach(rawSocket);
      result.stage = 'BANNER';
      log('I', 'Waiting for SMTP banner …');
      const banner = await session.readReply();
      result.banner = banner.lines.join(' | ');
      if (banner.code !== 220) throw new Error(`Server refused session with banner code ${banner.code}`);
    }

    result.stage = 'EHLO';
    let ehlo = await session.command(`EHLO ${EHLO_NAME}`);
    if (ehlo.code !== 250) {
      log('WARN', `EHLO rejected (${ehlo.code}) — falling back to HELO (no ESMTP extensions, no STARTTLS)`);
      ehlo = await session.command(`HELO ${EHLO_NAME}`);
      if (ehlo.code !== 250) throw new Error(`HELO rejected with ${ehlo.code}`);
    }
    const caps = parseEhloCapabilities(ehlo.lines);
    if (port === 465) result.ehloTlsCapabilities = caps;
    else result.ehloCapabilities = caps;

    if (port !== 465) {
      result.starttlsAdvertised = hasCapability(caps, 'STARTTLS');
      if (!result.starttlsAdvertised) {
        log('ERR', 'STARTTLS is NOT advertised — mail to this server would travel in PLAINTEXT');
      } else {
        log('OK', 'STARTTLS advertised');
        result.stage = 'STARTTLS';
        const st = await session.command('STARTTLS');
        if (st.code !== 220) throw new Error(`STARTTLS refused with ${st.code}`);
        session.detach();
        await runTlsHandshake(rawSocket);
        result.stage = 'EHLO_TLS';
        const ehlo2 = await session.command(`EHLO ${EHLO_NAME}`);
        if (ehlo2.code === 250) result.ehloTlsCapabilities = parseEhloCapabilities(ehlo2.lines);
        else log('WARN', `EHLO after STARTTLS returned ${ehlo2.code}`);
      }
    }

    result.stage = 'QUIT';
    try {
      await session.command('QUIT', 4000);
    } catch {
      log('I', 'No reply to QUIT (connection closed)');
    }
    result.stage = 'DONE';
    log('OK', `Session closed — ${host} probe finished in ${Date.now() - startedAt} ms`);
  } catch (err) {
    if (!err.handled) {
      result.error = `${result.stage}: ${err.message}`;
      log('ERR', `${result.stage} failed: ${err.code === 'REPLY_TIMEOUT' ? err.message : err.message || err.code}`);
    } else {
      result.error = `CONNECT: ${err.message}`;
    }
  } finally {
    session.destroy();
    rawSocket?.destroy();
  }

  result.durationMs = Date.now() - startedAt;
  scoreHost(result);
  return result;
}

// ============================================================================
// SCORING (checktls-style confidence factor, 0–100)
// ============================================================================
function scoreHost(r) {
  const checks = [];
  const add = (id, label, weight, status, detail) => checks.push({ id, label, weight, status, detail });
  const c = r.certificate;
  const tlsOk = Boolean(r.tls);
  const proto = r.tls?.protocol || '';

  add('tcp', 'TCP connect', 10, r.tcp.ok ? 'pass' : 'fail', r.tcp.ok ? `${r.tcp.ms} ms` : r.tcp.error);
  add('banner', 'SMTP banner (220)', 5, r.banner ? 'pass' : r.tcp.ok ? 'fail' : 'skip', r.banner ? r.banner.slice(0, 120) : '—');
  add('ehlo', 'EHLO accepted', 5, r.ehloCapabilities.length || r.ehloTlsCapabilities.length ? 'pass' : r.banner ? 'fail' : 'skip', '');
  if (r.port !== 465) {
    add('starttls', 'STARTTLS advertised', 20, r.starttlsAdvertised ? 'pass' : r.banner ? 'fail' : 'skip', r.starttlsAdvertised ? '' : 'Plaintext only');
  }
  add('tls', 'TLS negotiated', r.port === 465 ? 35 : 15, tlsOk ? 'pass' : r.banner || r.port === 465 ? 'fail' : 'skip', tlsOk ? `${proto} in ${r.tls.handshakeMs} ms` : '');
  add(
    'protocol',
    'Modern protocol (TLS 1.2+)',
    10,
    !tlsOk ? 'skip' : /TLSv1\.[23]/.test(proto) ? 'pass' : 'fail',
    tlsOk ? `${proto}${r.tls.cipher?.standardName ? ` • ${r.tls.cipher.standardName}` : ''}` : ''
  );
  add('cert', 'Certificate presented', 0, !tlsOk ? 'skip' : c ? 'pass' : 'fail', '');
  add(
    'trusted',
    'Externally trusted (public CA)',
    15,
    !c ? 'skip' : c.trust?.trusted ? 'pass' : c.isSelfSigned ? 'fail' : 'warn',
    !c ? '' : c.trust?.trusted ? 'Chain verifies to a public root' : `${c.isSelfSigned ? 'SELF-SIGNED • ' : ''}${c.trust?.status || 'UNTRUSTED'}`
  );
  add('hostname', 'Hostname matches certificate', 10, !c ? 'skip' : c.hostnameMatch ? 'pass' : 'warn', !c ? '' : c.hostnameMatch ? c.matchedIdentity || '' : `${r.host} not in SAN/CN`);
  add('validity', 'Certificate within validity', 5, !c ? 'skip' : c.isExpired || c.isNotYetValid ? 'fail' : c.daysRemaining < 14 ? 'warn' : 'pass', !c ? '' : `${c.daysRemaining} days remaining`);
  add('key', 'Key strength', 5, !c ? 'skip' : c.keyStrength.ok === false ? 'fail' : 'pass', c ? c.keyStrength.label : '');

  const total = checks.reduce((s, ch) => s + ch.weight, 0);
  const earned = checks.reduce((s, ch) => s + (ch.status === 'pass' ? ch.weight : ch.status === 'warn' ? ch.weight / 2 : 0), 0);
  r.checks = checks;
  r.score = total ? Math.round((earned / total) * 100) : 0;
  r.grade = gradeFor(r.score);
}

function gradeFor(score) {
  if (score >= 95) return 'A+';
  if (score >= 85) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 45) return 'D';
  return 'F';
}

// ============================================================================
// DOMAIN POLICY: MTA-STS, TLS-RPT, DANE
// ============================================================================
async function resolveTxtJoined(resolver, name) {
  try {
    const rows = await raceTimeout(resolver.resolveTxt(name), 3500, 'DNS_TIMEOUT');
    return rows.map((chunks) => chunks.join(''));
  } catch {
    return [];
  }
}

function fetchMtaStsPolicy(domain, ip) {
  const host = `mta-sts.${domain}`;
  return new Promise((resolve) => {
    const family = net.isIP(ip);
    const req = https.request(
      {
        host,
        servername: host,
        port: 443,
        path: '/.well-known/mta-sts.txt',
        method: 'GET',
        agent: false,
        timeout: 5000,
        lookup: (_h, opts, cb) => (opts && opts.all ? cb(null, [{ address: ip, family }]) : cb(null, ip, family)),
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/plain' },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (d) => {
          if (body.length < 65536) body += d;
        });
        res.on('end', () => resolve({ ok: res.statusCode === 200, status: res.statusCode, body, certValid: true }));
      }
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', (err) => resolve({ ok: false, status: null, body: '', certValid: !/CERT|SELF_SIGNED|ALTNAME|UNABLE_TO/.test(err.code || ''), error: err.code || err.message }));
    req.end();
  });
}

function parseMtaStsPolicy(text) {
  const policy = { version: null, mode: null, maxAge: null, mx: [] };
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*([a-z_]+)\s*:\s*(.+?)\s*$/i);
    if (!m) continue;
    const k = m[1].toLowerCase();
    if (k === 'version') policy.version = m[2];
    else if (k === 'mode') policy.mode = m[2].toLowerCase();
    else if (k === 'max_age') policy.maxAge = Number(m[2]);
    else if (k === 'mx') policy.mx.push(m[2].toLowerCase());
  }
  return policy;
}

function mxMatchesPattern(host, pattern) {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1);
    return host.endsWith(suffix) && !host.slice(0, -suffix.length).includes('.');
  }
  return host === pattern;
}

async function auditPolicies({ domain, mxHosts, port, resolver, isPublicRoutableIp, queryDohRecord }) {
  const out = { mtaSts: null, tlsRpt: null, dane: [] };

  const [stsTxt, rptTxt] = await Promise.all([
    resolveTxtJoined(resolver, `_mta-sts.${domain}`),
    resolveTxtJoined(resolver, `_smtp._tls.${domain}`),
  ]);

  const stsRecord = stsTxt.find((t) => /^v=STSv1/i.test(t)) || null;
  out.mtaSts = { record: stsRecord, policy: null, fetch: null, mxCoverage: [] };
  if (stsRecord) {
    let ips = [];
    try {
      ips = await raceTimeout(resolver.resolve4(`mta-sts.${domain}`), 3500, 'DNS_TIMEOUT');
    } catch {
      ips = [];
    }
    const ip = ips.find((a) => isPublicRoutableIp(a));
    if (!ip) {
      out.mtaSts.fetch = { ok: false, error: `mta-sts.${domain} has no public A record` };
    } else {
      const fetched = await fetchMtaStsPolicy(domain, ip);
      out.mtaSts.fetch = { ok: fetched.ok, status: fetched.status, certValid: fetched.certValid, error: fetched.error || null };
      if (fetched.ok) {
        out.mtaSts.policy = parseMtaStsPolicy(fetched.body);
        out.mtaSts.mxCoverage = mxHosts.map((h) => ({ host: h, covered: out.mtaSts.policy.mx.some((p) => mxMatchesPattern(h, p)) }));
      }
    }
  }

  const rptRecord = rptTxt.find((t) => /^v=TLSRPTv1/i.test(t)) || null;
  out.tlsRpt = { record: rptRecord, rua: rptRecord ? (rptRecord.match(/rua=([^;]+)/i)?.[1] || '').trim() : null };

  if (queryDohRecord) {
    out.dane = await Promise.all(
      mxHosts.map(async (h) => {
        const name = `_${port}._tcp.${h}`;
        const resp = await queryDohRecord(name, 'TLSA').catch(() => null);
        const answers = (resp?.Answer || []).filter((a) => a.type === 52).map((a) => String(a.data));
        return { host: h, name, records: answers, dnssecAd: Boolean(resp?.AD) };
      })
    );
  }
  return out;
}

// ============================================================================
// /api/mailtls  (Server-Sent Events stream)
// ============================================================================
function writeJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/**
 * @param {{ resolver, extractClientIp, isPublicRoutableIp, extractLiveTlsCertificate, queryDohRecord }} deps
 */
export async function handleMailTlsStream(req, res, urlObj, deps) {
  const { resolver, extractClientIp, isPublicRoutableIp, extractLiveTlsCertificate, queryDohRecord } = deps;
  const clientIp = extractClientIp(req) || 'unknown';
  const port = Number(urlObj.searchParams.get('port') || 25);
  const direct = urlObj.searchParams.get('direct') === '1';

  if (!ALLOWED_PORTS.has(port)) return writeJson(res, 400, { error: 'Port must be 25 (MX / STARTTLS), 587 (submission / STARTTLS) or 465 (SMTPS / implicit TLS).' });
  const target = parseMailTarget(urlObj.searchParams.get('domain'), direct);
  if (target.error) return writeJson(res, 400, { error: target.error });
  if (activeByIp.get(clientIp)) return writeJson(res, 429, { error: 'A mail TLS test is already running from your IP — wait for it to finish.' });
  if (activeGlobal >= MAX_ACTIVE_GLOBAL) return writeJson(res, 503, { error: 'All mail TLS probe slots are busy. Try again in a minute.' });

  activeByIp.set(clientIp, true);
  activeGlobal += 1;
  const startedAt = Date.now();
  let aborted = false;
  const cleanups = new Set();
  const registerCleanup = (fn) => cleanups.add(fn);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, no-transform',
    'Content-Encoding': 'identity', // keeps reverse-proxy compression from buffering the live feed
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive',
  });
  res.flushHeaders?.();

  const bigintSafe = (_k, v) => (typeof v === 'bigint' ? (v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString()) : v);
  const emit = (obj) => {
    if (aborted || res.writableEnded) return;
    try {
      res.write(`data: ${JSON.stringify(obj, bigintSafe)}\n\n`);
    } catch (err) {
      // Never let a serialization/write failure escape into the HTTP layer mid-stream.
      console.error('[mailtls] emit failed:', err.message);
    }
  };
  const emitLog = (dir, text, host = null) => emit({ type: 'log', t: Date.now() - startedAt, dir, host, text: String(text).slice(0, 600) });
  const heartbeat = setInterval(() => {
    if (!aborted && !res.writableEnded) res.write(': keep-alive\n\n');
  }, HEARTBEAT_MS);
  req.on('close', () => {
    if (!res.writableEnded) {
      aborted = true;
      cleanups.forEach((fn) => {
        try {
          fn();
        } catch {
          /* ignore */
        }
      });
    }
  });

  const summary = {
    type: 'summary',
    target: target.host,
    port,
    mode: direct ? 'DIRECT_HOST' : 'MX',
    mx: [],
    nullMx: false,
    implicitMx: false,
    hosts: [],
    skippedHosts: [],
    policy: null,
    overall: null,
    egressBlocked: false,
    durationMs: 0,
  };

  try {
    emitLog('I', `TechTools Mail TLS Tester — target ${target.host} • port ${port} • ${direct ? 'direct host' : 'MX lookup'} • probe EHLO name ${EHLO_NAME}`);

    // ---- 1. Build host list (MX lookup or direct host) ----
    let hostEntries = [];
    if (direct) {
      hostEntries = [{ priority: null, exchange: target.host }];
    } else {
      emitLog('I', `Resolving MX records for ${target.host} …`);
      let mx = [];
      let mxError = null;
      try {
        mx = await raceTimeout(resolver.resolveMx(target.host), 5000, 'DNS_TIMEOUT');
      } catch (err) {
        mxError = err;
      }
      if (mxError && mxError.code === 'ENOTFOUND') {
        emitLog('ERR', `Domain ${target.host} does not exist (NXDOMAIN).`);
        throw Object.assign(new Error('NXDOMAIN'), { handled: true });
      }
      mx = (mx || []).sort((a, b) => a.priority - b.priority || a.exchange.localeCompare(b.exchange));
      summary.mx = mx.map((m) => ({ priority: m.priority, exchange: m.exchange.toLowerCase().replace(/\.$/, '') }));
      if (mx.length === 1 && (mx[0].exchange === '' || mx[0].exchange === '.')) {
        summary.nullMx = true;
        emitLog('WARN', `Null MX (RFC 7505): ${target.host} explicitly accepts NO e-mail.`);
        throw Object.assign(new Error('NULL_MX'), { handled: true });
      }
      if (mx.length === 0) {
        summary.implicitMx = true;
        emitLog('WARN', `No MX records — falling back to implicit MX (the domain's own A/AAAA, RFC 5321 §5.1).`);
        hostEntries = [{ priority: 0, exchange: target.host }];
      } else {
        summary.mx.forEach((m) => emitLog('I', `MX ${String(m.priority).padStart(3, ' ')}  ${m.exchange}`));
        hostEntries = summary.mx.slice(0, MAX_MX_HOSTS);
        if (summary.mx.length > MAX_MX_HOSTS) emitLog('I', `Testing the ${MAX_MX_HOSTS} most preferred of ${summary.mx.length} MX hosts.`);
      }
    }

    // ---- 2. Domain policy audit runs in parallel with the SMTP probes ----
    const policyPromise = direct
      ? Promise.resolve(null)
      : auditPolicies({ domain: target.host, mxHosts: hostEntries.map((h) => h.exchange), port, resolver, isPublicRoutableIp, queryDohRecord }).catch(() => null);

    // ---- 3. Probe each host sequentially (readable transcript) ----
    for (const entry of hostEntries) {
      if (aborted) break;
      if (Date.now() - startedAt > TOTAL_BUDGET_MS) {
        emitLog('WARN', 'Time budget exhausted — remaining hosts skipped.');
        summary.skippedHosts.push({ host: entry.exchange, reason: 'time budget' });
        continue;
      }
      emit({ type: 'host-start', host: entry.exchange, priority: entry.priority });
      let ip = null;
      let allIps = [];
      if (net.isIP(entry.exchange)) {
        ip = entry.exchange;
        allIps = [ip];
      } else {
        const [v4, v6] = await Promise.all([
          raceTimeout(resolver.resolve4(entry.exchange), 4000, 'DNS_TIMEOUT').catch(() => []),
          raceTimeout(resolver.resolve6(entry.exchange), 4000, 'DNS_TIMEOUT').catch(() => []),
        ]);
        allIps = [...v4, ...v6];
        ip = v4.find((a) => isPublicRoutableIp(a)) || v6.find((a) => isPublicRoutableIp(a)) || null;
        emitLog('I', `${entry.exchange} → ${allIps.length ? `${v4.length} A / ${v6.length} AAAA (${allIps.slice(0, 3).join(', ')}${allIps.length > 3 ? ', …' : ''})` : 'no A/AAAA records'}`, entry.exchange);
      }
      if (!ip) {
        const reason = allIps.length ? `only private/reserved addresses (${allIps.join(', ')}) — blocked by SSRF guard` : 'host does not resolve';
        emitLog('ERR', `Skipping ${entry.exchange}: ${reason}`, entry.exchange);
        summary.skippedHosts.push({ host: entry.exchange, reason });
        continue;
      }
      const hostResult = await probeMailHost({
        host: entry.exchange,
        ip,
        port,
        priority: entry.priority,
        emitLog,
        extractLiveTlsCertificate,
        registerCleanup,
      });
      summary.hosts.push(hostResult);
      emit({ type: 'host-result', host: hostResult });
    }

    // ---- 4. Egress block heuristic (every host timed out on TCP/25) ----
    if (
      port === 25 &&
      summary.hosts.length > 0 &&
      summary.hosts.every((h) => !h.tcp.ok && h.tcp.errorCode === 'ETIMEDOUT')
    ) {
      summary.egressBlocked = true;
      emitLog(
        'WARN',
        'Every MX timed out on TCP/25 — outbound SMTP port 25 is most likely blocked by the probe server\'s network provider (common anti-spam default). Try port 587/465 with DIRECT HOST, or check again later.'
      );
    }

    // ---- 5. Policies ----
    const policy = await policyPromise;
    summary.policy = policy;
    if (policy) {
      const sts = policy.mtaSts;
      if (sts?.record) {
        emitLog('I', `MTA-STS TXT: ${sts.record}`);
        if (sts.policy) emitLog(sts.policy.mode === 'enforce' ? 'OK' : 'WARN', `MTA-STS policy: mode=${sts.policy.mode} max_age=${sts.policy.maxAge} mx=[${sts.policy.mx.join(', ')}]`);
        else emitLog('WARN', `MTA-STS policy fetch failed: ${sts.fetch?.error || `HTTP ${sts.fetch?.status}`}`);
      } else {
        emitLog('I', 'MTA-STS: not published (_mta-sts TXT missing)');
      }
      emitLog(policy.tlsRpt?.record ? 'OK' : 'I', policy.tlsRpt?.record ? `TLS-RPT: ${policy.tlsRpt.record}` : 'TLS-RPT: not published (_smtp._tls TXT missing)');
      (policy.dane || []).forEach((d) =>
        emitLog(d.records.length ? 'OK' : 'I', `DANE ${d.name}: ${d.records.length ? `${d.records.length} TLSA record(s)${d.dnssecAd ? ' • DNSSEC validated' : ' • NOT DNSSEC-validated'}` : 'no TLSA records'}`)
      );
    }
  } catch (err) {
    if (!err.handled) {
      console.error('[mailtls] error', err);
      emitLog('ERR', `Probe aborted: ${err.message}`);
    }
  } finally {
    const scored = summary.hosts;
    if (summary.egressBlocked) {
      // Our network could not reach port 25 at all — that says nothing about the target's TLS posture.
      summary.hosts.forEach((h) => {
        h.grade = 'N/A';
        h.score = null;
      });
      summary.overall = { score: null, grade: 'N/A', basis: 'inconclusive — probe egress on TCP/25 blocked' };
    } else if (scored.length) {
      const weakest = Math.min(...scored.map((h) => h.score));
      summary.overall = { score: weakest, grade: gradeFor(weakest), basis: scored.length > 1 ? 'weakest MX' : 'single host' };
    }
    summary.durationMs = Date.now() - startedAt;
    if (summary.overall) emitLog(summary.overall.score == null ? 'WARN' : summary.overall.score >= 75 ? 'OK' : 'WARN', `Overall: ${summary.overall.grade} (${summary.overall.score == null ? summary.overall.basis : `${summary.overall.score}/100, ${summary.overall.basis}`}) in ${summary.durationMs} ms`);
    emit(summary);
    emit({ type: 'done' });
    clearInterval(heartbeat);
    cleanups.forEach((fn) => {
      try {
        fn();
      } catch {
        /* ignore */
      }
    });
    activeByIp.delete(clientIp);
    activeGlobal = Math.max(0, activeGlobal - 1);
    if (!res.writableEnded) res.end();
  }
  return undefined;
}
