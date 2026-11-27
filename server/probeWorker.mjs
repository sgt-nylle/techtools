/**
 * Dedicated internal Port-25 / Mail-TLS satellite worker (TT-PROD02).
 *
 * Security invariants:
 *   - Binds ONLY to a private tunnel or loopback address (refuses 0.0.0.0 / ::).
 *   - Requires TT_INTERNODE_SECRET (>= 32 chars) loaded via root-only systemd EnvironmentFile.
 *   - Verifies X-TT-Internal-Auth on every request using constant-time SHA-256 comparison.
 *   - Exposes ONLY /api/health, GET /api/mailtls, and POST /api/probe (no static SPA, no 130 MiB GeoIP MMDB).
 */
process.env.TT_IS_PROBE_WORKER = '1';

import http from 'node:http';
import crypto from 'node:crypto';
import { handleApiRequest } from './apiHandler.mjs';

const HOST = (process.env.HOST || '127.0.0.1').trim();
const PORT = Number(process.env.PORT || 3002);
const SECRET = (process.env.TT_INTERNODE_SECRET || '').trim();

if (!SECRET || SECRET.length < 32) {
  console.error('[probe-worker] Refusing to start: TT_INTERNODE_SECRET must be set (>= 32 chars).');
  process.exit(1);
}

if (HOST === '0.0.0.0' || HOST === '::' || HOST === '') {
  console.error(`[probe-worker] Refusing to bind to wildcard address "${HOST}". Use a WireGuard or loopback IP.`);
  process.exit(1);
}

const expectedDigest = crypto.createHash('sha256').update(SECRET, 'utf8').digest();

function isAuthorized(req) {
  const hdr = req.headers['x-tt-internal-auth'];
  if (typeof hdr !== 'string' || !hdr) return false;
  const actualDigest = crypto.createHash('sha256').update(hdr, 'utf8').digest();
  return crypto.timingSafeEqual(expectedDigest, actualDigest);
}

const ALLOWED_ROUTES = new Set(['/api/health', '/api/mailtls', '/api/probe']);

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');

  if (!isAuthorized(req)) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end('{}');
    return;
  }

  const pathname = (req.url || '/').split('?')[0];
  if (!ALLOWED_ROUTES.has(pathname)) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Endpoint not enabled on probe worker' }));
    return;
  }

  await handleApiRequest(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`TechTools Port-25 Probe Worker listening on http://${HOST}:${PORT}`);
});
