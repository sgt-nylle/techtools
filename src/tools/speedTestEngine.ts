/**
 * Geo-Located M-Lab NDT7 Speed Test Engine (with clean LibreSpeed HTTP fallback).
 *
 * Uses Measurement Lab's public Locate v2 API (`locate.measurementlab.net`) to
 * automatically discover the geographically closest IXP server to the user's
 * connection (e.g., Stockholm, Frankfurt, London, New York) and measures
 * Ping/Jitter (kernel TCPInfo MinRTT & RTTVar), Download, and Upload over
 * standard `wss://` NDT7 WebSockets — working reliably across web browsers and
 * browser extensions without CORS preflight failures or CDN rate limits.
 */

import type { Ndt7WorkerInMessage, Ndt7WorkerOutMessage } from './ndt7Worker';

export interface SpeedTestNode {
  id: string;
  name: string;
  city: string;
  country: string;
  machine: string;
  kind: 'mlab-ndt7' | 'librespeed-http';
  downloadUrl: string;
  uploadUrl: string;
}

export interface SpeedTestConfig {
  /** Duration (ms) for Download phase. */
  downloadDurationMs: number;
  /** Duration (ms) for Upload phase. */
  uploadDurationMs: number;
  /** Initial slow-start window (ms) excluded from final average Mbps. */
  warmupDiscardMs: number;
  /** Sampling interval (ms) for live VU meter & chart updates. */
  sampleIntervalMs: number;
  /** Connection timeout (ms) when opening a WebSocket. */
  connectTimeoutMs: number;
  /** Locate API endpoint for geo-closest M-Lab NDT7 servers. */
  mlabLocateUrl: string;
}

export const SPEED_TEST_CONFIG: SpeedTestConfig = {
  downloadDurationMs: 7500,
  uploadDurationMs: 7500,
  warmupDiscardMs: 1500,
  sampleIntervalMs: 160,
  connectTimeoutMs: 5000,
  mlabLocateUrl: 'https://locate.measurementlab.net/v2/nearest/ndt/ndt7',
};

const HTTP_FALLBACK_NODE: SpeedTestNode = {
  id: 'sharktech-ams-http',
  name: 'Amsterdam, NL (HTTP Fallback)',
  city: 'Amsterdam',
  country: 'NL',
  machine: 'amsspeed.sharktech.net',
  kind: 'librespeed-http',
  downloadUrl: 'https://amsspeed.sharktech.net/backend/garbage.php',
  uploadUrl: 'https://amsspeed.sharktech.net/backend/empty.php',
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
  onNodeSelected?: (node: SpeedTestNode) => void;
  onLatencyUpdate?: (result: LatencyResult) => void;
  onDownloadSample?: (liveMbps: number, avgMbps: number, sample: ThroughputSample, progress: number) => void;
  onDownloadComplete?: (result: TransferResult) => void;
  onUploadSample?: (liveMbps: number, avgMbps: number, sample: ThroughputSample, progress: number) => void;
  onUploadComplete?: (result: TransferResult) => void;
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  );
}

export function formatSpeedTestError(err: unknown): string {
  if (isAbortError(err)) {
    return 'Speed test aborted by user.';
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (
    msg.includes('Failed to fetch') ||
    msg.includes('NetworkError') ||
    msg.includes('Load failed') ||
    msg.includes('WebSocket')
  ) {
    return 'Unable to reach M-Lab NDT7 or fallback speed test node. A firewall, VPN, or privacy extension may be blocking WebSocket/HTTPS test traffic.';
  }
  return msg || 'Speed test failed due to an unexpected network error.';
}

/**
 * Fetch client public IP & ISP/ASN via TechTools `/api/ip` (works in both
 * web app and browser extension), with `ipapi.co` fallback.
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
    city: data.city || '',
    country: data.country_code || data.country_name || '',
    source: 'ipapi',
  };
}

interface MLabLocateResponse {
  results?: Array<{
    machine?: string;
    hostname?: string;
    location?: {
      city?: string;
      country?: string;
    };
    urls?: Record<string, string>;
  }>;
}

/**
 * Discover geographically closest M-Lab NDT7 nodes for the client's current location.
 * Returns up to 2 nearest M-Lab servers (with fresh signed WSS tokens) plus HTTP fallback.
 */
export async function discoverClosestNodes(
  signal?: AbortSignal,
  config: SpeedTestConfig = SPEED_TEST_CONFIG
): Promise<SpeedTestNode[]> {
  const nodes: SpeedTestNode[] = [];

  try {
    const res = await fetch(config.mlabLocateUrl, {
      cache: 'no-store',
      signal,
    });
    if (res.ok) {
      const data = (await res.json()) as MLabLocateResponse;
      for (const item of (data.results ?? []).slice(0, 2)) {
        const dlUrl = item.urls?.['wss:///ndt/v7/download'];
        const ulUrl = item.urls?.['wss:///ndt/v7/upload'];
        if (!dlUrl || !ulUrl) continue;
        const city = item.location?.city || 'Nearest IXP';
        const country = item.location?.country || '';
        const machine = item.machine || item.hostname || 'measurement-lab.org';
        const locLabel = [city, country].filter(Boolean).join(', ');
        nodes.push({
          id: machine,
          name: `${locLabel} (M-Lab NDT7)`,
          city,
          country,
          machine,
          kind: 'mlab-ndt7',
          downloadUrl: dlUrl,
          uploadUrl: ulUrl,
        });
      }
    }
  } catch (err) {
    if (isAbortError(err)) throw err;
  }

  nodes.push(HTTP_FALLBACK_NODE);
  return nodes;
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
 * Runs an NDT7 Download or Upload phase inside a dedicated Web Worker thread
 * so React/DOM rendering (especially in browser extension popups) never starves
 * WebSocket receive/send buffers.
 */
function runNdt7PhaseInWorker(
  direction: 'download' | 'upload',
  node: SpeedTestNode,
  signal: AbortSignal,
  config: SpeedTestConfig,
  onLatencyUpdate?: (lat: LatencyResult) => void,
  onSample?: (liveMbps: number, avgMbps: number, sample: ThroughputSample, progress: number) => void
): Promise<{ transfer: TransferResult; latency?: LatencyResult }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const worker = new Worker(new URL('./ndt7Worker.ts', import.meta.url), { type: 'module' });
    let settled = false;

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
      worker.terminate();
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      try {
        worker.postMessage({ type: 'abort' } satisfies Ndt7WorkerInMessage);
      } catch {
        // ignore
      }
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });

    worker.onmessage = (ev: MessageEvent<Ndt7WorkerOutMessage>) => {
      const msg = ev.data;
      if (msg.type === 'latency' && msg.latency) {
        onLatencyUpdate?.(msg.latency);
      } else if (msg.type === 'sample' && msg.sample) {
        onSample?.(
          msg.liveMbps ?? msg.sample.mbps,
          msg.avgMbps ?? msg.sample.mbps,
          msg.sample,
          msg.progress ?? 0
        );
      } else if (msg.type === 'done' && msg.result) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ transfer: msg.result, latency: msg.latency });
      } else if (msg.type === 'error') {
        if (settled) return;
        settled = true;
        cleanup();
        if (msg.aborted || signal.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
        } else {
          reject(new Error(msg.error || `NDT7 ${direction} failed on ${node.name}`));
        }
      }
    };

    worker.onerror = (ev) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(ev.message || `Worker error during NDT7 ${direction}`));
    };

    const startMsg: Ndt7WorkerInMessage = {
      type: direction === 'download' ? 'start-download' : 'start-upload',
      url: direction === 'download' ? node.downloadUrl : node.uploadUrl,
      nodeName: node.name,
      durationMs: direction === 'download' ? config.downloadDurationMs : config.uploadDurationMs,
      warmupDiscardMs: config.warmupDiscardMs,
      sampleIntervalMs: config.sampleIntervalMs,
      connectTimeoutMs: config.connectTimeoutMs,
    };
    worker.postMessage(startMsg);
  });
}

function measureNdt7Download(
  node: SpeedTestNode,
  signal: AbortSignal,
  config: SpeedTestConfig,
  onLatencyUpdate?: (lat: LatencyResult) => void,
  onSample?: (liveMbps: number, avgMbps: number, sample: ThroughputSample, progress: number) => void
): Promise<{ download: TransferResult; latency: LatencyResult }> {
  return runNdt7PhaseInWorker('download', node, signal, config, onLatencyUpdate, onSample).then(
    ({ transfer, latency }) => ({
      download: transfer,
      latency: latency ?? { medianMs: 0, jitterMs: 0, minMs: 0, maxMs: 0, samplesMs: [] },
    })
  );
}

function measureNdt7Upload(
  node: SpeedTestNode,
  signal: AbortSignal,
  config: SpeedTestConfig,
  onSample?: (liveMbps: number, avgMbps: number, sample: ThroughputSample, progress: number) => void
): Promise<TransferResult> {
  return runNdt7PhaseInWorker('upload', node, signal, config, undefined, onSample).then(
    ({ transfer }) => transfer
  );
}

/**
 * Clean HTTP fallback (only used if M-Lab WebSockets are blocked by a corporate firewall).
 * Uses `Content-Type: text/plain` on POST so browsers send a simple CORS request (zero OPTIONS preflight).
 */
async function runHttpFallbackTest(
  node: SpeedTestNode,
  signal: AbortSignal,
  config: SpeedTestConfig,
  callbacks: SpeedTestCallbacks,
  networkInfo: NetworkInfo | null
): Promise<SpeedTestResult> {
  // 1. Ping (6 probes)
  callbacks.onPhaseChange?.('latency');
  const pingSamples: number[] = [];
  for (let i = 0; i < 6; i++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const t0 = performance.now();
    const res = await fetch(`${node.uploadUrl}?r=${Date.now()}-${i}`, {
      cache: 'no-store',
      signal,
    });
    if (!res.ok) throw new Error(`Fallback ping HTTP ${res.status}`);
    await res.arrayBuffer();
    pingSamples.push(Math.max(0.5, performance.now() - t0));
  }
  const sortedPings = [...pingSamples].sort((a, b) => a - b);
  let jitterSum = 0;
  for (let i = 1; i < pingSamples.length; i++) {
    jitterSum += Math.abs(pingSamples[i] - pingSamples[i - 1]);
  }
  const latency: LatencyResult = {
    medianMs: Number(sortedPings[Math.floor(sortedPings.length / 2)].toFixed(1)),
    jitterMs: Number((jitterSum / Math.max(1, pingSamples.length - 1)).toFixed(1)),
    minMs: Number(sortedPings[0].toFixed(1)),
    maxMs: Number(sortedPings[sortedPings.length - 1].toFixed(1)),
    samplesMs: pingSamples.map((v) => Number(v.toFixed(1))),
  };
  callbacks.onLatencyUpdate?.(latency);

  // 2. Download (3 parallel streams, hard abort + reader.cancel)
  callbacks.onPhaseChange?.('download');
  const dlCtrl = new AbortController();
  const onParentAbortDl = () => dlCtrl.abort();
  signal.addEventListener('abort', onParentAbortDl, { once: true });
  const dlStart = performance.now();
  const dlEnd = dlStart + config.downloadDurationMs;
  let dlBytes = 0;
  let dlWarmup = 0;
  let dlWarmupSet = false;
  let dlPeak = 0;
  const dlWin: Array<{ time: number; bytes: number }> = [];
  const dlSamples: ThroughputSample[] = [];
  const dlSampler = window.setInterval(() => {
    const now = performance.now();
    const el = now - dlStart;
    if (!dlWarmupSet && el >= config.warmupDiscardMs) {
      dlWarmup = dlBytes;
      dlWarmupSet = true;
    }
    const live = computeRollingMbps(dlWin, now);
    if (live > dlPeak) dlPeak = live;
    const effBytes = dlWarmupSet ? Math.max(0, dlBytes - dlWarmup) : dlBytes;
    const effSec = dlWarmupSet ? Math.max(0.1, (el - config.warmupDiscardMs) / 1000) : Math.max(0.1, el / 1000);
    const avg = (effBytes * 8) / (effSec * 1_000_000);
    const s = { elapsedMs: Math.round(el), mbps: Number(live.toFixed(2)) };
    dlSamples.push(s);
    callbacks.onDownloadSample?.(s.mbps, Number(avg.toFixed(2)), s, Math.min(1, el / config.downloadDurationMs));
    if (now >= dlEnd) dlCtrl.abort();
  }, config.sampleIntervalMs);

  const dlWorker = async (idx: number) => {
    let n = 0;
    while (!dlCtrl.signal.aborted && !signal.aborted && performance.now() < dlEnd) {
      try {
        const res = await fetch(`${node.downloadUrl}?ckSize=10&r=${Date.now()}-${idx}-${n++}`, {
          cache: 'no-store',
          signal: dlCtrl.signal,
        });
        if (!res.ok || !res.body) break;
        const reader = res.body.getReader();
        try {
          while (!dlCtrl.signal.aborted && performance.now() < dlEnd) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value?.byteLength) {
              dlBytes += value.byteLength;
              dlWin.push({ time: performance.now(), bytes: value.byteLength });
            }
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
      } catch {
        break;
      }
    }
  };
  try {
    await Promise.all([dlWorker(0), dlWorker(1), dlWorker(2)]);
  } finally {
    window.clearInterval(dlSampler);
    signal.removeEventListener('abort', onParentAbortDl);
  }
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  if (dlBytes === 0) throw new Error('HTTP fallback download returned 0 bytes.');
  const dlTotalMs = Math.max(1, performance.now() - dlStart);
  const dlAvg = ((dlWarmupSet ? dlBytes - dlWarmup : dlBytes) * 8) / (Math.max(0.1, (dlWarmupSet ? dlTotalMs - config.warmupDiscardMs : dlTotalMs) / 1000) * 1_000_000);
  const download: TransferResult = {
    avgMbps: Number(dlAvg.toFixed(2)),
    peakMbps: Number(Math.max(dlPeak, dlAvg).toFixed(2)),
    totalBytes: dlBytes,
    durationMs: Math.round(dlTotalMs),
    samples: dlSamples,
  };
  callbacks.onDownloadComplete?.(download);

  // 3. Upload (simple CORS text/plain Blob -> NO OPTIONS preflight!)
  callbacks.onPhaseChange?.('upload');
  const buf = new Uint8Array(1_000_000);
  for (let o = 0; o < buf.length; o += 65536) {
    crypto.getRandomValues(buf.subarray(o, Math.min(o + 65536, buf.length)));
  }
  const simpleBlob = new Blob([buf], { type: 'text/plain' });

  const ulCtrl = new AbortController();
  const onParentAbortUl = () => ulCtrl.abort();
  signal.addEventListener('abort', onParentAbortUl, { once: true });
  const ulStart = performance.now();
  const ulEnd = ulStart + config.uploadDurationMs;
  let ulBytes = 0;
  let ulWarmup = 0;
  let ulWarmupSet = false;
  let ulPeak = 0;
  const ulWin: Array<{ time: number; bytes: number }> = [];
  const ulSamples: ThroughputSample[] = [];
  const ulSampler = window.setInterval(() => {
    const now = performance.now();
    const el = now - ulStart;
    if (!ulWarmupSet && el >= config.warmupDiscardMs) {
      ulWarmup = ulBytes;
      ulWarmupSet = true;
    }
    const live = computeRollingMbps(ulWin, now);
    if (live > ulPeak) ulPeak = live;
    const effBytes = ulWarmupSet ? Math.max(0, ulBytes - ulWarmup) : ulBytes;
    const effSec = ulWarmupSet ? Math.max(0.1, (el - config.warmupDiscardMs) / 1000) : Math.max(0.1, el / 1000);
    const avg = (effBytes * 8) / (effSec * 1_000_000);
    const s = { elapsedMs: Math.round(el), mbps: Number(live.toFixed(2)) };
    ulSamples.push(s);
    callbacks.onUploadSample?.(s.mbps, Number(avg.toFixed(2)), s, Math.min(1, el / config.uploadDurationMs));
    if (now >= ulEnd) ulCtrl.abort();
  }, config.sampleIntervalMs);

  const postOnce = (url: string): Promise<void> =>
    new Promise((res, rej) => {
      const xhr = new XMLHttpRequest();
      let lastLoaded = 0;
      const onAb = () => xhr.abort();
      ulCtrl.signal.addEventListener('abort', onAb, { once: true });
      xhr.upload.addEventListener('progress', (ev) => {
        const d = Math.max(0, ev.loaded - lastLoaded);
        lastLoaded = ev.loaded;
        if (d > 0) {
          ulBytes += d;
          ulWin.push({ time: performance.now(), bytes: d });
        }
      });
      xhr.addEventListener('load', () => {
        ulCtrl.signal.removeEventListener('abort', onAb);
        if (xhr.status >= 200 && xhr.status < 300) res();
        else rej(new Error(`HTTP ${xhr.status}`));
      });
      xhr.addEventListener('error', () => {
        ulCtrl.signal.removeEventListener('abort', onAb);
        rej(new Error('Upload error'));
      });
      xhr.addEventListener('abort', () => {
        ulCtrl.signal.removeEventListener('abort', onAb);
        rej(new DOMException('Aborted', 'AbortError'));
      });
      xhr.open('POST', url, true);
      xhr.send(simpleBlob);
    });

  const ulWorker = async (idx: number) => {
    let n = 0;
    while (!ulCtrl.signal.aborted && !signal.aborted && performance.now() < ulEnd) {
      try {
        await postOnce(`${node.uploadUrl}?r=${Date.now()}-${idx}-${n++}`);
      } catch {
        break;
      }
    }
  };
  try {
    await Promise.all([ulWorker(0), ulWorker(1), ulWorker(2)]);
  } finally {
    window.clearInterval(ulSampler);
    signal.removeEventListener('abort', onParentAbortUl);
  }
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const ulTotalMs = Math.max(1, performance.now() - ulStart);
  const ulAvg = ((ulWarmupSet ? ulBytes - ulWarmup : ulBytes) * 8) / (Math.max(0.1, (ulWarmupSet ? ulTotalMs - config.warmupDiscardMs : ulTotalMs) / 1000) * 1_000_000);
  const upload: TransferResult = {
    avgMbps: Number(ulAvg.toFixed(2)),
    peakMbps: Number(Math.max(ulPeak, ulAvg).toFixed(2)),
    totalBytes: ulBytes,
    durationMs: Math.round(ulTotalMs),
    samples: ulSamples,
  };
  callbacks.onUploadComplete?.(upload);
  callbacks.onPhaseChange?.('complete');

  return {
    timestamp: new Date().toISOString(),
    node,
    network: networkInfo,
    latency,
    download,
    upload,
  };
}

/**
 * Execute full speed test cleanly:
 * 1. Freshly locates the geographically closest M-Lab NDT7 servers.
 * 2. Runs Download (capturing kernel TCPInfo MinRTT/RTTVar) -> Upload over WSS.
 * 3. Falls back at most once to the 2nd nearest M-Lab node or HTTP fallback — never loops.
 */
export async function runSpeedTest(
  signal: AbortSignal,
  callbacks: SpeedTestCallbacks = {},
  networkInfo: NetworkInfo | null = null,
  config: SpeedTestConfig = SPEED_TEST_CONFIG
): Promise<SpeedTestResult> {
  const candidates = await discoverClosestNodes(signal, config);
  let lastErr: unknown = null;

  for (const node of candidates) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    callbacks.onNodeSelected?.(node);

    try {
      if (node.kind === 'mlab-ndt7') {
        callbacks.onPhaseChange?.('download');
        const { download, latency } = await measureNdt7Download(
          node,
          signal,
          config,
          callbacks.onLatencyUpdate,
          callbacks.onDownloadSample
        );
        callbacks.onLatencyUpdate?.(latency);
        callbacks.onDownloadComplete?.(download);

        callbacks.onPhaseChange?.('upload');
        const upload = await measureNdt7Upload(
          node,
          signal,
          config,
          callbacks.onUploadSample
        );
        callbacks.onUploadComplete?.(upload);
        callbacks.onPhaseChange?.('complete');

        return {
          timestamp: new Date().toISOString(),
          node,
          network: networkInfo,
          latency,
          download,
          upload,
        };
      }

      return await runHttpFallbackTest(node, signal, config, callbacks, networkInfo);
    } catch (err) {
      if (isAbortError(err)) throw err;
      lastErr = err;
    }
  }

  throw lastErr ?? new Error('Unable to reach any speed test server.');
}
