import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { CopyableIntelSection } from '../components/CopyableIntelSection';
import { sound } from '../utils/audio';
import { useIsPaneActive } from '../utils/paneContext';

interface ChildSubnetBlock {
  index: number;
  cidr: string;
  networkAddress: string;
  broadcastOrLast: string;
  usableRange: string;
  totalCount: string;
  ptrZone: string;
}

interface SubnetResult {
  version: 'IPv4' | 'IPv6';
  rawInput: string;
  inputAddress: string;
  prefix: number;
  maxPrefix: number;
  cidrNotation: string;
  networkAddress: string;
  expandedNetworkAddress?: string;
  broadcastAddress: string;
  netmask: string;
  wildcardMask: string;
  firstUsable: string;
  lastUsable: string;
  usableRange: string;
  totalAddresses: string;
  usableHosts: string;
  scopeType: string;
  binaryAddress: string;
  binaryNetmask: string;
  binaryNetwork: string;
  binaryBroadcast: string;
  hostPtr: string;
  zonePtr: string;
  supernetParent: {
    prefix: number;
    cidr: string;
    range: string;
  } | null;
  baseNetworkBigInt: bigint;
}

const SAMPLE_CIDRS: Array<{ label: string; value: string }> = [
  { label: '10.120.4.0/22', value: '10.120.4.0/22' },
  { label: '192.168.10.25/24', value: '192.168.10.25/24' },
  { label: '172.16.0.0/16', value: '172.16.0.0/16' },
  { label: '100.64.0.0/10 (CGNAT)', value: '100.64.0.0/10' },
  { label: '2001:db8::/48', value: '2001:db8::/48' },
  { label: '2001:db8:85a3::8a2e:370:7334/64', value: '2001:db8:85a3::8a2e:370:7334/64' },
];

// ============================================================================
// IPv4 & IPv6 BIGINT MATH UTILITIES (100% Client-Side TypeScript)
// ============================================================================

function parseIpv4ToBigInt(ipStr: string): bigint | null {
  const parts = ipStr.trim().split('.');
  if (parts.length !== 4) return null;
  let acc = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    acc = (acc << 8n) | BigInt(n);
  }
  return acc;
}

function formatIpv4FromBigInt(val: bigint): string {
  const p1 = Number((val >> 24n) & 0xffn);
  const p2 = Number((val >> 16n) & 0xffn);
  const p3 = Number((val >> 8n) & 0xffn);
  const p4 = Number(val & 0xffn);
  return `${p1}.${p2}.${p3}.${p4}`;
}

function formatIpv4Binary(val: bigint): string {
  const octets: string[] = [];
  for (let shift = 24n; shift >= 0n; shift -= 8n) {
    const byte = Number((val >> shift) & 0xffn);
    octets.push(byte.toString(2).padStart(8, '0'));
  }
  return octets.join('.');
}

function parseIpv6ToBigInt(ipStr: string): bigint | null {
  let raw = ipStr.trim().toLowerCase();
  if (!raw || !raw.includes(':')) return null;

  // Handle IPv4-mapped trailing notation e.g. ::ffff:192.0.2.128
  const lastColon = raw.lastIndexOf(':');
  const tail = raw.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIpv4ToBigInt(tail);
    if (v4 === null) return null;
    const hi = Number((v4 >> 16n) & 0xffffn).toString(16);
    const lo = Number(v4 & 0xffffn).toString(16);
    raw = `${raw.slice(0, lastColon)}:${hi}:${lo}`;
  }

  const doubleColonParts = raw.split('::');
  if (doubleColonParts.length > 2) return null;

  let groups: string[] = [];
  if (doubleColonParts.length === 2) {
    const left = doubleColonParts[0] ? doubleColonParts[0].split(':') : [];
    const right = doubleColonParts[1] ? doubleColonParts[1].split(':') : [];
    const missing = 8 - (left.length + right.length);
    if (missing < 1) return null;
    groups = [...left, ...Array(missing).fill('0'), ...right];
  } else {
    groups = raw.split(':');
    if (groups.length !== 8) return null;
  }

  let acc = 0n;
  for (const grp of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(grp)) return null;
    acc = (acc << 16n) | BigInt(parseInt(grp, 16));
  }
  return acc;
}

function formatIpv6Expanded(val: bigint): string {
  const hextets: string[] = [];
  for (let i = 7; i >= 0; i--) {
    const word = Number((val >> BigInt(i * 16)) & 0xffffn);
    hextets.push(word.toString(16).padStart(4, '0'));
  }
  return hextets.join(':');
}

function formatIpv6Compressed(val: bigint): string {
  const words: number[] = [];
  for (let i = 7; i >= 0; i--) {
    words.push(Number((val >> BigInt(i * 16)) & 0xffffn));
  }

  // RFC 5952 longest zero-run compression
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;

  for (let i = 0; i < 8; i++) {
    if (words[i] === 0) {
      if (curStart === -1) {
        curStart = i;
        curLen = 1;
      } else {
        curLen++;
      }
      if (curLen > bestLen && curLen >= 2) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }

  if (bestStart === -1) {
    return words.map((w) => w.toString(16)).join(':');
  }

  const left = words
    .slice(0, bestStart)
    .map((w) => w.toString(16))
    .join(':');
  const right = words
    .slice(bestStart + bestLen)
    .map((w) => w.toString(16))
    .join(':');
  return `${left}::${right}`;
}

function formatIpv6Binary(val: bigint): string {
  const hextets: string[] = [];
  for (let i = 7; i >= 0; i--) {
    const word = Number((val >> BigInt(i * 16)) & 0xffffn);
    hextets.push(word.toString(2).padStart(16, '0'));
  }
  return hextets.join(':');
}

function formatBigCount(n: bigint): string {
  const s = n.toString(10);
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function classifyIpv4Scope(ipVal: bigint): string {
  const a = Number((ipVal >> 24n) & 0xffn);
  const b = Number((ipVal >> 16n) & 0xffn);
  const c = Number((ipVal >> 8n) & 0xffn);

  if (a === 10) return 'RFC 1918 Private Network (Class A / 10.0.0.0/8)';
  if (a === 172 && b >= 16 && b <= 31) return 'RFC 1918 Private Network (172.16.0.0/12)';
  if (a === 192 && b === 168) return 'RFC 1918 Private Network (192.168.0.0/16)';
  if (a === 100 && b >= 64 && b <= 127) return 'RFC 6598 Carrier-Grade NAT (CGNAT 100.64.0.0/10)';
  if (a === 127) return 'RFC 1122 Loopback (127.0.0.0/8)';
  if (a === 169 && b === 254) return 'RFC 3927 Link-Local / APIPA (169.254.0.0/16)';
  if (a === 192 && b === 0 && c === 2) return 'RFC 5737 Documentation (TEST-NET-1)';
  if (a === 198 && b === 51 && c === 100) return 'RFC 5737 Documentation (TEST-NET-2)';
  if (a === 203 && b === 0 && c === 113) return 'RFC 5737 Documentation (TEST-NET-3)';
  if (a >= 224 && a <= 239) return 'RFC 5771 Multicast (224.0.0.0/4)';
  if (a >= 240) return 'Reserved / Future Use (240.0.0.0/4)';
  return 'Global Unicast Public IPv4';
}

function classifyIpv6Scope(ipVal: bigint): string {
  if (ipVal === 0n) return 'Unspecified Address (::/128)';
  if (ipVal === 1n) return 'Loopback Address (::1/128)';
  const firstWord = Number((ipVal >> 112n) & 0xffffn);
  const secondWord = Number((ipVal >> 96n) & 0xffffn);
  if (firstWord === 0x2001 && secondWord === 0x0db8) return 'RFC 3849 Documentation Prefix (2001:db8::/32)';
  if ((firstWord & 0xfe00) === 0xfc00) return 'RFC 4193 Unique Local Address (ULA fc00::/7)';
  if ((firstWord & 0xffc0) === 0xfe80) return 'RFC 4291 Link-Local Unicast (fe80::/10)';
  if ((firstWord & 0xff00) === 0xff00) return 'RFC 4291 Multicast (ff00::/8)';
  if ((firstWord & 0xe000) === 0x2000) return 'Global Unicast IPv6 (2000::/3)';
  return 'IPv6 Unicast / Reserved Block';
}

function computeIpv4ZonePtr(networkVal: bigint, prefix: number): string {
  const o1 = Number((networkVal >> 24n) & 0xffn);
  const o2 = Number((networkVal >> 16n) & 0xffn);
  const o3 = Number((networkVal >> 8n) & 0xffn);
  const o4 = Number(networkVal & 0xffn);

  if (prefix >= 32) return `${o4}.${o3}.${o2}.${o1}.in-addr.arpa.`;
  if (prefix >= 24) {
    if (prefix === 24) return `${o3}.${o2}.${o1}.in-addr.arpa.`;
    return `${o4}/${prefix}.${o3}.${o2}.${o1}.in-addr.arpa. (RFC 2317 Classless in-addr.arpa)`;
  }
  if (prefix >= 16) return `${o2}.${o1}.in-addr.arpa.`;
  if (prefix >= 8) return `${o1}.in-addr.arpa.`;
  return 'in-addr.arpa.';
}

function computeIpv6NibblePtr(ipVal: bigint, prefix: number, isZone: boolean): string {
  const hex32 = ipVal.toString(16).padStart(32, '0');
  const nibbles = hex32.split('');
  if (!isZone) {
    return `${[...nibbles].reverse().join('.')}.ip6.arpa.`;
  }
  const nibbleCount = Math.floor(prefix / 4);
  if (nibbleCount <= 0) return 'ip6.arpa.';
  const relevant = nibbles.slice(0, nibbleCount).reverse().join('.');
  return `${relevant}.ip6.arpa.`;
}

function calculateSubnet(rawInput: string): { result?: SubnetResult; error?: string } {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { error: 'Enter an IPv4 or IPv6 CIDR block (e.g. 10.120.4.0/22 or 2001:db8::/48).' };
  }

  const slashParts = trimmed.split('/');
  if (slashParts.length > 2) {
    return { error: 'Invalid CIDR format. Use <address>/<prefix> (e.g. 10.120.4.0/22 or 2001:db8::/48).' };
  }

  const addrPart = slashParts[0].trim();
  const isV6 = addrPart.includes(':');

  if (!isV6) {
    const ipVal = parseIpv4ToBigInt(addrPart);
    if (ipVal === null) {
      return { error: `Invalid IPv4 address "${addrPart}". Expected 4 octets (0–255), e.g. 10.120.4.0/22.` };
    }
    const prefix = slashParts[1] !== undefined && slashParts[1].trim() !== '' ? Number(slashParts[1].trim()) : 24;
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
      return { error: 'IPv4 CIDR prefix length must be an integer between /0 and /32.' };
    }

    const allOnes = 0xffffffffn;
    const hostBits = BigInt(32 - prefix);
    const maskVal = prefix === 0 ? 0n : (allOnes << hostBits) & allOnes;
    const wildcardVal = (~maskVal) & allOnes;
    const netVal = ipVal & maskVal;
    const bcastVal = netVal | wildcardVal;
    const totalCount = 1n << hostBits;

    let firstUsableVal = netVal;
    let lastUsableVal = bcastVal;
    let usableCount = totalCount;

    if (prefix <= 30) {
      firstUsableVal = netVal + 1n;
      lastUsableVal = bcastVal - 1n;
      usableCount = totalCount - 2n;
    } else if (prefix === 31) {
      // RFC 3021 point-to-point link
      firstUsableVal = netVal;
      lastUsableVal = bcastVal;
      usableCount = 2n;
    } else {
      // /32 host route
      firstUsableVal = netVal;
      lastUsableVal = netVal;
      usableCount = 1n;
    }

    const netStr = formatIpv4FromBigInt(netVal);
    const bcastStr = formatIpv4FromBigInt(bcastVal);
    const firstStr = formatIpv4FromBigInt(firstUsableVal);
    const lastStr = formatIpv4FromBigInt(lastUsableVal);

    const o1 = Number((ipVal >> 24n) & 0xffn);
    const o2 = Number((ipVal >> 16n) & 0xffn);
    const o3 = Number((ipVal >> 8n) & 0xffn);
    const o4 = Number(ipVal & 0xffn);
    const hostPtr = `${o4}.${o3}.${o2}.${o1}.in-addr.arpa.`;
    const zonePtr = computeIpv4ZonePtr(netVal, prefix);

    let supernetParent: SubnetResult['supernetParent'] = null;
    if (prefix > 0) {
      const parentPrefix = prefix - 1;
      const parentHostBits = BigInt(32 - parentPrefix);
      const parentMask = parentPrefix === 0 ? 0n : (allOnes << parentHostBits) & allOnes;
      const parentNet = netVal & parentMask;
      const parentBcast = parentNet | ((~parentMask) & allOnes);
      supernetParent = {
        prefix: parentPrefix,
        cidr: `${formatIpv4FromBigInt(parentNet)}/${parentPrefix}`,
        range: `${formatIpv4FromBigInt(parentNet)} – ${formatIpv4FromBigInt(parentBcast)}`,
      };
    }

    return {
      result: {
        version: 'IPv4',
        rawInput: trimmed,
        inputAddress: formatIpv4FromBigInt(ipVal),
        prefix,
        maxPrefix: 32,
        cidrNotation: `${netStr}/${prefix}`,
        networkAddress: netStr,
        broadcastAddress: bcastStr,
        netmask: `${formatIpv4FromBigInt(maskVal)} (/${prefix})`,
        wildcardMask: formatIpv4FromBigInt(wildcardVal),
        firstUsable: firstStr,
        lastUsable: lastStr,
        usableRange:
          prefix === 32
            ? `${firstStr} (Single /32 Host Route)`
            : prefix === 31
            ? `${firstStr} – ${lastStr} (RFC 3021 PtP)`
            : `${firstStr} – ${lastStr}`,
        totalAddresses: formatBigCount(totalCount),
        usableHosts: formatBigCount(usableCount),
        scopeType: classifyIpv4Scope(netVal),
        binaryAddress: formatIpv4Binary(ipVal),
        binaryNetmask: formatIpv4Binary(maskVal),
        binaryNetwork: formatIpv4Binary(netVal),
        binaryBroadcast: formatIpv4Binary(bcastVal),
        hostPtr,
        zonePtr,
        supernetParent,
        baseNetworkBigInt: netVal,
      },
    };
  }

  // IPv6 calculation
  const ipVal = parseIpv6ToBigInt(addrPart);
  if (ipVal === null) {
    return { error: `Invalid IPv6 address "${addrPart}". Example: 2001:db8::/48.` };
  }
  const prefix = slashParts[1] !== undefined && slashParts[1].trim() !== '' ? Number(slashParts[1].trim()) : 64;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) {
    return { error: 'IPv6 CIDR prefix length must be an integer between /0 and /128.' };
  }

  const allOnes = (1n << 128n) - 1n;
  const hostBits = BigInt(128 - prefix);
  const maskVal = prefix === 0 ? 0n : (allOnes << hostBits) & allOnes;
  const wildcardVal = (~maskVal) & allOnes;
  const netVal = ipVal & maskVal;
  const lastVal = netVal | wildcardVal;
  const totalCount = 1n << hostBits;

  const netCompressed = formatIpv6Compressed(netVal);
  const netExpanded = formatIpv6Expanded(netVal);
  const lastCompressed = formatIpv6Compressed(lastVal);

  let totalStr = formatBigCount(totalCount);
  if (hostBits >= 64n) {
    const subnets64 = 1n << (hostBits - 64n);
    totalStr = `2^${hostBits.toString()} (${formatBigCount(subnets64)} × /64 networks)`;
  }

  let supernetParent: SubnetResult['supernetParent'] = null;
  if (prefix > 0) {
    const parentPrefix = prefix - 1;
    const parentHostBits = BigInt(128 - parentPrefix);
    const parentMask = parentPrefix === 0 ? 0n : (allOnes << parentHostBits) & allOnes;
    const parentNet = netVal & parentMask;
    const parentLast = parentNet | ((~parentMask) & allOnes);
    supernetParent = {
      prefix: parentPrefix,
      cidr: `${formatIpv6Compressed(parentNet)}/${parentPrefix}`,
      range: `${formatIpv6Compressed(parentNet)} – ${formatIpv6Compressed(parentLast)}`,
    };
  }

  return {
    result: {
      version: 'IPv6',
      rawInput: trimmed,
      inputAddress: formatIpv6Compressed(ipVal),
      prefix,
      maxPrefix: 128,
      cidrNotation: `${netCompressed}/${prefix}`,
      networkAddress: netCompressed,
      expandedNetworkAddress: netExpanded,
      broadcastAddress: `${lastCompressed} (Last Address — IPv6 uses Multicast)`,
      netmask: `${formatIpv6Compressed(maskVal)} (/${prefix})`,
      wildcardMask: formatIpv6Compressed(wildcardVal),
      firstUsable: netCompressed,
      lastUsable: lastCompressed,
      usableRange: `${netCompressed} – ${lastCompressed}`,
      totalAddresses: totalStr,
      usableHosts: prefix === 128 ? '1 (Single /128 Host)' : totalStr,
      scopeType: classifyIpv6Scope(netVal),
      binaryAddress: formatIpv6Binary(ipVal),
      binaryNetmask: formatIpv6Binary(maskVal),
      binaryNetwork: formatIpv6Binary(netVal),
      binaryBroadcast: formatIpv6Binary(lastVal),
      hostPtr: computeIpv6NibblePtr(ipVal, prefix, false),
      zonePtr: computeIpv6NibblePtr(netVal, prefix, true),
      supernetParent,
      baseNetworkBigInt: netVal,
    },
  };
}

function buildChildSubnets(info: SubnetResult, splitSteps: number): ChildSubnetBlock[] {
  const newPrefix = Math.min(info.maxPrefix, info.prefix + splitSteps);
  const actualSteps = newPrefix - info.prefix;
  if (actualSteps <= 0) return [];

  const totalSubnets = 1 << actualSteps;
  const displayCap = Math.min(totalSubnets, 64);
  const childHostBits = BigInt(info.maxPrefix - newPrefix);
  const blockSize = 1n << childHostBits;
  const blocks: ChildSubnetBlock[] = [];

  for (let i = 0; i < displayCap; i++) {
    const startVal = info.baseNetworkBigInt + BigInt(i) * blockSize;
    const endVal = startVal + blockSize - 1n;

    if (info.version === 'IPv4') {
      const startStr = formatIpv4FromBigInt(startVal);
      const endStr = formatIpv4FromBigInt(endVal);
      const firstHost = newPrefix <= 30 ? formatIpv4FromBigInt(startVal + 1n) : startStr;
      const lastHost = newPrefix <= 30 ? formatIpv4FromBigInt(endVal - 1n) : endStr;
      const usableCount = newPrefix <= 30 ? blockSize - 2n : blockSize;

      blocks.push({
        index: i + 1,
        cidr: `${startStr}/${newPrefix}`,
        networkAddress: startStr,
        broadcastOrLast: endStr,
        usableRange: `${firstHost} – ${lastHost}`,
        totalCount: `${formatBigCount(usableCount)} hosts`,
        ptrZone: computeIpv4ZonePtr(startVal, newPrefix),
      });
    } else {
      const startStr = formatIpv6Compressed(startVal);
      const endStr = formatIpv6Compressed(endVal);
      blocks.push({
        index: i + 1,
        cidr: `${startStr}/${newPrefix}`,
        networkAddress: startStr,
        broadcastOrLast: endStr,
        usableRange: `${startStr} – ${endStr}`,
        totalCount: childHostBits >= 64n ? `${formatBigCount(1n << (childHostBits - 64n))} × /64` : `2^${childHostBits.toString()}`,
        ptrZone: computeIpv6NibblePtr(startVal, newPrefix, true),
      });
    }
  }

  return blocks;
}

export const SubnetTool: React.FC = () => {
  const isPaneActive = useIsPaneActive();
  const [cidrInput, setCidrInput] = useState<string>('10.120.4.0/22');
  const [splitSteps, setSplitSteps] = useState<number>(2);
  const [showBinary, setShowBinary] = useState<boolean>(true);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const { result: data, error } = useMemo(() => calculateSubnet(cidrInput), [cidrInput]);

  const maxExtraBits = useMemo(() => {
    if (!data) return 0;
    const remaining = data.maxPrefix - data.prefix;
    return Math.min(remaining, 6); // Up to 64 child subnets in interactive divider
  }, [data]);

  const effectiveSplitSteps = Math.min(splitSteps, maxExtraBits);

  const childSubnets = useMemo(() => {
    if (!data || effectiveSplitSteps <= 0) return [];
    return buildChildSubnets(data, effectiveSplitSteps);
  }, [data, effectiveSplitSteps]);

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

  const stepPrefix = useCallback(
    (delta: number) => {
      if (!data) return;
      const nextPrefix = Math.max(0, Math.min(data.maxPrefix, data.prefix + delta));
      if (nextPrefix === data.prefix) return;
      sound.playClick();
      setCidrInput(`${data.inputAddress}/${nextPrefix}`);
    },
    [data]
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
      } else if (k === '-') {
        e.preventDefault();
        stepPrefix(-1);
      } else if (k === '+' || k === '=') {
        e.preventDefault();
        stepPrefix(1);
      } else if (k === 'b') {
        e.preventDefault();
        sound.playClick();
        setShowBinary((v) => !v);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPaneActive, stepPrefix]);

  const sectionPayloads = useMemo(() => {
    if (!data) return { summary: '', ptr: '', binary: '', split: '' };

    const summaryLines = [
      `=== SUBNET & SUPERNETTING TELEMETRY (${data.cidrNotation}) ===`,
      `Protocol: ${data.version} (${data.scopeType})`,
      `Input Address: ${data.inputAddress}/${data.prefix}`,
      `Canonical CIDR Block: ${data.cidrNotation}`,
      `Network Address: ${data.networkAddress}${data.expandedNetworkAddress ? ` (${data.expandedNetworkAddress})` : ''}`,
      `Netmask: ${data.netmask}`,
      `Wildcard Mask: ${data.wildcardMask}`,
      `Broadcast / Last Address: ${data.broadcastAddress}`,
      `Usable Host Range: ${data.usableRange}`,
      `Total Usable Hosts: ${data.usableHosts} (Total Addresses: ${data.totalAddresses})`,
    ];
    if (data.supernetParent) {
      summaryLines.push(`Parent Supernet (-1 bit): ${data.supernetParent.cidr} (${data.supernetParent.range})`);
    }

    const ptrLines = [
      `=== REVERSE DNS PTR GENERATOR (${data.cidrNotation}) ===`,
      `Zone Reverse Delegation: ${data.zonePtr}`,
      `Input Host PTR Record: ${data.hostPtr}`,
    ];

    const binaryLines = [
      `=== BITWISE BINARY REPRESENTATION (${data.cidrNotation}) ===`,
      `Address  : ${data.binaryAddress}`,
      `Netmask  : ${data.binaryNetmask}`,
      `Network  : ${data.binaryNetwork}`,
      `Broadcast: ${data.binaryBroadcast}`,
    ];

    const targetSplitPrefix = data.prefix + effectiveSplitSteps;
    const splitLines = [
      `=== SUBNET DIVIDER: ${data.cidrNotation} -> /${targetSplitPrefix} (${1 << effectiveSplitSteps} blocks) ===`,
      ...childSubnets.map(
        (b) => `#${b.index}: ${b.cidr.padEnd(18, ' ')} | Range: ${b.usableRange} | ${b.totalCount} | PTR: ${b.ptrZone}`
      ),
    ];

    return {
      summary: summaryLines.join('\n'),
      ptr: ptrLines.join('\n'),
      binary: binaryLines.join('\n'),
      split: splitLines.join('\n'),
    };
  }, [data, effectiveSplitSteps, childSubnets]);

  return (
    <div className="tool-panel">
      {/* CIDR INPUT & SUPERNET / SUBNET PREFIX STEPPER */}
      <form
        className="query-bar c64-box"
        onSubmit={(e) => {
          e.preventDefault();
          sound.playBlip();
        }}
      >
        <div className="query-input-group">
          <span className="prompt-chevron" title="Press [Q] to focus CIDR input">
            CIDR [Q]&gt;
          </span>
          <input
            ref={inputRef}
            type="text"
            value={cidrInput}
            onChange={(e) => setCidrInput(e.target.value)}
            placeholder="e.g. 10.120.4.0/22 or 2001:db8::/48 (ESC unlocks shortcuts)"
            className="navy-input"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <button
            type="button"
            className="navy-btn btn-sm"
            onClick={() => stepPrefix(-1)}
            title="Supernet: Widen prefix by 1 bit [-]"
          >
            ◄ SUPERNET /{(data ? Math.max(0, data.prefix - 1) : 23)} [-]
          </button>
          <button
            type="button"
            className="navy-btn btn-sm"
            onClick={() => stepPrefix(1)}
            title="Subnet: Narrow prefix by 1 bit [+]"
          >
            SUBNET /{(data ? Math.min(data.maxPrefix, data.prefix + 1) : 25)} [+] ►
          </button>
        </div>

        <div className="quick-samples-row">
          <span className="quick-lbl">PRESET BLOCKS:</span>
          {SAMPLE_CIDRS.map((sample) => (
            <button
              key={sample.value}
              type="button"
              className={`navy-chip-btn ${cidrInput.trim() === sample.value ? 'chip-active' : ''}`}
              onClick={() => {
                sound.playClick();
                setCidrInput(sample.value);
              }}
            >
              {sample.label}
            </button>
          ))}
        </div>
      </form>

      {error && <div className="alert-banner status-err c64-box">⚠ {error}</div>}

      {data && (
        <>
          {/* TELEMETRY STRIP */}
          <div className="telemetry-strip c64-box">
            <div className="tele-cell">
              <span className="tele-lbl">CANONICAL CIDR</span>
              <span className="tele-val text-gold">{data.cidrNotation}</span>
            </div>
            <div className="tele-cell">
              <span className="tele-lbl">NETMASK</span>
              <span className="tele-val text-cyan">{data.netmask}</span>
            </div>
            <div className="tele-cell">
              <span className="tele-lbl">USABLE HOSTS</span>
              <span className="tele-val status-ok">{data.usableHosts}</span>
            </div>
            <div className="tele-cell">
              <span className="tele-lbl">REVERSE DNS ZONE</span>
              <span className="tele-val text-gold">{data.zonePtr}</span>
            </div>
          </div>

          {/* 1. CORE SUBNET & SUPERNETTING PARAMETERS */}
          <CopyableIntelSection
            title={`► ${data.version} SUBNET & SUPERNETTING PARAMETERS`}
            badge={data.scopeType}
            copyPayload={sectionPayloads.summary}
          >
            <div className="whois-grid">
              <div className="whois-item">
                <span className="tele-lbl">NETWORK ADDRESS</span>
                <span className="tele-val text-gold code-wrap-inline">{data.networkAddress}</span>
              </div>
              <div className="whois-item">
                <span className="tele-lbl">BROADCAST / LAST ADDRESS</span>
                <span className="tele-val text-cyan code-wrap-inline">{data.broadcastAddress}</span>
              </div>
              <div className="whois-item">
                <span className="tele-lbl">NETMASK</span>
                <span className="tele-val code-wrap-inline">{data.netmask}</span>
              </div>
              <div className="whois-item">
                <span className="tele-lbl">WILDCARD MASK (ACL / OSPF)</span>
                <span className="tele-val text-cyan code-wrap-inline">{data.wildcardMask}</span>
              </div>
              <div className="whois-item">
                <span className="tele-lbl">USABLE HOST RANGE</span>
                <span className="tele-val text-gold code-wrap-inline">{data.usableRange}</span>
              </div>
              <div className="whois-item">
                <span className="tele-lbl">TOTAL USABLE HOSTS</span>
                <span className="tele-val status-ok">{data.usableHosts}</span>
              </div>
              {data.expandedNetworkAddress && (
                <div className="whois-item">
                  <span className="tele-lbl">FULL EXPANDED IPv6</span>
                  <span className="tele-val code-wrap-inline">{data.expandedNetworkAddress}</span>
                </div>
              )}
              {data.supernetParent && (
                <div className="whois-item">
                  <span className="tele-lbl">SUPERNET PARENT (-1 BIT)</span>
                  <div className="kv-row">
                    <code className="text-cyan">{data.supernetParent.cidr}</code>
                    <button
                      type="button"
                      className="navy-btn btn-xs"
                      onClick={() => {
                        sound.playBlip();
                        setCidrInput(data.supernetParent!.cidr);
                      }}
                    >
                      JUMP TO /{data.supernetParent.prefix}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </CopyableIntelSection>

          {/* 2. REVERSE DNS PTR GENERATOR */}
          <CopyableIntelSection
            title="► REVERSE DNS PTR GENERATOR (in-addr.arpa / ip6.arpa)"
            badge={data.version === 'IPv4' ? 'IN-ADDR.ARPA' : 'NIBBLE IP6.ARPA'}
            copyPayload={sectionPayloads.ptr}
          >
            <div className="horizontal-tiles-list">
              {[
                {
                  key: 'ptr-zone',
                  label: 'ZONE DELEGATION',
                  title: `REVERSE DNS ZONE (/${data.prefix})`,
                  val: data.zonePtr,
                  highlight: 'text-gold',
                },
                {
                  key: 'ptr-host',
                  label: 'HOST PTR RECORD',
                  title: `EXACT IP REVERSE PTR (${data.inputAddress})`,
                  val: data.hostPtr,
                  highlight: 'text-cyan',
                },
              ].map((item) => (
                <div
                  key={item.key}
                  tabIndex={0}
                  className={`nav-tile focusable-row ${copiedKey === item.key ? 'row-copied' : ''}`}
                  onClick={() => void copyValue(item.val, item.key)}
                  onKeyDown={(e) => {
                    if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'c' || e.key === 'C' || e.key === 'Enter')) {
                      e.preventDefault();
                      e.stopPropagation();
                      void copyValue(item.val, item.key);
                    }
                  }}
                >
                  <div className="tile-badge-col">
                    <span className="tile-hdr-badge">{item.label}</span>
                  </div>
                  <div className="tile-content-col">
                    <span className="tile-title-line">{item.title}</span>
                    <code className={`tile-main-val code-wrap-inline ${item.highlight}`}>{item.val}</code>
                  </div>
                  <div className="tile-action-col">
                    <button
                      type="button"
                      tabIndex={-1}
                      className={`navy-btn btn-xs ${copiedKey === item.key ? 'btn-copied' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void copyValue(item.val, item.key);
                      }}
                    >
                      {copiedKey === item.key ? '✓ COPIED' : 'COPY [C]'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </CopyableIntelSection>

          {/* 3. BINARY BITWISE REPRESENTATION */}
          <CopyableIntelSection
            title="► BITWISE BINARY REPRESENTATION (NETWORK VS HOST BITS)"
            badge={`${data.prefix} NET BITS / ${data.maxPrefix - data.prefix} HOST BITS`}
            copyPayload={sectionPayloads.binary}
          >
            <div className="section-title-row">
              <span className="dim-note">
                Network prefix bits (<code>/{data.prefix}</code>) and host bits visualized in binary:
              </span>
              <button
                type="button"
                className="navy-btn btn-xs"
                onClick={() => {
                  sound.playClick();
                  setShowBinary((v) => !v);
                }}
              >
                {showBinary ? '▼ HIDE BINARY [B]' : '► SHOW BINARY [B]'}
              </button>
            </div>

            {showBinary && (
              <div className="subnet-binary-table">
                {[
                  { label: 'INPUT IP ', val: data.binaryAddress, cls: 'text-white' },
                  { label: 'NETMASK  ', val: data.binaryNetmask, cls: 'text-cyan' },
                  { label: 'NETWORK  ', val: data.binaryNetwork, cls: 'text-gold' },
                  { label: 'BROADCAST', val: data.binaryBroadcast, cls: 'status-ok' },
                ].map((row) => (
                  <div key={row.label} className="subnet-binary-row">
                    <span className="subnet-binary-lbl">{row.label}</span>
                    <code className={`subnet-binary-code ${row.cls}`}>{row.val}</code>
                  </div>
                ))}
              </div>
            )}
          </CopyableIntelSection>

          {/* 4. SUBNET DIVIDER / VISUALIZER */}
          <CopyableIntelSection
            title="► SUBNET DIVIDER & CARVING VISUALIZER"
            badge={
              maxExtraBits > 0
                ? `${1 << effectiveSplitSteps} × /${data.prefix + effectiveSplitSteps} SUBNETS`
                : 'MAX PREFIX REACHED'
            }
            copyPayload={sectionPayloads.split}
          >
            {maxExtraBits === 0 ? (
              <div className="dim-note">
                Prefix <code>/{data.prefix}</code> is already a single host route and cannot be subdivided further.
                Click <strong>SUPERNET [-]</strong> above to widen the prefix.
              </div>
            ) : (
              <>
                <div className="subnet-divider-controls">
                  <div className="slider-block">
                    <label htmlFor="subnet-split-slider">
                      SPLIT <strong className="text-gold">{data.cidrNotation}</strong> INTO:{' '}
                      <strong className="text-cyan">
                        {1 << effectiveSplitSteps} × /{data.prefix + effectiveSplitSteps} BLOCKS
                      </strong>{' '}
                      (+{effectiveSplitSteps} bit{effectiveSplitSteps === 1 ? '' : 's'})
                    </label>
                    <div className="range-row">
                      <input
                        id="subnet-split-slider"
                        type="range"
                        min={1}
                        max={maxExtraBits}
                        value={effectiveSplitSteps}
                        onChange={(e) => {
                          sound.playClick();
                          setSplitSteps(Number(e.target.value));
                        }}
                      />
                    </div>
                  </div>

                  <div className="preset-buttons">
                    {Array.from({ length: maxExtraBits }, (_, i) => i + 1).map((step) => {
                      const targetPfx = data.prefix + step;
                      const count = 1 << step;
                      return (
                        <button
                          key={step}
                          type="button"
                          className={`navy-btn btn-xs ${effectiveSplitSteps === step ? 'btn-active' : ''}`}
                          onClick={() => {
                            sound.playClick();
                            setSplitSteps(step);
                          }}
                        >
                          {count}× /{targetPfx}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* PROPORTIONAL VISUAL BLOCK BAR */}
                <div className="subnet-visual-bar" aria-label="Subnet allocation visualizer">
                  {childSubnets.slice(0, 16).map((b) => (
                    <button
                      key={b.cidr}
                      type="button"
                      className="subnet-visual-segment"
                      title={`Click to inspect ${b.cidr} (${b.usableRange})`}
                      onClick={() => {
                        sound.playBlip();
                        setCidrInput(b.cidr);
                      }}
                    >
                      <span className="seg-cidr">{b.cidr}</span>
                    </button>
                  ))}
                </div>

                {/* SUBNET BREAKDOWN TABLE */}
                <div className="horizontal-tiles-list mt-8">
                  {childSubnets.map((block) => {
                    const rowKey = `sub-${block.index}`;
                    return (
                      <div
                        key={block.cidr}
                        tabIndex={0}
                        className={`nav-tile focusable-row ${copiedKey === rowKey ? 'row-copied' : ''}`}
                        onClick={() => void copyValue(block.cidr, rowKey)}
                        onKeyDown={(e) => {
                          if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'c' || e.key === 'C' || e.key === 'Enter')) {
                            e.preventDefault();
                            e.stopPropagation();
                            void copyValue(block.cidr, rowKey);
                          }
                        }}
                      >
                        <div className="tile-badge-col">
                          <span className="hop-badge">#{block.index}</span>
                          <span className="auth-status-pill text-cyan">{block.totalCount}</span>
                        </div>
                        <div className="tile-content-col">
                          <div className="hop-route-line">
                            <code className="text-gold">{block.cidr}</code>
                            {' • '}
                            <span className="text-cyan">Range:</span> <code>{block.usableRange}</code>
                          </div>
                          <div className="hop-meta-line">
                            <span>
                              Bcast/Last: <code>{block.broadcastOrLast}</code>
                            </span>
                            <span>
                              PTR: <code>{block.ptrZone}</code>
                            </span>
                          </div>
                        </div>
                        <div className="tile-action-col">
                          <button
                            type="button"
                            tabIndex={-1}
                            className="navy-btn btn-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              sound.playBlip();
                              setCidrInput(block.cidr);
                            }}
                            title="Drill into this subnet"
                          >
                            DRILL ►
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </CopyableIntelSection>
        </>
      )}
    </div>
  );
};

export default SubnetTool;
