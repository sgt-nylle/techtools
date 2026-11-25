import type { ToolModule } from './types';
import { PassGenTool } from './PassGenTool';
import { SpeedTestTool } from './SpeedTestTool';
import { DnsTool } from './DnsTool';
import { UrlProbeTool } from './UrlProbeTool';
import { MyIpTool } from './MyIpTool';
import { CertAnalyzerTool } from './CertAnalyzerTool';
import { MailHeaderTool } from './MailHeaderTool';
import { MailTlsToolLazy } from './MailTlsToolLazy';
import { SubnetTool } from './SubnetTool';
import { AuthInspectorTool } from './AuthInspectorTool';
import { SecurityHeadersTool } from './SecurityHeadersTool';
import { GeoRadarToolLazy } from './GeoRadarToolLazy';

export const TOOL_MODULES: ToolModule[] = [
  {
    id: 'password-generator',
    code: 'MOD-01',
    title: 'PASSWORD & TOKEN GENERATOR',
    shortTitle: 'PASS & TOKENS',
    category: 'SECURITY',
    badge: 'CSPRNG • LOCAL',
    description:
      'Generate naval-grade passwords (64BIT & NO CONFUSE by default), multi-branch passphrases, UUIDs, Hex keys, and API tokens 100% locally in your browser — never on the server.',
    capabilities: ['64BIT (16) & NO CONFUSE Defaults', '100% Local CSPRNG (No Server)', 'Passphrases', 'UUID / Hex / API Keys'],
    Component: PassGenTool,
  },
  {
    id: 'speed-test',
    code: 'MOD-02',
    title: 'INTERNET SPEED NAVY TEST',
    shortTitle: 'SPEED TEST',
    category: 'NETWORK',
    badge: 'ISP • VU • Mbps',
    description:
      'Measure your real-world internet connection speed (download, upload, ping, and jitter) between your ISP and the wider internet via the nearest Anycast edge node, featuring an 80s cassette-deck digital VU meter.',
    capabilities: ['ISP & Internet Throughput', '80s Digital Peak VU Meter', '4-Stream Download & Upload', 'Live IP / ASN / Edge Telemetry'],
    Component: SpeedTestTool,
  },
  {
    id: 'geo-radar',
    code: 'MOD-03',
    title: 'IP & DOMAIN GEOLOCATION RADAR',
    shortTitle: 'GEO RADAR',
    category: 'NETWORK',
    badge: 'GEOIP • POP • RADAR',
    description:
      'Self-hosted GeoIP radar: plot your IP, any IPv4/IPv6 address, or every A/AAAA record of a domain on a zero-dependency SVG world map. Flags Anycast/CDN ASNs and detects the live CDN edge POP from cf-ray, x-amz-cf-pop and x-served-by headers.',
    capabilities: ['Local MMDB GeoIP (No 3rd Party)', 'City / ASN / Timezone', 'Anycast & CDN Edge POP', 'Animated SVG Radar Map'],
    Component: GeoRadarToolLazy,
  },
  {
    id: 'dns-inspector',
    code: 'MOD-04',
    title: 'DNS & DOMAIN REGISTRY INTEL',
    shortTitle: 'DNS & WHOIS',
    category: 'DNS & MAIL',
    badge: 'DNS • DNSSEC • WHOIS',
    description:
      'Interrogate authoritative DNS records (A, AAAA, CNAME, PTR, MX, NS, SOA, TXT, CAA), inspect DNSSEC zone keys (DNSKEY & DS chain of trust), validate SPF & DMARC mail security, and pull WHOIS domain registration records.',
    capabilities: ['Selectable DNS (Google/Cloudflare/Custom)', 'DNSSEC (DNSKEY & DS Chain)', 'SPF & DMARC Audit', 'Domain WHOIS Registry'],
    Component: DnsTool,
  },
  {
    id: 'url-tester',
    code: 'MOD-05',
    title: 'EXTERNAL ENDPOINT & TLS PROBE',
    shortTitle: 'URL TESTER',
    category: 'DIAGNOSTICS',
    badge: 'PING • URL • TLS',
    description:
      'Test external corporate URLs, ICMP sonar ping, and custom TCP ports (default 443) from outside internal firewalls. Inspect HTTP responses, redirect chains, and live SSL/TLS certificate details.',
    capabilities: ['Sonar ICMP Ping', 'WAN URL & Port (443)', 'HTTP Status & Redirects', 'Live SSL Cert & Chain'],
    Component: UrlProbeTool,
  },
  {
    id: 'whats-my-ip',
    code: 'MOD-06',
    title: "WHAT'S MY IP? & RANGE OWNER",
    shortTitle: "WHAT'S MY IP",
    category: 'NETWORK',
    badge: 'WAN • ASN • RIR',
    description:
      'Display your live client public IP address, reverse PTR hostname, routed BGP CIDR prefix, Autonomous System (ASN), and RIR IP block owner details.',
    capabilities: ['Client Public IP', 'ISP / Org & Netname', 'ASN & BGP Prefix', 'Any-IP Range Lookup'],
    Component: MyIpTool,
  },
  {
    id: 'cert-analyzer',
    code: 'MOD-07',
    title: 'CERTIFICATE & CSR ANALYZER',
    shortTitle: 'CERT ANALYZER',
    category: 'CRYPTO & SSL',
    badge: 'X.509 • CSR • TRUST',
    description:
      'Decode Base64 / PEM X.509 certificates, CSRs, and public keys. Inspect SAN names, server/client roles, expiration, trust store status, and export full certificate chains.',
    capabilities: ['X.509 / CSR / Public Key Detection', 'Subject & SAN Discovery', 'Trust Store Chain Verification', 'Private Key Intercept Guard'],
    Component: CertAnalyzerTool,
  },
  {
    id: 'mail-header-analyzer',
    code: 'MOD-08',
    title: 'EMAIL MESSAGE HEADER ANALYZER',
    shortTitle: 'MAIL HEADERS',
    category: 'MAIL SECURITY',
    badge: 'HOPS • SPF • DKIM',
    description:
      'Trace chronological mail transport hops, inspect relay delays and TLS ciphers, and audit SPF, DKIM, and DMARC authentication alignment.',
    capabilities: ['Message Transport Trace', 'Per-Hop Delay & TLS Ciphers', 'SPF / DKIM / DMARC Audit', 'Raw Header Explorer'],
    Component: MailHeaderTool,
  },
  {
    id: 'mail-tls',
    code: 'MOD-09',
    title: 'MAIL TLS TESTER (SMTP STARTTLS)',
    shortTitle: 'MAIL TLS TESTER',
    category: 'MAIL SECURITY',
    badge: 'MX • STARTTLS • CERT',
    description:
      'Resolve a domain\'s MX hosts and negotiate SMTP STARTTLS (or SMTPS) live in a streaming terminal. Reports whether a certificate is presented, self-signed vs. externally trusted, hostname match, expiry, protocol, cipher and key exchange, plus MTA-STS, TLS-RPT and DANE policy.',
    capabilities: ['Live SMTP / TLS Transcript', 'MX Priority Fan-Out (25 / 587 / 465)', 'Self-Signed vs. Trusted Cert', 'MTA-STS • TLS-RPT • DANE'],
    Component: MailTlsToolLazy,
  },
  {
    id: 'subnet-calculator',
    code: 'MOD-10',
    title: 'SUBNET & SUPERNETTING CALCULATOR',
    shortTitle: 'SUBNET CALC',
    category: 'NETWORK',
    badge: 'IPv4 • IPv6 • CIDR',
    description:
      '100% client-side IPv4/IPv6 CIDR subnet & supernetting calculator. Computes netmask, wildcard, network/broadcast, usable host ranges, bitwise binary, reverse DNS PTR (in-addr.arpa / ip6.arpa), and interactive subnet carving.',
    capabilities: ['IPv4 & IPv6 CIDR Math', 'Bitwise Binary View', 'in-addr.arpa & ip6.arpa PTR', 'Interactive Subnet Divider'],
    Component: SubnetTool,
  },
  {
    id: 'auth-inspector',
    code: 'MOD-11',
    title: 'JWT, OIDC & SAML AUTH INSPECTOR',
    shortTitle: 'JWT / SAML AUTH',
    category: 'SECURITY',
    badge: 'JWT • ENTRA • SAML',
    description:
      '100% client-side decoder for enterprise JWT, OIDC, and SAML 2.0 tokens. Converts iat/nbf/exp timestamps with live expiry badges, highlights Microsoft Entra ID claims (upn, oid, tid, roles, groups, wids), and formats Base64 SAML XML.',
    capabilities: ['100% Client-Side Token Decode', 'Live iat / nbf / exp Status', 'Entra ID / OIDC Claims', 'SAML 2.0 XML Formatter'],
    Component: AuthInspectorTool,
  },
  {
    id: 'security-headers',
    code: 'MOD-12',
    title: 'HTTP SECURITY HEADERS & CSP EVALUATOR',
    shortTitle: 'SEC HEADERS',
    category: 'SECURITY',
    badge: 'HSTS • CSP • SCORE',
    description:
      'Audit and score target URL HTTP security headers against OWASP & naval compliance baselines. Evaluates HSTS, CSP directives (warning on unsafe-inline, unsafe-eval, and wildcards), X-Frame-Options, nosniff, Referrer-Policy, and Permissions-Policy.',
    capabilities: ['HSTS & Max-Age Verification', 'CSP unsafe-inline/eval Audit', 'XFO / nosniff / Referrer / Permissions', 'Terminal PASS / WARN / FAIL Score'],
    Component: SecurityHeadersTool,
  },
];

export function getToolById(id: string | null | undefined): ToolModule | undefined {
  if (!id) return undefined;
  return TOOL_MODULES.find((t) => t.id === id);
}

export function getModuleBadgeNumber(mod: ToolModule): string {
  return mod.code.replace(/^MOD-/, '');
}
