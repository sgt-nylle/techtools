import type { ToolModule } from './types';
import { PassGenTool } from './PassGenTool';
import { DnsTool } from './DnsTool';
import { MyIpTool } from './MyIpTool';
import { CertAnalyzerTool } from './CertAnalyzerTool';
import { MailHeaderTool } from './MailHeaderTool';
import { UrlProbeTool } from './UrlProbeTool';

export const TOOL_MODULES: ToolModule[] = [
  {
    id: 'password-generator',
    code: 'MOD-01',
    shortcut: '1',
    title: 'PASSWORD & TOKEN GENERATOR',
    shortTitle: 'PASS & TOKENS',
    category: 'SECURITY',
    badge: 'CSPRNG • LOCAL',
    description:
      'Generate naval-grade passwords with custom complexity presets, memorable word passphrases, UUIDs, Hex keys, and JWT/API tokens strictly inside your browser.',
    capabilities: ['Complexity Presets', 'Entropy Meter', 'Passphrases', 'UUID / Hex / JWT / API Keys'],
    Component: PassGenTool,
  },
  {
    id: 'dns-inspector',
    code: 'MOD-02',
    shortcut: '2',
    title: 'DNS & DOMAIN REGISTRY INTEL',
    shortTitle: 'DNS & WHOIS',
    category: 'DNS & MAIL',
    badge: 'DNS • SPF • WHOIS',
    description:
      'Interrogate authoritative DNS records (A, AAAA, CNAME, PTR, MX, NS, SOA, TXT, CAA), validate SPF & DMARC mail security, and pull WHOIS domain registration records.',
    capabilities: ['Selectable DNS (Google/Cloudflare/Custom)', 'MX + Mail Server IPs', 'SPF & DMARC Audit', 'Domain WHOIS Registry'],
    Component: DnsTool,
  },
  {
    id: 'whats-my-ip',
    code: 'MOD-03',
    shortcut: '3',
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
    code: 'MOD-04',
    shortcut: '4',
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
    code: 'MOD-05',
    shortcut: '5',
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
    id: 'url-tester',
    code: 'MOD-06',
    shortcut: '6',
    title: 'EXTERNAL ENDPOINT & TLS PROBE',
    shortTitle: 'URL TESTER',
    category: 'DIAGNOSTICS',
    badge: 'PING • URL • TLS',
    description:
      'Test external corporate URLs, ICMP sonar ping, and custom TCP ports (default 443) from outside internal firewalls. Inspect HTTP responses, redirect chains, and live SSL/TLS certificate details.',
    capabilities: ['Sonar ICMP Ping', 'WAN URL & Port (443)', 'HTTP Status & Redirects', 'Live SSL Cert & Chain'],
    Component: UrlProbeTool,
  },
];

export function getToolById(id: string | null | undefined): ToolModule | undefined {
  if (!id) return undefined;
  return TOOL_MODULES.find((t) => t.id === id);
}
