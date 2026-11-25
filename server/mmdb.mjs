/**
 * Minimal, zero-dependency MaxMind DB (.mmdb) reader.
 *
 * Implements the MaxMind DB File Format Spec v2.0 (binary search tree + data section decoder)
 * for in-memory, sub-millisecond lookups against GeoLite2 / DB-IP Lite City & ASN databases.
 * Spec: https://maxmind.github.io/MaxMind-DB/
 */
import net from 'node:net';

const METADATA_MARKER = Buffer.concat([Buffer.from([0xab, 0xcd, 0xef]), Buffer.from('MaxMind.com', 'ascii')]);
const DATA_SECTION_SEPARATOR_SIZE = 16;
const DECODE_CACHE_LIMIT = 8000;

/** Parse an IPv4 / IPv6 literal into network-order bytes. Returns null for non-IP input. */
export function parseIpToBytes(ip) {
  const ver = net.isIP(ip);
  if (ver === 4) {
    return { bytes: Uint8Array.from(ip.split('.').map(Number)), version: 4 };
  }
  if (ver !== 6) return null;

  let s = ip.toLowerCase();
  const zoneIdx = s.indexOf('%');
  if (zoneIdx >= 0) s = s.slice(0, zoneIdx);

  // Embedded IPv4 tail (e.g. ::ffff:192.0.2.1) -> two hextets
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    const o = tail.split('.').map(Number);
    s = `${s.slice(0, lastColon + 1)}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }

  const [head, rest] = s.split('::');
  const headParts = head ? head.split(':') : [];
  let groups = headParts;
  if (rest !== undefined) {
    const restParts = rest ? rest.split(':') : [];
    groups = [...headParts, ...Array(8 - headParts.length - restParts.length).fill('0'), ...restParts];
  }

  const bytes = new Uint8Array(16);
  groups.forEach((g, i) => {
    const v = parseInt(g || '0', 16);
    bytes[i * 2] = (v >> 8) & 0xff;
    bytes[i * 2 + 1] = v & 0xff;
  });
  return { bytes, version: 6 };
}

function formatIpv6(bytes) {
  const groups = [];
  for (let i = 0; i < 16; i += 2) groups.push((bytes[i] << 8) | bytes[i + 1]);

  // RFC 5952: compress the longest run (>= 2) of zero groups.
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j += 1;
    if (j - i > bestLen && j - i >= 2) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }

  const hex = groups.map((g) => g.toString(16));
  if (bestStart < 0) return hex.join(':');
  const left = hex.slice(0, bestStart).join(':');
  const right = hex.slice(bestStart + bestLen).join(':');
  return `${left}::${right}`;
}

/** Network CIDR (e.g. "104.16.0.0/13") containing `ip` for a given prefix length. */
export function networkCidr(ip, prefixLength) {
  const parsed = parseIpToBytes(ip);
  if (!parsed || prefixLength == null) return null;
  const { bytes, version } = parsed;
  const masked = Uint8Array.from(bytes);
  for (let i = 0; i < masked.length; i += 1) {
    const bitsLeft = prefixLength - i * 8;
    if (bitsLeft >= 8) continue;
    masked[i] = bitsLeft <= 0 ? 0 : masked[i] & ((0xff << (8 - bitsLeft)) & 0xff);
  }
  const addr = version === 4 ? Array.from(masked).join('.') : formatIpv6(masked);
  return `${addr}/${prefixLength}`;
}

export class MmdbReader {
  /** @param {Buffer} buf full contents of a .mmdb file */
  constructor(buf) {
    this.buf = buf;
    this.decodeCache = new Map();

    const markerAt = buf.lastIndexOf(METADATA_MARKER);
    if (markerAt < 0) throw new Error('Invalid MMDB file: metadata marker not found');
    const metadataStart = markerAt + METADATA_MARKER.length;
    const [metadata] = this.decode(metadataStart, metadataStart);
    this.metadata = metadata;

    this.nodeCount = Number(metadata.node_count);
    this.recordSize = Number(metadata.record_size);
    this.ipVersion = Number(metadata.ip_version);
    if (![24, 28, 32].includes(this.recordSize)) {
      throw new Error(`Unsupported MMDB record size: ${this.recordSize}`);
    }
    this.nodeByteSize = this.recordSize / 4; // two records per node
    this.searchTreeSize = this.nodeCount * this.nodeByteSize;
    this.dataSectionStart = this.searchTreeSize + DATA_SECTION_SEPARATOR_SIZE;
    this.ipv4StartNode = null;
  }

  get databaseType() {
    return this.metadata.database_type || 'unknown';
  }

  get buildDate() {
    const epoch = Number(this.metadata.build_epoch || 0);
    return epoch ? new Date(epoch * 1000).toISOString().slice(0, 10) : null;
  }

  readNode(node, bit) {
    const b = this.buf;
    const off = node * this.nodeByteSize;
    if (this.recordSize === 24) {
      const o = off + bit * 3;
      return (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];
    }
    if (this.recordSize === 28) {
      if (bit === 0) return ((b[off + 3] & 0xf0) << 20) | (b[off] << 16) | (b[off + 1] << 8) | b[off + 2];
      return ((b[off + 3] & 0x0f) << 24) | (b[off + 4] << 16) | (b[off + 5] << 8) | b[off + 6];
    }
    return b.readUInt32BE(off + bit * 4);
  }

  ipv4Start() {
    if (this.ipv4StartNode === null) {
      let node = 0;
      for (let i = 0; i < 96 && node < this.nodeCount; i += 1) node = this.readNode(node, 0);
      this.ipv4StartNode = node;
    }
    return this.ipv4StartNode;
  }

  /**
   * Look up an IP address.
   * @returns {{ data: object | null, prefixLength: number } | null}
   */
  lookup(ip) {
    const parsed = parseIpToBytes(ip);
    if (!parsed) return null;
    const { bytes, version } = parsed;
    if (version === 6 && this.ipVersion === 4) return null;

    let node = version === 4 && this.ipVersion === 6 ? this.ipv4Start() : 0;
    const bitCount = bytes.length * 8;
    let depth = 0;
    for (; depth < bitCount && node < this.nodeCount; depth += 1) {
      const bit = (bytes[depth >> 3] >> (7 - (depth & 7))) & 1;
      node = this.readNode(node, bit);
    }

    if (node === this.nodeCount) return { data: null, prefixLength: depth };
    if (node > this.nodeCount) {
      const offset = node - this.nodeCount - DATA_SECTION_SEPARATOR_SIZE + this.dataSectionStart;
      return { data: this.decodeRecord(offset), prefixLength: depth };
    }
    return null;
  }

  decodeRecord(offset) {
    const cached = this.decodeCache.get(offset);
    if (cached) return cached;
    const [value] = this.decode(offset, this.dataSectionStart);
    if (this.decodeCache.size >= DECODE_CACHE_LIMIT) this.decodeCache.clear();
    this.decodeCache.set(offset, value);
    return value;
  }

  readUint(offset, size) {
    if (size === 0) return 0;
    if (size <= 6) {
      let v = 0;
      for (let i = 0; i < size; i += 1) v = v * 256 + this.buf[offset + i];
      return v;
    }
    let v = 0n;
    for (let i = 0; i < size; i += 1) v = (v << 8n) | BigInt(this.buf[offset + i]);
    return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString();
  }

  /**
   * Decode one data-section field.
   * @param {number} offset absolute byte offset in the buffer
   * @param {number} base   absolute offset that pointers are relative to
   * @returns {[unknown, number]} [value, offset after the field]
   */
  decode(offset, base) {
    const b = this.buf;
    const ctrl = b[offset++];
    let type = ctrl >> 5;

    if (type === 1) {
      // Pointer
      const ss = (ctrl >> 3) & 0x3;
      const vvv = ctrl & 0x7;
      let p;
      if (ss === 0) {
        p = (vvv << 8) | b[offset];
        offset += 1;
      } else if (ss === 1) {
        p = ((vvv << 16) | (b[offset] << 8) | b[offset + 1]) + 2048;
        offset += 2;
      } else if (ss === 2) {
        p = ((vvv << 24) | (b[offset] << 16) | (b[offset + 1] << 8) | b[offset + 2]) + 526336;
        offset += 3;
      } else {
        p = b.readUInt32BE(offset);
        offset += 4;
      }
      const [value] = this.decode(base + p, base);
      return [value, offset];
    }

    if (type === 0) type = 7 + b[offset++]; // extended type

    let size = ctrl & 0x1f;
    if (size === 29) {
      size = 29 + b[offset];
      offset += 1;
    } else if (size === 30) {
      size = 285 + b.readUInt16BE(offset);
      offset += 2;
    } else if (size === 31) {
      size = 65821 + b.readUIntBE(offset, 3);
      offset += 3;
    }

    switch (type) {
      case 2: // UTF-8 string
        return [b.toString('utf8', offset, offset + size), offset + size];
      case 3: // double
        return [b.readDoubleBE(offset), offset + 8];
      case 4: // bytes
        return [b.subarray(offset, offset + size), offset + size];
      case 5: // uint16
      case 6: // uint32
      case 9: // uint64
      case 10: // uint128
        return [this.readUint(offset, size), offset + size];
      case 7: {
        // map
        const obj = {};
        for (let i = 0; i < size; i += 1) {
          const [key, afterKey] = this.decode(offset, base);
          const [val, afterVal] = this.decode(afterKey, base);
          obj[key] = val;
          offset = afterVal;
        }
        return [obj, offset];
      }
      case 8: {
        // int32
        let v = 0;
        for (let i = 0; i < size; i += 1) v = v * 256 + b[offset + i];
        if (size === 4 && v >= 0x80000000) v -= 0x100000000;
        return [v, offset + size];
      }
      case 11: {
        // array
        const arr = [];
        for (let i = 0; i < size; i += 1) {
          const [val, next] = this.decode(offset, base);
          arr.push(val);
          offset = next;
        }
        return [arr, offset];
      }
      case 14: // boolean (value stored in size)
        return [size !== 0, offset];
      case 15: // float
        return [b.readFloatBE(offset), offset + 4];
      default:
        throw new Error(`Unsupported MMDB data type ${type} at offset ${offset}`);
    }
  }
}
