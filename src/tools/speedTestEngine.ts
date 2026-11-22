/**
 * Client-side CDN Edge Speed Test Engine.
 *
 * Measures latency, jitter, download throughput, and upload throughput directly
 * from the user's browser against Cloudflare's Anycast CDN edge endpoints
 * (avoiding the app's own origin server as a bottleneck).
 */

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
  /** Bytes requested per download stream iteration. */
  downloadBytesPerRequest: number;
  /** Binary payload size (bytes) per upload POST request. */
  uploadChunkBytes: number;
  /** Sampling interval (ms) for live VU meter & chart updates. */
  sampleIntervalMs: number;
  endpoints: {
    meta: string;
    down: string;
    up: string;
    fallbackIp: string;
  };
}

export const SPEED_TEST_CONFIG: SpeedTestConfig = {
  pingCount: 10,
  downloadDurationMs: 9000,
  uploadDurationMs: 9000,
  warmupDiscardMs: 1500,
  parallelStreams: 4,
  downloadBytesPerRequest: 25_000_000,
  uploadChunkBytes: 2_000_000,
  sampleIntervalMs: 120,
  endpoints: {
    meta: 'https://speed.cloudflare.com/meta',
    down: 'https://speed.cloudflare.com/__down',
    up: 'https://speed.cloudflare.com/__up',
    fallbackIp: 'https://ipapi.co/json/',
  },
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
  region?: string;
  source: 'cloudflare' | 'ipapi';
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
  network: NetworkInfo | null;
  latency: LatencyResult;
  download: TransferResult;
  upload: TransferResult;
}

export interface SpeedTestCallbacks {
  onPhaseChange?: (phase: SpeedTestPhase) => void;
  onPingSample?: (sampleMs: number, index: number, total: number) => void;
  onLatencyComplete?: (result: LatencyResult) => void;
  onDownloadSample?: (liveMbps: number, avgMbps: number, sample: ThroughputSample, progress: number) => void;
  onDownloadComplete?: (result: TransferResult) => void;
  onUploadSample?: (liveMbps: number, avgMbps: number, sample: ThroughputSample, progress: number) => void;
  onUploadComplete?: (result: TransferResult) => void;
}

/**
 * Classifies network/CORS/adblocker errors into a clear user-facing message.
 */
export function formatSpeedTestError(err: unknown): string {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return 'Speed test aborted by user.';
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (
    msg.includes('Failed to fetch') ||
    msg.includes('NetworkError') ||
    msg.includes('Load failed') ||
    msg.includes('CORS')
  ) {
    return 'Unable to reach CDN test endpoint (speed.cloudflare.com). A browser adblocker, privacy extension, or corporate firewall may be blocking the request.';
  }
  return msg || 'Speed test failed due to an unexpected network error.';
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  );
}

/**
 * Fetch client public IP, ISP/ASN, and nearest CDN edge node metadata.
 */
export async function fetchNetworkInfo(signal?: AbortSignal): Promise<NetworkInfo> {
  try {
    const res = await fetch(`${SPEED_TEST_CONFIG.endpoints.meta}?t=${Date.now()}`, {
      cache: 'no-store',
      signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      clientIp?: string;
      asn?: number | string;
      asOrganization?: string;
      colo?: string;
      city?: string;
      country?: string;
      region?: string;
    };
    return {
      ip: data.clientIp || 'Unknown',
      asn: data.asn ? `AS${String(data.asn).replace(/^AS/i, '')}` : '—',
      isp: data.asOrganization || 'Unknown ISP',
      colo: data.colo || 'EDGE',
      city: data.city || '',
      country: data.country || '',
      region: data.region || '',
      source: 'cloudflare',
    };
  } catch (err) {
    if (isAbortError(err)) throw err;
    // Fallback to ipapi.co if Cloudflare /meta is unavailable
    const res = await fetch(SPEED_TEST_CONFIG.endpoints.fallbackIp, {
      cache: 'no-store',
      signal,
    });
    if (!res.ok) {
      throw new Error('Failed to fetch network metadata from CDN or fallback API.');
    }
    const data = (await res.json()) as {
      ip?: string;
      asn?: string;
      org?: string;
      city?: string;
      country_name?: string;
      country_code?: string;
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
}

/**
 * Measure median RTT ping (ms) and jitter (mean consecutive variation)
 * using sequential cache-busted 0-byte GET requests.
 */
export async function measureLatency(
  signal: AbortSignal,
  config: SpeedTestConfig = SPEED_TEST_CONFIG,
  onPingSample?: (sampleMs: number, index: number, total: number) => void
): Promise<LatencyResult> {
  const samplesMs: number[] = [];

  for (let i = 0; i < config.pingCount; i++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const url = `${config.endpoints.down}?bytes=0&t=${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`;
    const t0 = performance.now();
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal,
    });
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
 * Measure download throughput using parallel ReadableStream fetch workers.
 * Discards the initial warmupDiscardMs window (TCP slow-start) for final average.
 */
export async function measureDownload(
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

  const worker = async (workerIdx: number) => {
    let iter = 0;
    while (!phaseController.signal.aborted && !signal.aborted && performance.now() < endTime) {
      const url = `${config.endpoints.down}?bytes=${config.downloadBytesPerRequest}&t=${Date.now()}-${workerIdx}-${iter++}`;
      try {
        const res = await fetch(url, {
          method: 'GET',
          cache: 'no-store',
          signal: phaseController.signal,
        });
        if (!res.ok) throw new Error(`Download HTTP ${res.status}`);
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
    await Promise.all(
      Array.from({ length: config.parallelStreams }, (_, i) => worker(i))
    );
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
  // crypto.getRandomValues has a 65,536-byte limit per call
  const chunk = 65536;
  for (let offset = 0; offset < byteLength; offset += chunk) {
    const slice = buf.subarray(offset, Math.min(offset + chunk, byteLength));
    crypto.getRandomValues(slice);
  }
  return new Blob([buf], { type: 'application/octet-stream' });
}

/**
 * Measure upload throughput using parallel XMLHttpRequest POST streams
 * with real-time upload progress events. Discards warmupDiscardMs slow-start.
 */
export async function measureUpload(
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
          reject(new Error(`Upload HTTP ${xhr.status}`));
        }
      });

      xhr.addEventListener('error', () => {
        abortSig.removeEventListener('abort', onAbort);
        reject(new Error('Failed to fetch: upload connection blocked or reset.'));
      });

      xhr.addEventListener('abort', () => {
        abortSig.removeEventListener('abort', onAbort);
        reject(new DOMException('Aborted', 'AbortError'));
      });

      xhr.open('POST', url, true);
      xhr.send(payloadBlob);
    });

  const worker = async (workerIdx: number) => {
    let iter = 0;
    while (!phaseController.signal.aborted && !signal.aborted && performance.now() < endTime) {
      const url = `${config.endpoints.up}?t=${Date.now()}-${workerIdx}-${iter++}`;
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
    await Promise.all(
      Array.from({ length: config.parallelStreams }, (_, i) => worker(i))
    );
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
 * Execute full speed test sequence: Latency -> Download -> Upload.
 */
export async function runSpeedTest(
  signal: AbortSignal,
  callbacks: SpeedTestCallbacks = {},
  networkInfo: NetworkInfo | null = null,
  config: SpeedTestConfig = SPEED_TEST_CONFIG
): Promise<SpeedTestResult> {
  callbacks.onPhaseChange?.('latency');
  const latency = await measureLatency(signal, config, callbacks.onPingSample);
  callbacks.onLatencyComplete?.(latency);

  callbacks.onPhaseChange?.('download');
  const download = await measureDownload(signal, config, callbacks.onDownloadSample);
  callbacks.onDownloadComplete?.(download);

  callbacks.onPhaseChange?.('upload');
  const upload = await measureUpload(signal, config, callbacks.onUploadSample);
  callbacks.onUploadComplete?.(upload);

  callbacks.onPhaseChange?.('complete');
  return {
    timestamp: new Date().toISOString(),
    network: networkInfo,
    latency,
    download,
    upload,
  };
}
