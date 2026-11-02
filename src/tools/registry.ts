import type { ToolModule } from './types';
import { PassGenTool } from './PassGenTool';
import { DnsTool } from './DnsTool';
import { MyIpTool } from './MyIpTool';

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
    capabilities: ['IP (A / AAAA / PTR)', 'MX + Mail Server IPs', 'SPF & DMARC Audit', 'Domain WHOIS Registry'],
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
];

export function getToolById(id: string | null | undefined): ToolModule | undefined {
  if (!id) return undefined;
  return TOOL_MODULES.find((t) => t.id === id);
}
