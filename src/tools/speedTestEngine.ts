/**
 * Resilient Multi-Node LibreSpeed-Compatible Speed Test Engine.
 *
 * Automatically races a registry of CORS-enabled public LibreSpeed nodes
 * (plus an optional fallback), locks onto the lowest-latency reachable server,
 * and seamlessly fails over to the next fastest verified node if a server
 * drops or rate-limits mid-test.
 */

export interface SpeedTestNode {
  id: string;
  name: string;
  location: string;
  region: 'EU' | 'US' | 'ANYCAST';
  kind: 'librespeed' | 'cloudflare';
  baseUrl: string;
  pingPath: string;
  dlPath: string;
  ulPath: string;
  /** LibreSpeed ckSize parameter (MB) for garbage.php */
  ckSize?: number;
}

export interface DiscoveredNode {
  node: SpeedTestNode;
  latencyMs: number;
}

export const SPEED_TEST_NODES: SpeedTestNode[] = [
  {
    id: 'sharktech-ams',
    name: 'Amsterdam, NL (Sharktech EU)',
    location: 'Amsterdam, Netherlands',
    region: 'EU',
    kind: 'librespeed',
    baseUrl: 'https://amsspeed.sharktech.net',
    pingPath: 'backend/empty.php',
    dlPath: 'backend/garbage.php',
    ulPath: 'backend/empty.php',
    ckSize: 25,
  },
  {
    id: 'sharktech-chi',
    name: 'Chicago, IL (Sharktech US-Central)',
    location: 'Chicago, USA',
    region: 'US',
    kind: 'librespeed',
    baseUrl: 'https://chispeed.sharktech.net',
    pingPath: 'backend/empty.php',
    dlPath: 'backend/garbage.php',
    ulPath: 'backend/empty.php',
    ckSize: 25,
  },
  {
    id: 'sharktech-den',
    name: 'Denver, CO (Sharktech US-Mountain)',
    location: 'Denver, USA',
    region: 'US',
    kind: 'librespeed',
    baseUrl: 'https://denspeed.sharktech.net',
    pingPath: 'backend/empty.php',
    dlPath: 'backend/garbage.php',
    ulPath: 'backend/empty.php',
    ckSize: 25,
  },
  {
    id: 'sharktech-lax',
    name: 'Los Angeles, CA (Sharktech US-West)',
    location: 'Los Angeles, USA',
    region: 'US',
    kind: 'librespeed',
    baseUrl: 'https://laxspeed.sharktech.net',
    pingPath: 'backend/empty.php',
    dlPath: 'backend/garbage.php',
    ulPath: 'backend/empty.php',
    ckSize: 25,
  },
  {
    id: 'sharktech-las',
    name: 'Las Vegas, NV (Sharktech US-West)',
    location: 'Las Vegas, USA',
    region: 'US',
    kind: 'librespeed',
    baseUrl: 'https://lasspeed.sharktech.net',
    pingPath: 'backend/empty.php',
    dlPath: 'backend/garbage.php',
    ulPath: 'backend/empty.php',
    ckSize: 25,
  },
  {
    id: 'cloudflare-anycast',
    name: 'Cloudflare Edge (Anycast Fallback)',
    location: 'Nearest Anycast POP',
    region: 'ANYCAST',
    kind: 'cloudflare',
    baseUrl: 'https://speed.cloudflare.com',
    pingPath: '__down?bytes=0',
    dlPath: '__down?bytes=25000000',
    ulPath: '__up',
  },
];

export interface SpeedTestConfig {
  /** Number of sequential cache-busted requests for Ping & Jitter. */
  pingCount: number;
  /** Target duration (ms) for the Download phase. */
  downloadDurationMs: number;
  /** Target duration (ms) for the Upload phase. */
  uploadDurationMs: number;
  /** Initial slow-start window (ms) discarded from final average Mbps. */
  warmupDiscardMs: number;
  /** Number of concurrent HTTP streams used to saturate the link. */
  parallelStreams: number;
  /** Binary payload size (bytes) per upload POST request. */
  uploadChunkBytes: number;
  /** Sampling interval (ms) for live VU meter & chart updates. */
  sampleIntervalMs: number;
  /** Per-probe timeout (ms) during parallel node auto-discovery. */
  discoveryTimeoutMs: number;
}

export const SPEED_TEST_CONFIG: SpeedTestConfig = {
  pingCount: 10,
  downloadDurationMs: 8500,
  uploadDurationMs: 8500,
  warmupDiscardMs: 1500,
  parallelStreams: 4,
  uploadChunkBytes: 2_000_000,
  sampleIntervalMs: 120,
  discoveryTimeoutMs: 3500,
};

export type SpeedTestPhase =
  | 'idle'
  | 'latency'
  | 'download'
  | 'upload'
  | 'complete'
  | 'aborted'
  | 'error';

export interface NetworkInfo {
  ip: string;
  asn: string;
  isp: string;
  colo: string;
  city: string;
  country: string;
  source: 'api' | 'ipapi';
}

export interface ThroughputSample {
  elapsedMs: number;
  mbps: number;
}

export interface LatencyResult {
  medianMs: number;
  jitterMs: number;
  minMs: number;
  maxMs: number;
  samplesMs: number[];
}

export interface TransferResult {
  avgMbps: number;
  peakMbps: number;
  totalBytes: number;
  durationMs: number;
  samples: ThroughputSample[];
}

export interface SpeedTestResult {
  timestamp: string;
  node: SpeedTestNode;
  network: NetworkInfo | null;
  latency: LatencyResult;
  download: TransferResult;
  upload: TransferResult;
}

export interface SpeedTestCallbacks {
  onPhaseChange?: (phase: SpeedTestPhase) => void;
  onNodeSelected?: (discovered: DiscoveredNode) => void;
  onPingSample?: (sampleMs: number, index: number, total: number) => void;
  onLatencyComplete?: (result: LatencyResult) => void;
  onDownloadSample?: (liveMbps: number, avgMbps: number, sample: ThroughputSample, progress: number) => void;
  onDownloadComplete?: (result: TransferResult) => void;
  onUploadSample?: (liveMbps: number, avgMbps: number, sample: ThroughputSample, progress: number) => void;
  onUploadComplete?: (result: TransferResult) => void;
}

function randParam(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function buildUrl(baseUrl: string, pathWithQuery: string, extraParams: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const path = pathWithQuery.replace(/^\/+/, '');
  const sep = path.includes('?') ? '&' : '?';
  return `${base}/${path}${sep}${extraParams}`;
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  );
}

/**
 * Classifies network/CORS/adblocker errors into a clear user-facing message.
 */
export function formatSpeedTestError(err: unknown): string {
  if (isAbortError(err)) {
    return 'Speed test aborted by user.';
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (
    msg.includes('Failed to fetch') ||
    msg.includes('NetworkError') ||
    msg.includes('Load failed') ||
    msg.includes('CORS')
  ) {
    return 'All speed test nodes were unreachable or blocked (CORS, adblocker, privacy extension, or firewall).';
  }
  return msg || 'Speed test failed due to an unexpected network error.';
}

/**
 * Fetch client public IP and ISP/ASN from TechTools `/api/ip` (works in both
 * web app and browser extension via ext-fetch-shim), with `ipapi.co` fallback.
 */
export async function fetchNetworkInfo(signal?: AbortSignal): Promise<NetworkInfo> {
  try {
    const apiRes = await fetch('/api/ip', { cache: 'no-store', signal });
    if (apiRes.ok) {
      const apiJson = (await apiRes.json()) as {
        ip?: string;
        network?: {
          asn?: string;
          asnHolder?: string;
          organization?: string;
          country?: string;
        };
      };
      if (apiJson.ip) {
        return {
          ip: apiJson.ip,
          asn: apiJson.network?.asn || '—',
          isp: apiJson.network?.asnHolder || apiJson.network?.organization || 'Unknown ISP',
          colo: 'AUTO',
          city: '',
          country: apiJson.network?.country || '',
          source: 'api',
        };
      }
    }
  } catch (err) {
    if (isAbortError(err)) throw err;
  }

  const res = await fetch('https://ipapi.co/json/', { cache: 'no-store', signal });
  if (!res.ok) {
    throw new Error('Failed to resolve public IP / ISP metadata.');
  }
  const data = (await res.json()) as {
    ip?: string;
    asn?: string;
    org?: string;
    city?: string;
    country_code?: string;
    country_name?: string;
  };
  return {
    ip: data.ip || 'Unknown',
    asn: data.asn || '—',
    isp: data.org || 'Unknown ISP',
    colo: 'AUTO',
    city: data.city || '',
    country: data.country_code || data.country_name || '',
    source: 'ipapi',
  };
}

/**
 * Probe a single node 3 times to verify CORS + reachability and compute median RTT.
 */
async function probeSingleNode(
  node: SpeedTestNode,
  signal: AbortSignal | undefined,
  timeoutMs: number
): Promise<DiscoveredNode> {
  const samples: number[] = [];

  for (let i = 0; i < 3; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const timeoutController = new AbortController();
    const timer = window.setTimeout(() => timeoutController.abort(), timeoutMs);
    const onParentAbort = () => timeoutController.abort();
    signal?.addEventListener('abort', onParentAbort, { once: true });

    const url = buildUrl(node.baseUrl, node.pingPath, `r=${randParam()}`);
    const t0 = performance.now();
    try {
      const res = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        signal: timeoutController.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await res.arrayBuffer();
      samples.push(Math.max(0.1, performance.now() - t0));
    } finally {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', onParentAbort);
    }
  }

  const sorted = [...samples].sort((a, b) => a - b);
  return {
    node,
    latencyMs: Number(sorted[1].toFixed(1)),
  };
}

/**
 * Parallel ping race across SPEED_TEST_NODES. Filters out nodes that fail CORS,
 * return non-2xx, or time out, and returns reachable nodes sorted by lowest median latency.
 */
export async function discoverBestNodes(
  signal?: AbortSignal,
  nodes: SpeedTestNode[] = SPEED_TEST_NODES,
  config: SpeedTestConfig = SPEED_TEST_CONFIG
): Promise<DiscoveredNode[]> {
  const results = await Promise.allSettled(
    nodes.map((node) => probeSingleNode(node, signal, config.discoveryTimeoutMs))
  );

  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const reachable: DiscoveredNode[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      reachable.push(r.value);
    }
  }

  reachable.sort((a, b) => {
    // Prefer LibreSpeed nodes over Cloudflare fallback when latency is comparable,
    // otherwise sort strictly by lowest median latency.
    if (a.node.kind !== b.node.kind) {
      if (a.node.kind === 'cloudflare' && b.latencyMs < a.latencyMs + 120) return 1;
      if (b.node.kind === 'cloudflare' && a.latencyMs < b.latencyMs + 120) return -1;
    }
    return a.latencyMs - b.latencyMs;
  });

  if (reachable.length === 0) {
    throw new Error('Zero speed test nodes in the registry are reachable (CORS / network blocked).');
  }

  return reachable;
}

/**
 * Measure median RTT ping (ms) and jitter (mean consecutive variation)
 * using 10 sequential cache-busted GET requests to <node>/empty.php?r=<rand>.
 */
export async function measureLatency(
  node: SpeedTestNode,
  signal: AbortSignal,
  config: SpeedTestConfig = SPEED_TEST_CONFIG,
  onPingSample?: (sampleMs: number, index: number, total: number) => void
): Promise<LatencyResult> {
  const samplesMs: number[] = [];

  for (let i = 0; i < config.pingCount; i++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const url = buildUrl(node.baseUrl, node.pingPath, `r=${randParam()}`);
    const t0 = performance.now();
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal,
    });
    if (!res.ok) throw new Error(`Ping HTTP ${res.status} on ${node.name}`);
    await res.arrayBuffer();
    const rtt = Math.max(0.1, performance.now() - t0);
    samplesMs.push(rtt);
    onPingSample?.(rtt, i + 1, config.pingCount);
  }

  const sorted = [...samplesMs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianMs =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

  let jitterSum = 0;
  for (let i = 1; i < samplesMs.length; i++) {
    jitterSum += Math.abs(samplesMs[i] - samplesMs[i - 1]);
  }
  const jitterMs = samplesMs.length > 1 ? jitterSum / (samplesMs.length - 1) : 0;

  return {
    medianMs: Number(medianMs.toFixed(1)),
    jitterMs: Number(jitterMs.toFixed(1)),
    minMs: Number(sorted[0].toFixed(1)),
    maxMs: Number(sorted[sorted.length - 1].toFixed(1)),
    samplesMs: samplesMs.map((v) => Number(v.toFixed(1))),
  };
}

function computeRollingMbps(
  windowEvents: Array<{ time: number; bytes: number }>,
  now: number,
  windowMs = 650
): number {
  const cutoff = now - windowMs;
  while (windowEvents.length > 0 && windowEvents[0].time < cutoff) {
    windowEvents.shift();
  }
  if (windowEvents.length === 0) return 0;
  let bytes = 0;
  for (const ev of windowEvents) bytes += ev.bytes;
  const spanSec = Math.max(0.15, (now - windowEvents[0].time) / 1000);
  return (bytes * 8) / (spanSec * 1_000_000);
}

/**
 * Measure download throughput using parallel ReadableStream fetch loops
 * against <node>/garbage.php?ckSize=25&r=<rand>. Discards warmupDiscardMs slow-start.
 */
export async function measureDownload(
  node: SpeedTestNode,
  signal: AbortSignal,
  config: SpeedTestConfig = SPEED_TEST_CONFIG,
  onSample?: (liveMbps: number, avgMbps: number, sample: ThroughputSample, progress: number) => void
): Promise<TransferResult> {
  const phaseController = new AbortController();
  const onParentAbort = () => phaseController.abort();
  signal.addEventListener('abort', onParentAbort, { once: true });

  const startTime = performance.now();
  const endTime = startTime + config.downloadDurationMs;

  let totalBytes = 0;
  let warmupBytes = 0;
  let warmupCaptured = false;
  let peakMbps = 0;
  const windowEvents: Array<{ time: number; bytes: number }> = [];
  const samples: ThroughputSample[] = [];
  let fatalError: unknown = null;

  const sampler = window.setInterval(() => {
    const now = performance.now();
    const elapsedMs = now - startTime;
    if (!warmupCaptured && elapsedMs >= config.warmupDiscardMs) {
      warmupBytes = totalBytes;
      warmupCaptured = true;
    }

    const liveMbps = computeRollingMbps(windowEvents, now);
    if (liveMbps > peakMbps) peakMbps = liveMbps;

    const effectiveBytes = warmupCaptured ? Math.max(0, totalBytes - warmupBytes) : totalBytes;
    const effectiveSec = warmupCaptured
      ? Math.max(0.1, (elapsedMs - config.warmupDiscardMs) / 1000)
      : Math.max(0.1, elapsedMs / 1000);
    const avgMbps = (effectiveBytes * 8) / (effectiveSec * 1_000_000);

    const sample: ThroughputSample = {
      elapsedMs: Math.round(elapsedMs),
      mbps: Number(liveMbps.toFixed(2)),
    };
    samples.push(sample);
    onSample?.(
      Number(liveMbps.toFixed(2)),
      Number(avgMbps.toFixed(2)),
      sample,
      Math.min(1, elapsedMs / config.downloadDurationMs)
    );

    if (now >= endTime) {
      phaseController.abort();
    }
  }, config.sampleIntervalMs);

  const worker = async () => {
    while (!phaseController.signal.aborted && !signal.aborted && performance.now() < endTime) {
      const extra =
        node.kind === 'librespeed'
          ? `ckSize=${node.ckSize ?? 25}&r=${randParam()}`
          : `r=${randParam()}`;
      const url = buildUrl(node.baseUrl, node.dlPath, extra);
      try {
        const res = await fetch(url, {
          method: 'GET',
          cache: 'no-store',
          signal: phaseController.signal,
        });
        if (!res.ok) throw new Error(`Download HTTP ${res.status} on ${node.name}`);
        if (!res.body) throw new Error('ReadableStream not supported by browser.');

        const reader = res.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.byteLength > 0) {
            const now = performance.now();
            totalBytes += value.byteLength;
            windowEvents.push({ time: now, bytes: value.byteLength });
          }
          if (performance.now() >= endTime) {
            phaseController.abort();
            break;
          }
        }
      } catch (err) {
        if (isAbortError(err)) break;
        fatalError = err;
        phaseController.abort();
        break;
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: config.parallelStreams }, () => worker()));
  } finally {
    window.clearInterval(sampler);
    signal.removeEventListener('abort', onParentAbort);
  }

  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  if (fatalError && totalBytes === 0) {
    throw fatalError;
  }

  const totalElapsedMs = Math.max(1, performance.now() - startTime);
  const measuredBytes =
    warmupCaptured && totalElapsedMs > config.warmupDiscardMs
      ? Math.max(0, totalBytes - warmupBytes)
      : totalBytes;
  const measuredSec =
    warmupCaptured && totalElapsedMs > config.warmupDiscardMs
      ? (totalElapsedMs - config.warmupDiscardMs) / 1000
      : totalElapsedMs / 1000;
  const avgMbps = (measuredBytes * 8) / (Math.max(0.1, measuredSec) * 1_000_000);

  return {
    avgMbps: Number(avgMbps.toFixed(2)),
    peakMbps: Number(Math.max(peakMbps, avgMbps).toFixed(2)),
    totalBytes,
    durationMs: Math.round(totalElapsedMs),
    samples,
  };
}

function buildRandomBlob(byteLength: number): Blob {
  const buf = new Uint8Array(byteLength);
  const chunk = 65536;
  for (let offset = 0; offset < byteLength; offset += chunk) {
    const slice = buf.subarray(offset, Math.min(offset + chunk, byteLength));
    crypto.getRandomValues(slice);
  }
  return new Blob([buf], { type: 'application/octet-stream' });
}

/**
 * Measure upload throughput using parallel XMLHttpRequest POST streams
 * to <node>/empty.php?r=<rand>. Discards warmupDiscardMs slow-start.
 */
export async function measureUpload(
  node: SpeedTestNode,
  signal: AbortSignal,
  config: SpeedTestConfig = SPEED_TEST_CONFIG,
  onSample?: (liveMbps: number, avgMbps: number, sample: ThroughputSample, progress: number) => void
): Promise<TransferResult> {
  const payloadBlob = buildRandomBlob(config.uploadChunkBytes);
  const phaseController = new AbortController();
  const onParentAbort = () => phaseController.abort();
  signal.addEventListener('abort', onParentAbort, { once: true });

  const startTime = performance.now();
  const endTime = startTime + config.uploadDurationMs;

  let totalBytes = 0;
  let warmupBytes = 0;
  let warmupCaptured = false;
  let peakMbps = 0;
  const windowEvents: Array<{ time: number; bytes: number }> = [];
  const samples: ThroughputSample[] = [];
  let fatalError: unknown = null;

  const sampler = window.setInterval(() => {
    const now = performance.now();
    const elapsedMs = now - startTime;
    if (!warmupCaptured && elapsedMs >= config.warmupDiscardMs) {
      warmupBytes = totalBytes;
      warmupCaptured = true;
    }

    const liveMbps = computeRollingMbps(windowEvents, now);
    if (liveMbps > peakMbps) peakMbps = liveMbps;

    const effectiveBytes = warmupCaptured ? Math.max(0, totalBytes - warmupBytes) : totalBytes;
    const effectiveSec = warmupCaptured
      ? Math.max(0.1, (elapsedMs - config.warmupDiscardMs) / 1000)
      : Math.max(0.1, elapsedMs / 1000);
    const avgMbps = (effectiveBytes * 8) / (effectiveSec * 1_000_000);

    const sample: ThroughputSample = {
      elapsedMs: Math.round(elapsedMs),
      mbps: Number(liveMbps.toFixed(2)),
    };
    samples.push(sample);
    onSample?.(
      Number(liveMbps.toFixed(2)),
      Number(avgMbps.toFixed(2)),
      sample,
      Math.min(1, elapsedMs / config.uploadDurationMs)
    );

    if (now >= endTime) {
      phaseController.abort();
    }
  }, config.sampleIntervalMs);

  const uploadOnce = (url: string, abortSig: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) => {
      if (abortSig.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const xhr = new XMLHttpRequest();
      let lastLoaded = 0;

      const onAbort = () => xhr.abort();
      abortSig.addEventListener('abort', onAbort, { once: true });

      xhr.upload.addEventListener('progress', (ev) => {
        const delta = Math.max(0, ev.loaded - lastLoaded);
        lastLoaded = ev.loaded;
        if (delta > 0) {
          const now = performance.now();
          totalBytes += delta;
          windowEvents.push({ time: now, bytes: delta });
        }
      });

      xhr.addEventListener('load', () => {
        abortSig.removeEventListener('abort', onAbort);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Upload HTTP ${xhr.status} on ${node.name}`));
        }
      });

      xhr.addEventListener('error', () => {
        abortSig.removeEventListener('abort', onAbort);
        reject(new Error(`Failed to fetch: upload blocked or reset on ${node.name}.`));
      });

      xhr.addEventListener('abort', () => {
        abortSig.removeEventListener('abort', onAbort);
        reject(new DOMException('Aborted', 'AbortError'));
      });

      xhr.open('POST', url, true);
      xhr.send(payloadBlob);
    });

  const worker = async () => {
    while (!phaseController.signal.aborted && !signal.aborted && performance.now() < endTime) {
      const url = buildUrl(node.baseUrl, node.ulPath, `r=${randParam()}`);
      try {
        await uploadOnce(url, phaseController.signal);
      } catch (err) {
        if (isAbortError(err)) break;
        fatalError = err;
        phaseController.abort();
        break;
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: config.parallelStreams }, () => worker()));
  } finally {
    window.clearInterval(sampler);
    signal.removeEventListener('abort', onParentAbort);
  }

  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  if (fatalError && totalBytes === 0) {
    throw fatalError;
  }

  const totalElapsedMs = Math.max(1, performance.now() - startTime);
  const measuredBytes =
    warmupCaptured && totalElapsedMs > config.warmupDiscardMs
      ? Math.max(0, totalBytes - warmupBytes)
      : totalBytes;
  const measuredSec =
    warmupCaptured && totalElapsedMs > config.warmupDiscardMs
      ? (totalElapsedMs - config.warmupDiscardMs) / 1000
      : totalElapsedMs / 1000;
  const avgMbps = (measuredBytes * 8) / (Math.max(0.1, measuredSec) * 1_000_000);

  return {
    avgMbps: Number(avgMbps.toFixed(2)),
    peakMbps: Number(Math.max(peakMbps, avgMbps).toFixed(2)),
    totalBytes,
    durationMs: Math.round(totalElapsedMs),
    samples,
  };
}

/**
 * Execute full speed test sequence with automatic fallback across verified nodes:
 * if the active node fails mid-test (CORS, network drop, 429/5xx), automatically
 * switches to the next fastest verified node and retries without crashing the UI.
 */
export async function runSpeedTest(
  signal: AbortSignal,
  callbacks: SpeedTestCallbacks = {},
  rankedNodes: DiscoveredNode[] = [],
  networkInfo: NetworkInfo | null = null,
  config: SpeedTestConfig = SPEED_TEST_CONFIG
): Promise<SpeedTestResult> {
  const candidates =
    rankedNodes.length > 0
      ? rankedNodes
      : await discoverBestNodes(signal, SPEED_TEST_NODES, config);

  let lastErr: unknown = null;

  for (const candidate of candidates) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    callbacks.onNodeSelected?.(candidate);

    try {
      callbacks.onPhaseChange?.('latency');
      const latency = await measureLatency(candidate.node, signal, config, callbacks.onPingSample);
      callbacks.onLatencyComplete?.(latency);

      callbacks.onPhaseChange?.('download');
      const download = await measureDownload(candidate.node, signal, config, callbacks.onDownloadSample);
      callbacks.onDownloadComplete?.(download);

      callbacks.onPhaseChange?.('upload');
      const upload = await measureUpload(candidate.node, signal, config, callbacks.onUploadSample);
      callbacks.onUploadComplete?.(upload);

      callbacks.onPhaseChange?.('complete');
      return {
        timestamp: new Date().toISOString(),
        node: candidate.node,
        network: networkInfo,
        latency,
        download,
        upload,
      };
    } catch (err) {
      if (isAbortError(err)) throw err;
      lastErr = err;
      // Automatically fail over to the next fastest verified node
    }
  }

  throw lastErr ?? new Error('Zero nodes in the speed test registry are reachable.');
}
