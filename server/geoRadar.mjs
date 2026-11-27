/**
 * MOD-03 BACKEND: SELF-HOSTED IP & DOMAIN GEOLOCATION RADAR (/api/geo)
 *
 * - Local in-memory MMDB lookups (MaxMind GeoLite2 or DB-IP Lite City + ASN) — no third-party GeoIP APIs.
 * - Domain targets: local A / AAAA resolution, per-IP geolocation, plus a 1.5s IP-pinned HEAD probe to read
 *   CDN edge headers (cf-ray, x-amz-cf-pop, x-served-by, x-vercel-id, fly-request-id, server ...) and map the
 *   IATA POP code to the *actual* serving edge location instead of the Anycast registry headquarters.
 * - Flags Anycast / CDN autonomous systems (Cloudflare, CloudFront, Fastly, Akamai, Google, ...).
 */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import https from 'node:https';
import { fileURLToPath, domainToASCII } from 'node:url';
import { MmdbReader, networkCidr } from './mmdb.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEOIP_DIR = process.env.GEOIP_DIR
  ? path.resolve(process.env.GEOIP_DIR)
  : path.resolve(__dirname, '../data/geoip');

const CITY_DB_CANDIDATES = ['GeoLite2-City.mmdb', 'dbip-city-lite.mmdb'];
const ASN_DB_CANDIDATES = ['GeoLite2-ASN.mmdb', 'dbip-asn-lite.mmdb'];
const DB_RECHECK_MS = 10 * 60_000;
const DB_MISSING_RECHECK_MS = 30_000;
const EDGE_PROBE_TIMEOUT_MS = 1500;
const MAX_TARGET_IPS = 12;
const PTR_LOOKUP_LIMIT = 4;
const BLOCKED_INTERNAL_SUFFIXES = ['.local', '.internal', '.lan', '.home.arpa', '.localhost', '.corp', '.intranet'];
const USER_AGENT = 'SubWrite-TechTools-GeoRadar/0.8.0 (+https://techtools.subwrite.se)';

// ============================================================================
// DATABASE LOADING (in-memory, hot-reloaded when the .mmdb file mtime changes)
// ============================================================================
const dbState = { city: null, asn: null, checkedAt: 0 };

function loadDatabase(candidates, current) {
  for (const name of candidates) {
    const file = path.join(GEOIP_DIR, name);
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    if (current && current.file === file && current.mtimeMs === stat.mtimeMs) return current;
    try {
      const startedAt = Date.now();
      const reader = new MmdbReader(fs.readFileSync(file));
      console.log(
        `[geo] Loaded ${name} (${reader.databaseType}, build ${reader.buildDate || '?'}, ${(stat.size / 1048576).toFixed(1)} MiB) in ${Date.now() - startedAt} ms`
      );
      return {
        file,
        name,
        mtimeMs: stat.mtimeMs,
        reader,
        source: name.startsWith('GeoLite2') ? 'MaxMind GeoLite2' : 'DB-IP Lite',
      };
    } catch (err) {
      console.error(`[geo] Failed to load ${file}:`, err.message);
    }
  }
  return null;
}

function ensureDatabases() {
  const now = Date.now();
  const missing = !dbState.city && !dbState.asn;
  if (now - dbState.checkedAt > (missing ? DB_MISSING_RECHECK_MS : DB_RECHECK_MS) || dbState.checkedAt === 0) {
    dbState.city = loadDatabase(CITY_DB_CANDIDATES, dbState.city);
    dbState.asn = loadDatabase(ASN_DB_CANDIDATES, dbState.asn);
    dbState.checkedAt = now;
  }
  return dbState;
}

/** Pre-load the MMDB files at boot so the first request is already sub-millisecond. */
export function warmGeoDatabases() {
  const { city, asn } = ensureDatabases();
  if (!city && !asn) {
    console.warn(`[geo] No GeoIP databases found in ${GEOIP_DIR} — run "npm run geoip:fetch" to enable /api/geo.`);
  }
}

function describeDb(db) {
  if (!db) return null;
  return {
    source: db.source,
    file: db.name,
    type: db.reader.databaseType,
    buildDate: db.reader.buildDate,
  };
}

// ============================================================================
// ANYCAST / CDN AUTONOMOUS SYSTEMS
// ============================================================================
const ANYCAST_ASNS = new Map([
  [13335, { provider: 'Cloudflare', kind: 'ANYCAST CDN' }],
  [209242, { provider: 'Cloudflare (Spectrum / WARP)', kind: 'ANYCAST CDN' }],
  [16509, { provider: 'Amazon (CloudFront / AWS)', kind: 'CDN / CLOUD' }],
  [14618, { provider: 'Amazon AWS', kind: 'CLOUD' }],
  [54113, { provider: 'Fastly', kind: 'ANYCAST CDN' }],
  [20940, { provider: 'Akamai', kind: 'CDN EDGE' }],
  [16625, { provider: 'Akamai', kind: 'CDN EDGE' }],
  [12222, { provider: 'Akamai', kind: 'CDN EDGE' }],
  [21342, { provider: 'Akamai', kind: 'CDN EDGE' }],
  [32787, { provider: 'Akamai Prolexic', kind: 'ANYCAST DDoS SCRUBBING' }],
  [15169, { provider: 'Google', kind: 'ANYCAST / GLOBAL EDGE' }],
  [396982, { provider: 'Google Cloud', kind: 'CLOUD / ANYCAST LB' }],
  [19527, { provider: 'Google', kind: 'ANYCAST / GLOBAL EDGE' }],
  [8075, { provider: 'Microsoft (Azure Front Door / Edge)', kind: 'CDN / CLOUD' }],
  [8068, { provider: 'Microsoft', kind: 'CDN / CLOUD' }],
  [22822, { provider: 'Edgio (Limelight)', kind: 'CDN EDGE' }],
  [15133, { provider: 'Edgio (Edgecast)', kind: 'ANYCAST CDN' }],
  [60068, { provider: 'CDN77 / DataCamp', kind: 'CDN EDGE' }],
  [200325, { provider: 'Bunny.net', kind: 'ANYCAST CDN' }],
  [19551, { provider: 'Imperva Incapsula', kind: 'ANYCAST WAF / CDN' }],
  [30148, { provider: 'Sucuri', kind: 'ANYCAST WAF / CDN' }],
  [32934, { provider: 'Meta', kind: 'GLOBAL EDGE' }],
  [2906, { provider: 'Netflix Open Connect', kind: 'CDN EDGE' }],
  [19281, { provider: 'Quad9', kind: 'ANYCAST DNS' }],
  [42, { provider: 'Packet Clearing House (WoodyNet)', kind: 'ANYCAST DNS' }],
  [36692, { provider: 'Cisco OpenDNS', kind: 'ANYCAST DNS' }],
  [397213, { provider: 'Vercel', kind: 'ANYCAST EDGE' }],
  [209, { provider: 'Lumen (CenturyLink)', kind: 'TRANSIT' }],
]);

const CDN_ORG_PATTERN = /cloudflare|akamai|fastly|cloudfront|edgecast|edgio|limelight|cdn77|bunny|incapsula|imperva|stackpath|highwinds|sucuri|vercel|netlify/i;

function classifyAnycast(asn, asOrg) {
  if (asn && ANYCAST_ASNS.has(asn)) {
    const hit = ANYCAST_ASNS.get(asn);
    if (hit.kind === 'TRANSIT') return null;
    return { ...hit, asn, matchedBy: 'ASN' };
  }
  if (asOrg && CDN_ORG_PATTERN.test(asOrg)) {
    return { provider: asOrg, kind: 'CDN (ORG MATCH)', asn: asn || null, matchedBy: 'ORG' };
  }
  return null;
}

// ============================================================================
// IATA EDGE POP DIRECTORY  [code, city, countryCode, lat, lon]
// ============================================================================
const IATA_POP_ROWS = [
  // Nordics & Baltics
  ['ARN', 'Stockholm', 'SE', 59.65, 17.92],
  ['BMA', 'Stockholm', 'SE', 59.35, 17.94],
  ['STO', 'Stockholm', 'SE', 59.33, 18.07],
  ['GOT', 'Gothenburg', 'SE', 57.66, 12.29],
  ['MMX', 'Malmö', 'SE', 55.54, 13.37],
  ['CPH', 'Copenhagen', 'DK', 55.62, 12.65],
  ['OSL', 'Oslo', 'NO', 60.19, 11.1],
  ['HEL', 'Helsinki', 'FI', 60.32, 24.95],
  ['TLL', 'Tallinn', 'EE', 59.41, 24.83],
  ['RIX', 'Riga', 'LV', 56.92, 23.97],
  ['VNO', 'Vilnius', 'LT', 54.63, 25.29],
  ['KEF', 'Reykjavík', 'IS', 63.99, -22.62],
  // Western / Central Europe
  ['AMS', 'Amsterdam', 'NL', 52.31, 4.76],
  ['BRU', 'Brussels', 'BE', 50.9, 4.48],
  ['LUX', 'Luxembourg', 'LU', 49.63, 6.21],
  ['FRA', 'Frankfurt', 'DE', 50.04, 8.56],
  ['HAM', 'Hamburg', 'DE', 53.63, 9.99],
  ['BER', 'Berlin', 'DE', 52.37, 13.5],
  ['TXL', 'Berlin', 'DE', 52.56, 13.29],
  ['MUC', 'Munich', 'DE', 48.35, 11.79],
  ['DUS', 'Düsseldorf', 'DE', 51.29, 6.77],
  ['STR', 'Stuttgart', 'DE', 48.69, 9.22],
  ['LHR', 'London', 'GB', 51.47, -0.45],
  ['LON', 'London', 'GB', 51.51, -0.13],
  ['LCY', 'London', 'GB', 51.5, 0.05],
  ['MAN', 'Manchester', 'GB', 53.35, -2.28],
  ['EDI', 'Edinburgh', 'GB', 55.95, -3.37],
  ['DUB', 'Dublin', 'IE', 53.43, -6.25],
  ['CDG', 'Paris', 'FR', 49.01, 2.55],
  ['PAR', 'Paris', 'FR', 48.86, 2.35],
  ['MRS', 'Marseille', 'FR', 43.44, 5.22],
  ['LYS', 'Lyon', 'FR', 45.73, 5.08],
  ['MAD', 'Madrid', 'ES', 40.47, -3.57],
  ['BCN', 'Barcelona', 'ES', 41.3, 2.08],
  ['LIS', 'Lisbon', 'PT', 38.77, -9.13],
  ['MXP', 'Milan', 'IT', 45.63, 8.72],
  ['LIN', 'Milan', 'IT', 45.45, 9.28],
  ['FCO', 'Rome', 'IT', 41.8, 12.25],
  ['PMO', 'Palermo', 'IT', 38.18, 13.1],
  ['ZRH', 'Zürich', 'CH', 47.46, 8.55],
  ['GVA', 'Geneva', 'CH', 46.24, 6.11],
  ['VIE', 'Vienna', 'AT', 48.11, 16.57],
  ['PRG', 'Prague', 'CZ', 50.1, 14.26],
  ['WAW', 'Warsaw', 'PL', 52.17, 20.97],
  ['BUD', 'Budapest', 'HU', 47.44, 19.26],
  ['OTP', 'Bucharest', 'RO', 44.57, 26.08],
  ['SOF', 'Sofia', 'BG', 42.7, 23.41],
  ['BEG', 'Belgrade', 'RS', 44.82, 20.31],
  ['ZAG', 'Zagreb', 'HR', 45.74, 16.07],
  ['ATH', 'Athens', 'GR', 37.94, 23.94],
  ['IST', 'Istanbul', 'TR', 41.26, 28.74],
  ['KBP', 'Kyiv', 'UA', 50.35, 30.89],
  ['KIV', 'Chișinău', 'MD', 46.93, 28.93],
  ['LED', 'St Petersburg', 'RU', 59.8, 30.26],
  ['DME', 'Moscow', 'RU', 55.41, 37.9],
  ['SVO', 'Moscow', 'RU', 55.97, 37.41],
  // North America
  ['IAD', 'Ashburn, VA', 'US', 38.95, -77.46],
  ['DCA', 'Washington, DC', 'US', 38.85, -77.04],
  ['EWR', 'Newark, NJ', 'US', 40.69, -74.17],
  ['JFK', 'New York, NY', 'US', 40.64, -73.78],
  ['LGA', 'New York, NY', 'US', 40.78, -73.87],
  ['BOS', 'Boston, MA', 'US', 42.36, -71.01],
  ['PHL', 'Philadelphia, PA', 'US', 39.87, -75.24],
  ['ORD', 'Chicago, IL', 'US', 41.98, -87.9],
  ['ATL', 'Atlanta, GA', 'US', 33.64, -84.43],
  ['MIA', 'Miami, FL', 'US', 25.79, -80.29],
  ['CLT', 'Charlotte, NC', 'US', 35.21, -80.94],
  ['DFW', 'Dallas, TX', 'US', 32.9, -97.04],
  ['IAH', 'Houston, TX', 'US', 29.99, -95.34],
  ['DEN', 'Denver, CO', 'US', 39.86, -104.67],
  ['PHX', 'Phoenix, AZ', 'US', 33.43, -112.01],
  ['LAX', 'Los Angeles, CA', 'US', 33.94, -118.41],
  ['SJC', 'San Jose, CA', 'US', 37.36, -121.93],
  ['SFO', 'San Francisco, CA', 'US', 37.62, -122.38],
  ['SEA', 'Seattle, WA', 'US', 47.45, -122.31],
  ['PDX', 'Portland, OR', 'US', 45.59, -122.6],
  ['SLC', 'Salt Lake City, UT', 'US', 40.79, -111.98],
  ['MSP', 'Minneapolis, MN', 'US', 44.88, -93.22],
  ['MCI', 'Kansas City, MO', 'US', 39.3, -94.71],
  ['LAS', 'Las Vegas, NV', 'US', 36.08, -115.15],
  ['SAN', 'San Diego, CA', 'US', 32.73, -117.19],
  ['STL', 'St. Louis, MO', 'US', 38.75, -90.37],
  ['DTW', 'Detroit, MI', 'US', 42.21, -83.35],
  ['CMH', 'Columbus, OH', 'US', 40.0, -82.89],
  ['BNA', 'Nashville, TN', 'US', 36.12, -86.68],
  ['HNL', 'Honolulu, HI', 'US', 21.32, -157.92],
  ['ANC', 'Anchorage, AK', 'US', 61.17, -150.0],
  ['YYZ', 'Toronto', 'CA', 43.68, -79.63],
  ['YUL', 'Montréal', 'CA', 45.47, -73.74],
  ['YVR', 'Vancouver', 'CA', 49.19, -123.18],
  ['YYC', 'Calgary', 'CA', 51.13, -114.01],
  ['MEX', 'Mexico City', 'MX', 19.44, -99.07],
  ['QRO', 'Querétaro', 'MX', 20.62, -100.19],
  ['GDL', 'Guadalajara', 'MX', 20.52, -103.31],
  // Latin America
  ['PTY', 'Panama City', 'PA', 9.07, -79.38],
  ['BOG', 'Bogotá', 'CO', 4.7, -74.15],
  ['LIM', 'Lima', 'PE', -12.02, -77.11],
  ['SCL', 'Santiago', 'CL', -33.39, -70.79],
  ['EZE', 'Buenos Aires', 'AR', -34.82, -58.54],
  ['GRU', 'São Paulo', 'BR', -23.43, -46.47],
  ['GIG', 'Rio de Janeiro', 'BR', -22.81, -43.25],
  ['FOR', 'Fortaleza', 'BR', -3.78, -38.53],
  // Africa & Middle East
  ['JNB', 'Johannesburg', 'ZA', -26.14, 28.25],
  ['CPT', 'Cape Town', 'ZA', -33.97, 18.6],
  ['NBO', 'Nairobi', 'KE', -1.32, 36.93],
  ['LOS', 'Lagos', 'NG', 6.58, 3.32],
  ['CAI', 'Cairo', 'EG', 30.12, 31.41],
  ['CMN', 'Casablanca', 'MA', 33.37, -7.59],
  ['DXB', 'Dubai', 'AE', 25.25, 55.36],
  ['FJR', 'Fujairah', 'AE', 25.11, 56.32],
  ['DOH', 'Doha', 'QA', 25.27, 51.61],
  ['BAH', 'Manama', 'BH', 26.27, 50.63],
  ['TLV', 'Tel Aviv', 'IL', 32.01, 34.89],
  ['RUH', 'Riyadh', 'SA', 24.96, 46.7],
  ['JED', 'Jeddah', 'SA', 21.68, 39.16],
  // Asia
  ['BOM', 'Mumbai', 'IN', 19.09, 72.87],
  ['DEL', 'New Delhi', 'IN', 28.56, 77.1],
  ['MAA', 'Chennai', 'IN', 12.99, 80.17],
  ['BLR', 'Bengaluru', 'IN', 13.2, 77.71],
  ['HYD', 'Hyderabad', 'IN', 17.24, 78.43],
  ['CCU', 'Kolkata', 'IN', 22.65, 88.45],
  ['KHI', 'Karachi', 'PK', 24.91, 67.16],
  ['SIN', 'Singapore', 'SG', 1.36, 103.99],
  ['HKG', 'Hong Kong', 'HK', 22.31, 113.92],
  ['NRT', 'Tokyo', 'JP', 35.77, 140.39],
  ['HND', 'Tokyo', 'JP', 35.55, 139.78],
  ['KIX', 'Osaka', 'JP', 34.43, 135.24],
  ['ICN', 'Seoul', 'KR', 37.46, 126.44],
  ['TPE', 'Taipei', 'TW', 25.08, 121.23],
  ['BKK', 'Bangkok', 'TH', 13.69, 100.75],
  ['KUL', 'Kuala Lumpur', 'MY', 2.75, 101.71],
  ['CGK', 'Jakarta', 'ID', -6.13, 106.66],
  ['MNL', 'Manila', 'PH', 14.51, 121.02],
  ['SGN', 'Ho Chi Minh City', 'VN', 10.82, 106.65],
  ['HAN', 'Hanoi', 'VN', 21.22, 105.81],
  // Oceania
  ['SYD', 'Sydney', 'AU', -33.95, 151.18],
  ['MEL', 'Melbourne', 'AU', -37.67, 144.84],
  ['BNE', 'Brisbane', 'AU', -27.38, 153.12],
  ['PER', 'Perth', 'AU', -31.94, 115.97],
  ['ADL', 'Adelaide', 'AU', -34.95, 138.53],
  ['AKL', 'Auckland', 'NZ', -37.01, 174.79],
];

const IATA_POPS = new Map(
  IATA_POP_ROWS.map(([code, city, countryCode, lat, lon]) => [code, { code, city, countryCode, lat, lon }])
);

// ============================================================================
// TIMEZONE DERIVATION (DB-IP Lite ships no time_zone field)
// ============================================================================
const COUNTRY_TIMEZONES = {
  SE: 'Europe/Stockholm', NO: 'Europe/Oslo', DK: 'Europe/Copenhagen', FI: 'Europe/Helsinki', IS: 'Atlantic/Reykjavik',
  EE: 'Europe/Tallinn', LV: 'Europe/Riga', LT: 'Europe/Vilnius', DE: 'Europe/Berlin', NL: 'Europe/Amsterdam',
  BE: 'Europe/Brussels', LU: 'Europe/Luxembourg', FR: 'Europe/Paris', GB: 'Europe/London', IE: 'Europe/Dublin',
  ES: 'Europe/Madrid', PT: 'Europe/Lisbon', IT: 'Europe/Rome', CH: 'Europe/Zurich', AT: 'Europe/Vienna',
  PL: 'Europe/Warsaw', CZ: 'Europe/Prague', SK: 'Europe/Bratislava', HU: 'Europe/Budapest', RO: 'Europe/Bucharest',
  BG: 'Europe/Sofia', GR: 'Europe/Athens', TR: 'Europe/Istanbul', UA: 'Europe/Kyiv', MD: 'Europe/Chisinau',
  HR: 'Europe/Zagreb', RS: 'Europe/Belgrade', SI: 'Europe/Ljubljana', BA: 'Europe/Sarajevo', MT: 'Europe/Malta',
  CY: 'Asia/Nicosia', IL: 'Asia/Jerusalem', AE: 'Asia/Dubai', SA: 'Asia/Riyadh', QA: 'Asia/Qatar', BH: 'Asia/Bahrain',
  KW: 'Asia/Kuwait', IR: 'Asia/Tehran', IN: 'Asia/Kolkata', PK: 'Asia/Karachi', BD: 'Asia/Dhaka', SG: 'Asia/Singapore',
  HK: 'Asia/Hong_Kong', CN: 'Asia/Shanghai', TW: 'Asia/Taipei', JP: 'Asia/Tokyo', KR: 'Asia/Seoul',
  TH: 'Asia/Bangkok', VN: 'Asia/Ho_Chi_Minh', MY: 'Asia/Kuala_Lumpur', PH: 'Asia/Manila', NZ: 'Pacific/Auckland',
  ZA: 'Africa/Johannesburg', EG: 'Africa/Cairo', NG: 'Africa/Lagos', KE: 'Africa/Nairobi', MA: 'Africa/Casablanca',
  AR: 'America/Argentina/Buenos_Aires', CL: 'America/Santiago', CO: 'America/Bogota', PE: 'America/Lima',
  VE: 'America/Caracas', PA: 'America/Panama', UY: 'America/Montevideo',
};

function timezoneByLongitude(countryCode, lat, lon) {
  if (lon == null) return null;
  switch (countryCode) {
    case 'US':
      if (lon > -87.5) return 'America/New_York';
      if (lon > -101) return 'America/Chicago';
      if (lon > -115) return 'America/Denver';
      if (lon > -130) return 'America/Los_Angeles';
      if (lon > -150 || lat > 50) return 'America/Anchorage';
      return 'Pacific/Honolulu';
    case 'CA':
      if (lon > -61) return 'America/Halifax';
      if (lon > -90) return 'America/Toronto';
      if (lon > -102) return 'America/Winnipeg';
      if (lon > -120) return 'America/Edmonton';
      return 'America/Vancouver';
    case 'AU':
      if (lon >= 141) return lat > -29 ? 'Australia/Brisbane' : 'Australia/Sydney';
      if (lon >= 129) return lat > -26 ? 'Australia/Darwin' : 'Australia/Adelaide';
      return 'Australia/Perth';
    case 'BR':
      return lon < -60 ? 'America/Manaus' : 'America/Sao_Paulo';
    case 'MX':
      return lon < -114 ? 'America/Tijuana' : 'America/Mexico_City';
    case 'ID':
      if (lon < 114) return 'Asia/Jakarta';
      return lon < 126 ? 'Asia/Makassar' : 'Asia/Jayapura';
    case 'RU':
      if (lon < 40) return 'Europe/Moscow';
      if (lon < 55) return 'Europe/Samara';
      if (lon < 68) return 'Asia/Yekaterinburg';
      if (lon < 82) return 'Asia/Omsk';
      if (lon < 97) return 'Asia/Krasnoyarsk';
      if (lon < 112) return 'Asia/Irkutsk';
      if (lon < 127) return 'Asia/Yakutsk';
      return lon < 145 ? 'Asia/Vladivostok' : 'Asia/Magadan';
    default:
      return null;
  }
}

function resolveTimezone(dbTz, countryCode, lat, lon) {
  if (dbTz) return { timezone: dbTz, timezoneSource: 'DATABASE', utcOffsetEstimate: null };
  const fromCountry = (countryCode && COUNTRY_TIMEZONES[countryCode]) || timezoneByLongitude(countryCode, lat, lon);
  if (fromCountry) return { timezone: fromCountry, timezoneSource: 'COUNTRY / LONGITUDE', utcOffsetEstimate: null };
  if (lon == null) return { timezone: null, timezoneSource: null, utcOffsetEstimate: null };
  const offset = Math.max(-12, Math.min(14, Math.round(lon / 15)));
  return {
    timezone: `UTC${offset >= 0 ? '+' : '-'}${String(Math.abs(offset)).padStart(2, '0')}:00`,
    timezoneSource: 'SOLAR ESTIMATE',
    utcOffsetEstimate: offset,
  };
}

// ============================================================================
// GEOLOCATION RECORD
// ============================================================================
function localizedName(entity) {
  if (!entity?.names) return null;
  return entity.names.en || Object.values(entity.names)[0] || null;
}

function geolocateIp(ip, dbs) {
  const cityHit = dbs.city ? dbs.city.reader.lookup(ip) : null;
  const asnHit = dbs.asn ? dbs.asn.reader.lookup(ip) : null;
  const c = cityHit?.data || {};
  const a = asnHit?.data || {};

  const lat = typeof c.location?.latitude === 'number' ? c.location.latitude : null;
  const lon = typeof c.location?.longitude === 'number' ? c.location.longitude : null;
  const countryCode = c.country?.iso_code || c.registered_country?.iso_code || null;
  const asn = a.autonomous_system_number ? Number(a.autonomous_system_number) : null;
  const asOrg = a.autonomous_system_organization || null;
  const prefixLength = asnHit?.data ? asnHit.prefixLength : cityHit?.data ? cityHit.prefixLength : null;

  return {
    ip,
    version: net.isIP(ip) === 6 ? 'IPv6' : 'IPv4',
    found: Boolean(cityHit?.data || asnHit?.data),
    network: prefixLength != null ? networkCidr(ip, prefixLength) : null,
    city: localizedName(c.city),
    region: localizedName(c.subdivisions?.[0]),
    country: localizedName(c.country) || localizedName(c.registered_country),
    countryCode,
    isEu: Boolean(c.country?.is_in_european_union),
    continent: localizedName(c.continent),
    continentCode: c.continent?.code || null,
    lat,
    lon,
    accuracyRadiusKm: c.location?.accuracy_radius ?? null,
    ...resolveTimezone(c.location?.time_zone || null, countryCode, lat, lon),
    asn,
    asOrg,
    anycast: classifyAnycast(asn, asOrg),
    ptr: [],
  };
}

// ============================================================================
// CDN EDGE POP DETECTION (non-blocking HEAD, pinned to an already-vetted public IP)
// ============================================================================
const EDGE_HEADER_NAMES = [
  'server',
  'cf-ray',
  'cf-cache-status',
  'x-amz-cf-pop',
  'x-amz-cf-id',
  'x-served-by',
  'x-cache',
  'via',
  'x-vercel-id',
  'fly-request-id',
  'x-nf-request-id',
  'x-azure-ref',
  'x-msedge-ref',
  'akamai-grn',
  'x-akamai-request-id',
  'x-iinfo',
  'x-sucuri-id',
  'cdn-pullzone',
  'cdn-requestcountrycode',
  'x-github-request-id',
  'alt-svc',
];

function probeEdgeHeaders(hostname, ip, timeoutMs = EDGE_PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const family = net.isIP(ip);
    let settled = false;
    let req = null;
    let timer = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ durationMs: Date.now() - startedAt, ...result });
    };

    timer = setTimeout(() => {
      req?.destroy();
      finish({ ok: false, error: `HEAD timed out after ${timeoutMs} ms` });
    }, timeoutMs);

    try {
      req = https.request(
        {
          host: hostname,
          servername: hostname,
          port: 443,
          method: 'HEAD',
          path: '/',
          agent: false,
          rejectUnauthorized: false, // read-only header inspection; certificate auditing lives in MOD-04 / MOD-06
          // Pin the socket to the IP we already validated with isPublicRoutableIp (no DNS rebinding window).
          lookup: (_host, opts, cb) =>
            opts && opts.all ? cb(null, [{ address: ip, family }]) : cb(null, ip, family),
          headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
        },
        (res) => {
          res.resume();
          finish({ ok: true, status: res.statusCode, headers: res.headers });
          res.destroy();
        }
      );
      req.on('error', (err) => finish({ ok: false, error: err.code || err.message }));
      req.end();
    } catch (err) {
      finish({ ok: false, error: err.message });
    }
  });
}

function headerValue(headers, name) {
  const v = headers?.[name];
  if (Array.isArray(v)) return v.join(', ');
  return v ? String(v) : '';
}

export function detectEdgePop(headers) {
  let provider = null;
  let code = null;
  let sourceHeader = null;
  const take = (prov, match, header) => {
    provider = provider || prov;
    if (!code && match) {
      code = match[1].toUpperCase();
      sourceHeader = header;
    }
  };

  const cfRay = headerValue(headers, 'cf-ray');
  if (cfRay) take('Cloudflare', cfRay.match(/-([A-Z]{3})\b/i), 'cf-ray');

  const amzPop = headerValue(headers, 'x-amz-cf-pop');
  if (amzPop) take('Amazon CloudFront', amzPop.match(/^([A-Z]{3})/i), 'x-amz-cf-pop');

  const servedBy = headerValue(headers, 'x-served-by');
  if (servedBy && /cache-/i.test(servedBy)) {
    // Fastly lists shield -> edge; the LAST node is the edge that answered the client.
    const nodes = servedBy.split(',').map((s) => s.trim()).filter(Boolean);
    const edgeNode = nodes[nodes.length - 1] || '';
    take('Fastly', edgeNode.match(/-([A-Z]{3})$/) || edgeNode.match(/^cache-([a-z]{3})/i), 'x-served-by');
  }

  const vercelId = headerValue(headers, 'x-vercel-id');
  if (vercelId) take('Vercel Edge Network', vercelId.match(/^([a-z]{3})\d/i), 'x-vercel-id');

  const flyId = headerValue(headers, 'fly-request-id');
  if (flyId) take('Fly.io', flyId.match(/-([a-z]{3})$/i), 'fly-request-id');

  if (!provider) {
    const server = headerValue(headers, 'server');
    const via = headerValue(headers, 'via');
    if (/cloudflare/i.test(server)) provider = 'Cloudflare';
    else if (/AkamaiGHost|AkamaiNetStorage/i.test(server) || headers?.['akamai-grn'] || headers?.['x-akamai-request-id']) provider = 'Akamai';
    else if (/cloudfront/i.test(via) || headers?.['x-amz-cf-id']) provider = 'Amazon CloudFront';
    else if (/ECAcc|ECS \(/i.test(server)) provider = 'Edgio (Edgecast)';
    else if (/BunnyCDN/i.test(server) || headers?.['cdn-pullzone']) provider = 'Bunny CDN';
    else if (/netlify/i.test(server) || headers?.['x-nf-request-id']) provider = 'Netlify Edge';
    else if (/vercel/i.test(server)) provider = 'Vercel Edge Network';
    else if (headers?.['x-azure-ref'] || headers?.['x-msedge-ref']) provider = 'Azure Front Door';
    else if (headers?.['x-iinfo']) provider = 'Imperva Incapsula';
    else if (headers?.['x-sucuri-id']) provider = 'Sucuri';
    else if (/^(gws|ESF|gfe|Google Frontend)/i.test(server)) provider = 'Google Front End';
    else if (/varnish/i.test(via) || /varnish/i.test(headerValue(headers, 'x-cache'))) provider = 'Varnish Cache';
  }

  const pop = code ? IATA_POPS.get(code) || null : null;
  return { provider, popCode: code, popSourceHeader: sourceHeader, pop };
}

function pickEdgeHeaders(headers) {
  const out = {};
  for (const name of EDGE_HEADER_NAMES) {
    const v = headerValue(headers, name);
    if (v) out[name] = v.length > 240 ? `${v.slice(0, 240)}…` : v;
  }
  return out;
}

// ============================================================================
// TARGET PARSING
// ============================================================================
function parseGeoTarget(raw) {
  let host = String(raw || '').trim();
  if (!host) return { empty: true };
  if (host.length > 2048 || /[\s\0]/.test(host)) return { error: 'Invalid target (must not contain spaces or control characters).' };

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(host)) {
    try {
      host = new URL(host).hostname;
    } catch {
      return { error: `Could not parse URL "${raw}".` };
    }
  } else if (!net.isIP(host)) {
    host = host.split(/[/?#]/)[0];
    // strip :port from "host:port" (but never from bare IPv6 literals)
    if (/^[^:]+:\d+$/.test(host)) host = host.replace(/:\d+$/, '');
  }

  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  host = host.replace(/\.+$/, '').toLowerCase();
  if (!host) return { error: 'Target hostname is empty.' };

  if (net.isIP(host)) return { ip: host };

  if (host === 'localhost' || BLOCKED_INTERNAL_SUFFIXES.some((sfx) => host === sfx.slice(1) || host.endsWith(sfx))) {
    return { error: `"${host}" uses a reserved local/internal suffix and cannot be geolocated on the public internet.` };
  }
  const ascii = domainToASCII(host);
  if (!ascii || ascii.length > 253 || !/^([a-z0-9-]{1,63}\.)+[a-z0-9-]{2,63}$/i.test(ascii)) {
    return { error: `Invalid IPv4, IPv6, or domain name: "${host}".` };
  }
  return { hostname: ascii.toLowerCase() };
}

// ============================================================================
// /api/geo HANDLER
// ============================================================================
/**
 * @param {import('node:http').IncomingMessage} req
 * @param {string} rawTarget
 * @param {{ resolver: import('node:dns').promises.Resolver, withTimeout: Function, extractClientIp: Function,
 *           isPublicRoutableIp: Function, isPrivateOrLoopbackIp: Function, discoverServerOutboundWanIp: Function }} deps
 */
export async function handleGeoLookup(req, rawTarget, deps) {
  const startedAt = Date.now();
  const { resolver, withTimeout, extractClientIp, isPublicRoutableIp, isPrivateOrLoopbackIp, discoverServerOutboundWanIp } = deps;

  const dbs = ensureDatabases();
  if (!dbs.city && !dbs.asn) {
    return {
      status: 503,
      body: {
        error: 'GeoIP radar offline: no local MMDB databases installed on this server (operator: run `npm run geoip:fetch`).',
        code: 'GEOIP_DB_MISSING',
      },
    };
  }

  const parsed = parseGeoTarget(rawTarget);
  if (parsed.error) return { status: 400, body: { error: parsed.error } };

  let mode = 'self';
  let hostname = null;
  let isLocalClient = false;
  let ips = [];
  const skippedNonPublic = [];
  let resolvedV4 = [];
  let resolvedV6 = [];

  if (parsed.empty) {
    let ip = extractClientIp(req);
    if (!ip || isPrivateOrLoopbackIp(ip)) {
      isLocalClient = true;
      ip = (await discoverServerOutboundWanIp()) || ip;
    }
    ips = [ip];
  } else if (parsed.ip) {
    mode = 'ip';
    if (!isPublicRoutableIp(parsed.ip)) {
      return {
        status: 400,
        body: { error: `"${parsed.ip}" is a private, loopback, or reserved address — it has no public geolocation.` },
      };
    }
    ips = [parsed.ip];
  } else {
    mode = 'domain';
    hostname = parsed.hostname;
    const [v4, v6] = await Promise.all([
      withTimeout(resolver.resolve4(hostname), 3000, []),
      withTimeout(resolver.resolve6(hostname), 3000, []),
    ]);
    resolvedV4 = Array.isArray(v4) ? v4 : [];
    resolvedV6 = Array.isArray(v6) ? v6 : [];
    const all = [...resolvedV4, ...resolvedV6];
    if (all.length === 0) {
      return { status: 404, body: { error: `No A / AAAA records found for "${hostname}".` } };
    }
    for (const ip of all) {
      if (isPublicRoutableIp(ip)) ips.push(ip);
      else skippedNonPublic.push(ip);
    }
    if (ips.length === 0) {
      return {
        status: 422,
        body: { error: `"${hostname}" only resolves to private / reserved addresses (${skippedNonPublic.join(', ')}).` },
      };
    }
  }

  const totalIps = ips.length;
  ips = ips.slice(0, MAX_TARGET_IPS);
  const records = ips.map((ip) => geolocateIp(ip, dbs));

  const ptrPromise = Promise.all(
    records.slice(0, PTR_LOOKUP_LIMIT).map((r) => withTimeout(resolver.reverse(r.ip), 1500, []))
  );
  const edgePromise = mode === 'domain' ? probeEdgeHeaders(hostname, ips[0]) : Promise.resolve(null);
  const [ptrResults, edgeProbe] = await Promise.all([ptrPromise, edgePromise]);
  ptrResults.forEach((ptr, i) => {
    records[i].ptr = Array.isArray(ptr) ? ptr.slice(0, 4) : [];
  });

  let edge = null;
  if (edgeProbe) {
    const detected = edgeProbe.ok ? detectEdgePop(edgeProbe.headers) : { provider: null, popCode: null, popSourceHeader: null, pop: null };
    edge = {
      kind: 'TARGET',
      probed: true,
      url: `https://${hostname}/`,
      ip: ips[0],
      ok: edgeProbe.ok,
      status: edgeProbe.status ?? null,
      error: edgeProbe.error ?? null,
      durationMs: edgeProbe.durationMs,
      provider: detected.provider || records[0].anycast?.provider || null,
      popCode: detected.popCode,
      popSourceHeader: detected.popSourceHeader,
      pop: detected.pop,
      headers: edgeProbe.ok ? pickEdgeHeaders(edgeProbe.headers) : {},
    };
  } else if (mode === 'self' && req.headers['cf-ray']) {
    // The caller reached us through Cloudflare: their own ingress POP is in the inbound cf-ray header.
    const detected = detectEdgePop({ 'cf-ray': req.headers['cf-ray'] });
    edge = {
      kind: 'CLIENT_INGRESS',
      probed: false,
      url: null,
      ip: null,
      ok: true,
      status: null,
      error: null,
      durationMs: 0,
      provider: 'Cloudflare',
      popCode: detected.popCode,
      popSourceHeader: 'cf-ray (inbound)',
      pop: detected.pop,
      headers: { 'cf-ray': headerValue(req.headers, 'cf-ray') },
    };
  }

  const usesDbIp = [dbs.city, dbs.asn].some((db) => db?.source === 'DB-IP Lite');

  return {
    status: 200,
    body: {
      mode,
      query: parsed.empty ? null : String(rawTarget).trim(),
      hostname,
      isLocalClient,
      primary: records[0],
      ips: records,
      totalIps,
      resolved: mode === 'domain' ? { a: resolvedV4, aaaa: resolvedV6 } : null,
      skippedNonPublic,
      edge,
      databases: { city: describeDb(dbs.city), asn: describeDb(dbs.asn) },
      attribution: usesDbIp
        ? 'IP Geolocation by DB-IP (https://db-ip.com) — CC BY 4.0'
        : 'GeoLite2 data created by MaxMind (https://www.maxmind.com)',
      durationMs: Date.now() - startedAt,
    },
  };
}
