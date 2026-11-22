/**
 * Dedicated Web Worker for M-Lab NDT7 Download & Upload WebSocket streaming.
 *
 * Running the high-frequency WebSocket binary drain & send pump off the main
 * React UI thread prevents Chrome/Edge extension popup rendering from starving
 * TCP receive/send buffers — achieving identical wire-speed throughput in both
 * extension popups and full desktop browser tabs.
 */

export interface Ndt7WorkerStartMessage {
  type: 'start-download' | 'start-upload';
  url: string;
  nodeName: string;
  durationMs: number;
  warmupDiscardMs: number;
  sampleIntervalMs: number;
  connectTimeoutMs: number;
}

export interface Ndt7WorkerAbortMessage {
  type: 'abort';
}

export type Ndt7WorkerInMessage = Ndt7WorkerStartMessage | Ndt7WorkerAbortMessage;

export interface Ndt7WorkerOutMessage {
  type: 'latency' | 'sample' | 'done' | 'error';
  latency?: {
    medianMs: number;
    jitterMs: number;
    minMs: number;
    maxMs: number;
    samplesMs: number[];
  };
  liveMbps?: number;
  avgMbps?: number;
  sample?: { elapsedMs: number; mbps: number };
  progress?: number;
  result?: {
    avgMbps: number;
    peakMbps: number;
    totalBytes: number;
    durationMs: number;
    samples: Array<{ elapsedMs: number; mbps: number }>;
  };
  error?: string;
  aborted?: boolean;
}

interface Ndt7ServerMessage {
  TCPInfo?: {
    RTT?: number;
    MinRTT?: number;
    RTTVar?: number;
    BytesReceived?: number;
    ElapsedTime?: number;
  };
}

let activeAbort: (() => void) | null = null;

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

function runDownload(msg: Ndt7WorkerStartMessage): void {
  const ws = new WebSocket(msg.url, 'net.measurementlab.ndt.v7');
  ws.binaryType = 'arraybuffer';

  const connectStart = performance.now();
  let streamStart = 0;
  let opened = false;
  let settled = false;

  let totalBytes = 0;
  let warmupBytes = 0;
  let warmupCaptured = false;
  let peakMbps = 0;
  const windowEvents: Array<{ time: number; bytes: number }> = [];
  const samples: Array<{ elapsedMs: number; mbps: number }> = [];

  const rttSamplesMs: number[] = [];
  let minRttMs: number | null = null;
  let rttVarMs: number | null = null;
  let handshakeMs: number | null = null;

  let samplerTimer: ReturnType<typeof setInterval> | null = null;
  let stopTimer: ReturnType<typeof setTimeout> | null = null;
  let failsafeTimer: ReturnType<typeof setTimeout> | null = null;
  let connectTimer: ReturnType<typeof setTimeout> | null = null;

  const cleanup = () => {
    if (samplerTimer !== null) clearInterval(samplerTimer);
    if (stopTimer !== null) clearTimeout(stopTimer);
    if (failsafeTimer !== null) clearTimeout(failsafeTimer);
    if (connectTimer !== null) clearTimeout(connectTimer);
    activeAbort = null;
  };

  const buildLatency = () => {
    const base = minRttMs ?? handshakeMs ?? 15;
    const validSamples = rttSamplesMs.length > 0 ? rttSamplesMs : [base];
    const sorted = [...validSamples].sort((a, b) => a - b);
    const jitter = rttVarMs ?? 0;
    return {
      medianMs: Number(base.toFixed(1)),
      jitterMs: Number(jitter.toFixed(1)),
      minMs: Number(Math.min(base, sorted[0]).toFixed(1)),
      maxMs: Number(sorted[sorted.length - 1].toFixed(1)),
      samplesMs: validSamples.map((v) => Number(v.toFixed(1))),
    };
  };

  const finishSuccess = () => {
    if (settled) return;
    settled = true;
    cleanup();

    const totalElapsedMs = Math.max(1, performance.now() - (streamStart || connectStart));
    const measuredBytes =
      warmupCaptured && totalElapsedMs > msg.warmupDiscardMs
        ? Math.max(0, totalBytes - warmupBytes)
        : totalBytes;
    const measuredSec =
      warmupCaptured && totalElapsedMs > msg.warmupDiscardMs
        ? (totalElapsedMs - msg.warmupDiscardMs) / 1000
        : totalElapsedMs / 1000;
    const avgMbps = (measuredBytes * 8) / (Math.max(0.1, measuredSec) * 1_000_000);

    const out: Ndt7WorkerOutMessage = {
      type: 'done',
      latency: buildLatency(),
      result: {
        avgMbps: Number(avgMbps.toFixed(2)),
        peakMbps: Number(Math.max(peakMbps, avgMbps).toFixed(2)),
        totalBytes,
        durationMs: Math.round(totalElapsedMs),
        samples,
      },
    };
    self.postMessage(out);
  };

  const failWith = (error: string, aborted = false) => {
    if (settled) return;
    settled = true;
    cleanup();
    try {
      ws.close();
    } catch {
      // ignore
    }
    const out: Ndt7WorkerOutMessage = { type: 'error', error, aborted };
    self.postMessage(out);
  };

  activeAbort = () => failWith('Aborted', true);

  connectTimer = setTimeout(() => {
    if (!opened) failWith(`WebSocket connect timeout on ${msg.nodeName}`);
  }, msg.connectTimeoutMs);

  ws.onopen = () => {
    opened = true;
    if (connectTimer !== null) clearTimeout(connectTimer);
    streamStart = performance.now();
    handshakeMs = Math.max(0.5, (streamStart - connectStart) / 2);
    self.postMessage({ type: 'latency', latency: buildLatency() } satisfies Ndt7WorkerOutMessage);

    samplerTimer = setInterval(() => {
      const now = performance.now();
      const elapsedMs = now - streamStart;
      if (!warmupCaptured && elapsedMs >= msg.warmupDiscardMs) {
        warmupBytes = totalBytes;
        warmupCaptured = true;
      }
      const liveMbps = computeRollingMbps(windowEvents, now);
      if (liveMbps > peakMbps) peakMbps = liveMbps;

      const effectiveBytes = warmupCaptured ? Math.max(0, totalBytes - warmupBytes) : totalBytes;
      const effectiveSec = warmupCaptured
        ? Math.max(0.1, (elapsedMs - msg.warmupDiscardMs) / 1000)
        : Math.max(0.1, elapsedMs / 1000);
      const avgMbps = (effectiveBytes * 8) / (effectiveSec * 1_000_000);

      const sample = { elapsedMs: Math.round(elapsedMs), mbps: Number(liveMbps.toFixed(2)) };
      samples.push(sample);
      self.postMessage({
        type: 'sample',
        liveMbps: sample.mbps,
        avgMbps: Number(avgMbps.toFixed(2)),
        sample,
        progress: Math.min(1, elapsedMs / msg.durationMs),
      } satisfies Ndt7WorkerOutMessage);
    }, msg.sampleIntervalMs);

    stopTimer = setTimeout(() => {
      try {
        ws.close(1000);
      } catch {
        // ignore
      }
      failsafeTimer = setTimeout(finishSuccess, 800);
    }, msg.durationMs);
  };

  ws.onmessage = (ev) => {
    if (typeof ev.data === 'string') {
      try {
        const parsed = JSON.parse(ev.data) as Ndt7ServerMessage;
        if (parsed.TCPInfo) {
          if (typeof parsed.TCPInfo.MinRTT === 'number' && parsed.TCPInfo.MinRTT > 0) {
            minRttMs = parsed.TCPInfo.MinRTT / 1000;
          }
          if (typeof parsed.TCPInfo.RTT === 'number' && parsed.TCPInfo.RTT > 0) {
            rttSamplesMs.push(parsed.TCPInfo.RTT / 1000);
          }
          if (typeof parsed.TCPInfo.RTTVar === 'number' && parsed.TCPInfo.RTTVar >= 0) {
            rttVarMs = parsed.TCPInfo.RTTVar / 1000;
          }
          self.postMessage({ type: 'latency', latency: buildLatency() } satisfies Ndt7WorkerOutMessage);
        }
      } catch {
        // ignore
      }
    } else if (ev.data instanceof ArrayBuffer) {
      const size = ev.data.byteLength;
      if (size > 0) {
        totalBytes += size;
        windowEvents.push({ time: performance.now(), bytes: size });
      }
    }
  };

  ws.onclose = () => {
    if (!opened || totalBytes === 0) {
      failWith(`WebSocket download closed without data on ${msg.nodeName}`);
    } else {
      finishSuccess();
    }
  };

  ws.onerror = () => {
    if (totalBytes > 0) finishSuccess();
    else failWith(`WebSocket download error on ${msg.nodeName}`);
  };
}

function runUpload(msg: Ndt7WorkerStartMessage): void {
  // 256 KB random payload (filled in 64 KB crypto slices) for low syscall overhead
  const chunk = new Uint8Array(262144);
  for (let offset = 0; offset < chunk.length; offset += 65536) {
    crypto.getRandomValues(chunk.subarray(offset, offset + 65536));
  }

  const ws = new WebSocket(msg.url, 'net.measurementlab.ndt.v7');

  let streamStart = 0;
  let opened = false;
  let pumping = false;
  let settled = false;

  let sentBytes = 0;
  let prevDeliveredBytes = 0;
  let warmupBytes = 0;
  let warmupCaptured = false;
  let peakMbps = 0;
  let serverBytes = 0;
  let serverElapsedUs = 0;

  const windowEvents: Array<{ time: number; bytes: number }> = [];
  const samples: Array<{ elapsedMs: number; mbps: number }> = [];

  let pumpTimer: ReturnType<typeof setTimeout> | null = null;
  let samplerTimer: ReturnType<typeof setInterval> | null = null;
  let stopTimer: ReturnType<typeof setTimeout> | null = null;
  let failsafeTimer: ReturnType<typeof setTimeout> | null = null;
  let connectTimer: ReturnType<typeof setTimeout> | null = null;

  const cleanup = () => {
    pumping = false;
    if (pumpTimer !== null) clearTimeout(pumpTimer);
    if (samplerTimer !== null) clearInterval(samplerTimer);
    if (stopTimer !== null) clearTimeout(stopTimer);
    if (failsafeTimer !== null) clearTimeout(failsafeTimer);
    if (connectTimer !== null) clearTimeout(connectTimer);
    activeAbort = null;
  };

  const finishSuccess = () => {
    if (settled) return;
    settled = true;
    cleanup();

    const totalElapsedMs = Math.max(1, performance.now() - (streamStart || performance.now()));
    const deliveredBytes = Math.max(prevDeliveredBytes, sentBytes - ws.bufferedAmount);

    let avgMbps: number;
    if (serverBytes > 0 && serverElapsedUs > 0) {
      avgMbps = (serverBytes * 8) / serverElapsedUs;
    } else {
      const measuredBytes =
        warmupCaptured && totalElapsedMs > msg.warmupDiscardMs
          ? Math.max(0, deliveredBytes - warmupBytes)
          : deliveredBytes;
      const measuredSec =
        warmupCaptured && totalElapsedMs > msg.warmupDiscardMs
          ? (totalElapsedMs - msg.warmupDiscardMs) / 1000
          : totalElapsedMs / 1000;
      avgMbps = (measuredBytes * 8) / (Math.max(0.1, measuredSec) * 1_000_000);
    }

    self.postMessage({
      type: 'done',
      result: {
        avgMbps: Number(avgMbps.toFixed(2)),
        peakMbps: Number(Math.max(peakMbps, avgMbps).toFixed(2)),
        totalBytes: serverBytes || deliveredBytes,
        durationMs: Math.round(totalElapsedMs),
        samples,
      },
    } satisfies Ndt7WorkerOutMessage);
  };

  const failWith = (error: string, aborted = false) => {
    if (settled) return;
    settled = true;
    cleanup();
    try {
      ws.close();
    } catch {
      // ignore
    }
    self.postMessage({ type: 'error', error, aborted } satisfies Ndt7WorkerOutMessage);
  };

  activeAbort = () => failWith('Aborted', true);

  connectTimer = setTimeout(() => {
    if (!opened) failWith(`WebSocket upload connect timeout on ${msg.nodeName}`);
  }, msg.connectTimeoutMs);

  // Keep 4 MB queued in the WebSocket send buffer inside the dedicated worker thread
  const HIGH_WATER_BYTES = 4 * 1024 * 1024;
  const pump = () => {
    if (!pumping || ws.readyState !== WebSocket.OPEN) return;
    while (ws.bufferedAmount < HIGH_WATER_BYTES) {
      ws.send(chunk);
      sentBytes += chunk.byteLength;
    }
    pumpTimer = setTimeout(pump, 1);
  };

  ws.onopen = () => {
    opened = true;
    if (connectTimer !== null) clearTimeout(connectTimer);
    streamStart = performance.now();
    pumping = true;
    pump();

    samplerTimer = setInterval(() => {
      const now = performance.now();
      const elapsedMs = now - streamStart;
      const delivered = Math.max(prevDeliveredBytes, sentBytes - ws.bufferedAmount);
      const delta = Math.max(0, delivered - prevDeliveredBytes);
      prevDeliveredBytes = delivered;

      if (delta > 0) {
        windowEvents.push({ time: now, bytes: delta });
      }
      if (!warmupCaptured && elapsedMs >= msg.warmupDiscardMs) {
        warmupBytes = delivered;
        warmupCaptured = true;
      }

      const liveMbps = computeRollingMbps(windowEvents, now);
      if (liveMbps > peakMbps) peakMbps = liveMbps;

      const effectiveBytes = warmupCaptured ? Math.max(0, delivered - warmupBytes) : delivered;
      const effectiveSec = warmupCaptured
        ? Math.max(0.1, (elapsedMs - msg.warmupDiscardMs) / 1000)
        : Math.max(0.1, elapsedMs / 1000);
      const avgMbps =
        serverBytes > 0 && serverElapsedUs > 0
          ? (serverBytes * 8) / serverElapsedUs
          : (effectiveBytes * 8) / (effectiveSec * 1_000_000);

      const sample = { elapsedMs: Math.round(elapsedMs), mbps: Number(liveMbps.toFixed(2)) };
      samples.push(sample);
      self.postMessage({
        type: 'sample',
        liveMbps: sample.mbps,
        avgMbps: Number(avgMbps.toFixed(2)),
        sample,
        progress: Math.min(1, elapsedMs / msg.durationMs),
      } satisfies Ndt7WorkerOutMessage);
    }, msg.sampleIntervalMs);

    stopTimer = setTimeout(() => {
      pumping = false;
      try {
        ws.close(1000);
      } catch {
        // ignore
      }
      failsafeTimer = setTimeout(finishSuccess, 800);
    }, msg.durationMs);
  };

  ws.onmessage = (ev) => {
    if (typeof ev.data === 'string') {
      try {
        const parsed = JSON.parse(ev.data) as Ndt7ServerMessage;
        if (parsed.TCPInfo?.BytesReceived) serverBytes = parsed.TCPInfo.BytesReceived;
        if (parsed.TCPInfo?.ElapsedTime) serverElapsedUs = parsed.TCPInfo.ElapsedTime;
      } catch {
        // ignore
      }
    }
  };

  ws.onclose = () => {
    if (!opened || (sentBytes === 0 && serverBytes === 0)) {
      failWith(`WebSocket upload closed without data on ${msg.nodeName}`);
    } else {
      finishSuccess();
    }
  };

  ws.onerror = () => {
    if (sentBytes > 0 || serverBytes > 0) finishSuccess();
    else failWith(`WebSocket upload error on ${msg.nodeName}`);
  };
}

self.onmessage = (ev: MessageEvent<Ndt7WorkerInMessage>) => {
  const msg = ev.data;
  if (msg.type === 'abort') {
    activeAbort?.();
    return;
  }
  activeAbort?.();
  if (msg.type === 'start-download') {
    runDownload(msg);
  } else if (msg.type === 'start-upload') {
    runUpload(msg);
  }
};
