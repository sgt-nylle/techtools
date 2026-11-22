import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CassetteVuMeter } from '../components/CassetteVuMeter';
import { CopyableIntelSection } from '../components/CopyableIntelSection';
import { sound } from '../utils/audio';
import { useIsPaneActive } from '../utils/paneContext';
import {
  SPEED_TEST_CONFIG,
  fetchNetworkInfo,
  formatSpeedTestError,
  runSpeedTest,
  type LatencyResult,
  type NetworkInfo,
  type SpeedTestPhase,
  type SpeedTestResult,
  type ThroughputSample,
  type TransferResult,
} from './speedTestEngine';

function buildSvgPolyline(samples: ThroughputSample[], maxMbps: number, maxElapsedMs: number, width: number, height: number): string {
  if (samples.length === 0) return '';
  const safeMaxMbps = Math.max(10, maxMbps);
  const safeMaxMs = Math.max(1000, maxElapsedMs);
  return samples
    .map((s) => {
      const x = Math.min(width, Math.max(0, (s.elapsedMs / safeMaxMs) * width));
      const y = height - Math.min(height, Math.max(0, (s.mbps / safeMaxMbps) * (height - 8))) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export const SpeedTestTool: React.FC = () => {
  const isPaneActive = useIsPaneActive();

  const [phase, setPhase] = useState<SpeedTestPhase>('idle');
  const [phaseProgress, setPhaseProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);
  const [networkLoading, setNetworkLoading] = useState<boolean>(true);
  const [networkError, setNetworkError] = useState<string | null>(null);

  const [pingMs, setPingMs] = useState<number | null>(null);
  const [jitterMs, setJitterMs] = useState<number | null>(null);
  const [latencyDetail, setLatencyDetail] = useState<LatencyResult | null>(null);

  const [liveDownMbps, setLiveDownMbps] = useState<number>(0);
  const [avgDownMbps, setAvgDownMbps] = useState<number | null>(null);
  const [peakDownMbps, setPeakDownMbps] = useState<number>(0);
  const [downSamples, setDownSamples] = useState<ThroughputSample[]>([]);
  const [downDetail, setDownDetail] = useState<TransferResult | null>(null);

  const [liveUpMbps, setLiveUpMbps] = useState<number>(0);
  const [avgUpMbps, setAvgUpMbps] = useState<number | null>(null);
  const [peakUpMbps, setPeakUpMbps] = useState<number>(0);
  const [upSamples, setUpSamples] = useState<ThroughputSample[]>([]);
  const [upDetail, setUpDetail] = useState<TransferResult | null>(null);

  const [lastResult, setLastResult] = useState<SpeedTestResult | null>(null);
  const [copiedMode, setCopiedMode] = useState<'text' | 'json' | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef<boolean>(true);

  const isRunning = phase === 'latency' || phase === 'download' || phase === 'upload';

  const loadNetworkMeta = useCallback(async () => {
    setNetworkLoading(true);
    setNetworkError(null);
    try {
      const info = await fetchNetworkInfo();
      if (mountedRef.current) {
        setNetworkInfo(info);
      }
    } catch (err) {
      if (mountedRef.current) {
        setNetworkError(formatSpeedTestError(err));
      }
    } finally {
      if (mountedRef.current) {
        setNetworkLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    fetchNetworkInfo(controller.signal)
      .then((info) => {
        if (mountedRef.current) setNetworkInfo(info);
      })
      .catch((err) => {
        if (mountedRef.current && !(err instanceof DOMException && err.name === 'AbortError')) {
          setNetworkError(formatSpeedTestError(err));
        }
      })
      .finally(() => {
        if (mountedRef.current) setNetworkLoading(false);
      });
    return () => {
      mountedRef.current = false;
      controller.abort();
      abortRef.current?.abort();
    };
  }, []);

  const handleAbort = useCallback(() => {
    if (!abortRef.current) return;
    abortRef.current.abort();
    abortRef.current = null;
    sound.playClick();
    setPhase('aborted');
    setPhaseProgress(0);
  }, []);

  const handleStartTest = useCallback(async () => {
    if (isRunning) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    sound.playRadarPing();
    setError(null);
    setPhase('latency');
    setPhaseProgress(0);

    setPingMs(null);
    setJitterMs(null);
    setLatencyDetail(null);

    setLiveDownMbps(0);
    setAvgDownMbps(null);
    setPeakDownMbps(0);
    setDownSamples([]);
    setDownDetail(null);

    setLiveUpMbps(0);
    setAvgUpMbps(null);
    setPeakUpMbps(0);
    setUpSamples([]);
    setUpDetail(null);
    setLastResult(null);

    let activeNetInfo = networkInfo;
    if (!activeNetInfo) {
      try {
        activeNetInfo = await fetchNetworkInfo(controller.signal);
        if (mountedRef.current) {
          setNetworkInfo(activeNetInfo);
          setNetworkError(null);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        // Continue test even if metadata endpoint fails; __down/__up will surface real connectivity error if blocked
      }
    }

    try {
      const result = await runSpeedTest(
        controller.signal,
        {
          onPhaseChange: (nextPhase) => {
            if (!mountedRef.current) return;
            setPhase(nextPhase);
            setPhaseProgress(0);
          },
          onPingSample: (sampleMs, idx, total) => {
            if (!mountedRef.current) return;
            setPingMs(Number(sampleMs.toFixed(1)));
            setPhaseProgress(idx / total);
          },
          onLatencyComplete: (lat) => {
            if (!mountedRef.current) return;
            setPingMs(lat.medianMs);
            setJitterMs(lat.jitterMs);
            setLatencyDetail(lat);
            setPhaseProgress(1);
          },
          onDownloadSample: (live, avg, sample, progress) => {
            if (!mountedRef.current) return;
            setLiveDownMbps(live);
            setAvgDownMbps(avg);
            setPeakDownMbps((prev) => Math.max(prev, live));
            setDownSamples((prev) => [...prev, sample]);
            setPhaseProgress(progress);
          },
          onDownloadComplete: (dl) => {
            if (!mountedRef.current) return;
            setLiveDownMbps(dl.avgMbps);
            setAvgDownMbps(dl.avgMbps);
            setPeakDownMbps(dl.peakMbps);
            setDownDetail(dl);
            setPhaseProgress(1);
          },
          onUploadSample: (live, avg, sample, progress) => {
            if (!mountedRef.current) return;
            setLiveUpMbps(live);
            setAvgUpMbps(avg);
            setPeakUpMbps((prev) => Math.max(prev, live));
            setUpSamples((prev) => [...prev, sample]);
            setPhaseProgress(progress);
          },
          onUploadComplete: (ul) => {
            if (!mountedRef.current) return;
            setLiveUpMbps(ul.avgMbps);
            setAvgUpMbps(ul.avgMbps);
            setPeakUpMbps(ul.peakMbps);
            setUpDetail(ul);
            setPhaseProgress(1);
          },
        },
        activeNetInfo,
        SPEED_TEST_CONFIG
      );

      if (mountedRef.current) {
        setLastResult(result);
        sound.playBlip();
      }
    } catch (err) {
      if (!mountedRef.current) return;
      if (err instanceof DOMException && err.name === 'AbortError') {
        setPhase('aborted');
        return;
      }
      setPhase('error');
      setError(formatSpeedTestError(err));
      sound.playError();
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [isRunning, networkInfo]);

  const summaryText = useMemo(() => {
    const net = networkInfo;
    const dl = avgDownMbps !== null ? `${avgDownMbps.toFixed(2)} Mbps` : '—';
    const ul = avgUpMbps !== null ? `${avgUpMbps.toFixed(2)} Mbps` : '—';
    const ping = pingMs !== null ? `${pingMs.toFixed(1)} ms` : '—';
    const jitter = jitterMs !== null ? `${jitterMs.toFixed(1)} ms` : '—';
    return [
      'TECHTOOLS // CDN EDGE SPEED TEST',
      `Timestamp : ${lastResult?.timestamp || 'Live / In-Progress'}`,
      `Public IP : ${net?.ip || '—'}`,
      `ISP / ASN : ${net ? `${net.isp} (${net.asn})` : '—'}`,
      `Edge Node : ${net ? `${net.colo} (${[net.city, net.country].filter(Boolean).join(', ') || 'Anycast'})` : '—'}`,
      `Download  : ${dl} (Peak ${peakDownMbps.toFixed(2)} Mbps)`,
      `Upload    : ${ul} (Peak ${peakUpMbps.toFixed(2)} Mbps)`,
      `Ping      : ${ping}`,
      `Jitter    : ${jitter}`,
    ].join('\n');
  }, [networkInfo, avgDownMbps, avgUpMbps, pingMs, jitterMs, peakDownMbps, peakUpMbps, lastResult]);

  const summaryJson = useMemo(() => {
    const payload = lastResult ?? {
      timestamp: null,
      network: networkInfo,
      latency: latencyDetail,
      download: downDetail ?? { avgMbps: avgDownMbps, peakMbps: peakDownMbps },
      upload: upDetail ?? { avgMbps: avgUpMbps, peakMbps: peakUpMbps },
    };
    return JSON.stringify(payload, null, 2);
  }, [lastResult, networkInfo, latencyDetail, downDetail, upDetail, avgDownMbps, avgUpMbps, peakDownMbps, peakUpMbps]);

  const handleCopy = useCallback(
    async (mode: 'text' | 'json') => {
      try {
        await navigator.clipboard.writeText(mode === 'json' ? summaryJson : summaryText);
        sound.playCopy();
        setCopiedMode(mode);
        window.setTimeout(() => setCopiedMode(null), 1600);
      } catch {
        sound.playError();
      }
    },
    [summaryJson, summaryText]
  );

  // Scoped single-letter keyboard shortcuts
  useEffect(() => {
    if (!isPaneActive) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const isTextInput =
        (target?.tagName === 'INPUT' &&
          (target as HTMLInputElement).type !== 'checkbox' &&
          (target as HTMLInputElement).type !== 'range') ||
        target?.tagName === 'TEXTAREA' ||
        Boolean(target?.isContentEditable);
      if (isTextInput) return;

      const k = e.key.toLowerCase();

      if (k === 'r' || e.code === 'KeyR') {
        e.preventDefault();
        void handleStartTest();
      } else if (k === 'a' || e.code === 'KeyA') {
        if (isRunning) {
          e.preventDefault();
          handleAbort();
        }
      } else if (k === 'c' || e.code === 'KeyC') {
        e.preventDefault();
        void handleCopy('text');
      } else if (k === 'm' || e.code === 'KeyM') {
        if (!isRunning && !networkLoading) {
          e.preventDefault();
          sound.playClick();
          void loadNetworkMeta();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPaneActive, isRunning, networkLoading, handleStartTest, handleAbort, handleCopy, loadNetworkMeta]);

  const chartMaxMbps = useMemo(() => {
    const maxVal = Math.max(
      25,
      peakDownMbps,
      peakUpMbps,
      ...downSamples.map((s) => s.mbps),
      ...upSamples.map((s) => s.mbps)
    );
    return Math.ceil(maxVal / 25) * 25;
  }, [peakDownMbps, peakUpMbps, downSamples, upSamples]);

  const downPolyline = useMemo(
    () => buildSvgPolyline(downSamples, chartMaxMbps, SPEED_TEST_CONFIG.downloadDurationMs, 640, 120),
    [downSamples, chartMaxMbps]
  );
  const upPolyline = useMemo(
    () => buildSvgPolyline(upSamples, chartMaxMbps, SPEED_TEST_CONFIG.uploadDurationMs, 640, 120),
    [upSamples, chartMaxMbps]
  );

  const vuDownloadDisplay = phase === 'download' ? liveDownMbps : (avgDownMbps ?? 0);
  const vuUploadDisplay = phase === 'upload' ? liveUpMbps : (avgUpMbps ?? 0);

  return (
    <div className="tool-panel speed-test-panel">
      {/* ACTION BAR & CONTROLS */}
      <div className="clean-box speed-controls-bar">
        <div className="speed-controls-left">
          <button
            type="button"
            className="navy-btn btn-primary"
            disabled={isRunning}
            onClick={() => void handleStartTest()}
          >
            {isRunning ? `⏳ TESTING (${phase.toUpperCase()})...` : '► START TEST [R]'}
          </button>

          {isRunning && (
            <button type="button" className="navy-btn btn-danger" onClick={handleAbort}>
              ■ ABORT [A]
            </button>
          )}

          <button
            type="button"
            className="navy-btn"
            disabled={isRunning || networkLoading}
            onClick={() => {
              sound.playClick();
              void loadNetworkMeta();
            }}
          >
            ⟳ REFRESH NODE [M]
          </button>
        </div>

        <div className="speed-controls-right">
          <button
            type="button"
            className={`navy-btn btn-sm ${copiedMode === 'text' ? 'btn-copied' : ''}`}
            onClick={() => void handleCopy('text')}
          >
            {copiedMode === 'text' ? '✓ COPIED TEXT!' : '📋 COPY TEXT [C]'}
          </button>
          <button
            type="button"
            className={`navy-btn btn-sm ${copiedMode === 'json' ? 'btn-copied' : ''}`}
            onClick={() => void handleCopy('json')}
          >
            {copiedMode === 'json' ? '✓ COPIED JSON!' : '{} COPY JSON'}
          </button>
        </div>
      </div>

      {/* PHASE PROGRESS BAR */}
      {isRunning && (
        <div className="speed-progress-wrap clean-box" aria-label="Test progress">
          <div className="speed-progress-meta">
            <span>
              ACTIVE PHASE: <strong className="text-cyan">{phase.toUpperCase()}</strong> ({SPEED_TEST_CONFIG.parallelStreams} STREAMS • ANYCAST EDGE)
            </span>
            <span>{Math.round(phaseProgress * 100)}%</span>
          </div>
          <div className="speed-progress-track">
            <div className="speed-progress-fill" style={{ width: `${Math.round(phaseProgress * 100)}%` }} />
          </div>
        </div>
      )}

      {/* NETWORK & EDGE NODE TELEMETRY STRIP */}
      <div className="telemetry-strip clean-box">
        <div className="tele-cell">
          <span className="tele-lbl">CLIENT PUBLIC IP</span>
          <span className="tele-val text-gold">
            {networkLoading ? 'SCANNING...' : networkInfo?.ip || 'Unavailable'}
          </span>
        </div>
        <div className="tele-cell">
          <span className="tele-lbl">ISP / ASN</span>
          <span className="tele-val text-cyan">
            {networkLoading
              ? '...'
              : networkInfo
                ? `${networkInfo.isp} (${networkInfo.asn})`
                : '—'}
          </span>
        </div>
        <div className="tele-cell">
          <span className="tele-lbl">CDN EDGE NODE</span>
          <span className="tele-val">
            {networkInfo
              ? `${networkInfo.colo}${networkInfo.city || networkInfo.country ? ` — ${[networkInfo.city, networkInfo.country].filter(Boolean).join(', ')}` : ''}`
              : '—'}
          </span>
        </div>
        <div className="tele-cell">
          <span className="tele-lbl">TEST METHOD</span>
          <span className="tele-val status-ok">
            {SPEED_TEST_CONFIG.parallelStreams}x PARALLEL BROWSER→CDN
          </span>
        </div>
      </div>

      {/* ERROR / BLOCKER ALERT */}
      {(error || networkError) && (
        <div className="clean-box alert-banner" role="alert">
          <strong>⚠ CONNECTION / CORS NOTICE:</strong> {error || networkError}
        </div>
      )}

      {/* 80s CASSETTE DECK DIGITAL VU METER */}
      <CassetteVuMeter
        phase={phase}
        downloadMbps={vuDownloadDisplay}
        uploadMbps={vuUploadDisplay}
        downloadPeakMbps={peakDownMbps}
        uploadPeakMbps={peakUpMbps}
      />

      {/* 4 DISTINCT TELEMETRY CARDS */}
      <div className="speed-cards-grid">
        <div className={`speed-metric-card clean-box ${phase === 'download' ? 'card-active-cyan' : ''}`}>
          <span className="tele-lbl">DOWNLOAD</span>
          <div className="speed-card-val text-cyan">
            {avgDownMbps !== null ? avgDownMbps.toFixed(1) : '--.-'} <span className="speed-card-unit">Mbps</span>
          </div>
          <span className="speed-card-sub">
            Peak: {peakDownMbps > 0 ? `${peakDownMbps.toFixed(1)} Mbps` : '—'}
          </span>
        </div>

        <div className={`speed-metric-card clean-box ${phase === 'upload' ? 'card-active-gold' : ''}`}>
          <span className="tele-lbl">UPLOAD</span>
          <div className="speed-card-val text-gold">
            {avgUpMbps !== null ? avgUpMbps.toFixed(1) : '--.-'} <span className="speed-card-unit">Mbps</span>
          </div>
          <span className="speed-card-sub">
            Peak: {peakUpMbps > 0 ? `${peakUpMbps.toFixed(1)} Mbps` : '—'}
          </span>
        </div>

        <div className={`speed-metric-card clean-box ${phase === 'latency' ? 'card-active-cyan' : ''}`}>
          <span className="tele-lbl">PING (MEDIAN)</span>
          <div className="speed-card-val status-ok">
            {pingMs !== null ? pingMs.toFixed(1) : '--.-'} <span className="speed-card-unit">ms</span>
          </div>
          <span className="speed-card-sub">
            {latencyDetail ? `Min ${latencyDetail.minMs} / Max ${latencyDetail.maxMs} ms` : `${SPEED_TEST_CONFIG.pingCount} cache-busted probes`}
          </span>
        </div>

        <div className="speed-metric-card clean-box">
          <span className="tele-lbl">JITTER</span>
          <div className="speed-card-val">
            {jitterMs !== null ? jitterMs.toFixed(1) : '--.-'} <span className="speed-card-unit">ms</span>
          </div>
          <span className="speed-card-sub">Mean consecutive RTT delta</span>
        </div>
      </div>

      {/* LIVE THROUGHPUT CHART */}
      <CopyableIntelSection
        title="► REAL-TIME THROUGHPUT TRACE (DOWNLOAD vs UPLOAD)"
        copyPayload={summaryText}
      >
        <div className="speed-chart-header">
          <span className="speed-legend-item">
            <span className="legend-swatch swatch-down" /> DOWNLOAD ({avgDownMbps !== null ? `${avgDownMbps.toFixed(1)} Mbps` : 'idle'})
          </span>
          <span className="speed-legend-item">
            <span className="legend-swatch swatch-up" /> UPLOAD ({avgUpMbps !== null ? `${avgUpMbps.toFixed(1)} Mbps` : 'idle'})
          </span>
          <span className="speed-chart-scale">SCALE: 0 – {chartMaxMbps} Mbps</span>
        </div>

        <div className="speed-chart-box">
          <svg viewBox="0 0 640 120" className="speed-svg-chart" preserveAspectRatio="none" role="img" aria-label="Live download and upload throughput chart">
            <line x1="0" y1="30" x2="640" y2="30" className="chart-grid-line" />
            <line x1="0" y1="60" x2="640" y2="60" className="chart-grid-line" />
            <line x1="0" y1="90" x2="640" y2="90" className="chart-grid-line" />
            {downPolyline && (
              <polyline fill="none" className="chart-line-down" points={downPolyline} />
            )}
            {upPolyline && (
              <polyline fill="none" className="chart-line-up" points={upPolyline} />
            )}
          </svg>
          {downSamples.length === 0 && upSamples.length === 0 && (
            <div className="speed-chart-empty">
              PRESS <strong>START TEST [R]</strong> TO MEASURE AGAINST NEAREST ANYCAST CDN EDGE
            </div>
          )}
        </div>
      </CopyableIntelSection>
    </div>
  );
};

export default SpeedTestTool;
