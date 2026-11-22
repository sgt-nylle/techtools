import React, { useEffect, useRef, useState } from 'react';
import type { SpeedTestPhase } from '../tools/speedTestEngine';

interface CassetteVuMeterProps {
  phase: SpeedTestPhase;
  downloadMbps: number;
  uploadMbps: number;
  downloadPeakMbps: number;
  uploadPeakMbps: number;
}

const TOTAL_SEGMENTS = 36;

// Logarithmic-inspired scale ticks across the 36 VFD/LED segments (0 to 1000+ Mbps)
const SCALE_TICKS = [
  { label: '0', pos: 0 },
  { label: '5', pos: 14 },
  { label: '25', pos: 32 },
  { label: '100', pos: 54 },
  { label: '250', pos: 70 },
  { label: '500', pos: 84 },
  { label: '1G+', pos: 98 },
];

/**
 * Maps Mbps (0..1200+) onto 0..TOTAL_SEGMENTS using a smooth log curve
 * so both 10 Mbps DSL and 1000 Mbps fiber produce expressive VU movement.
 */
function mbpsToSegments(mbps: number): number {
  if (mbps <= 0) return 0;
  // log10(1 + mbps) / log10(1 + 1100) gives ~0.26 at 5 Mbps, ~0.66 at 100 Mbps, ~0.89 at 500 Mbps, ~0.99 at 1000 Mbps
  const norm = Math.min(1, Math.log10(1 + mbps) / Math.log10(1 + 1100));
  return Math.max(1, Math.round(norm * TOTAL_SEGMENTS));
}

function getZoneClass(index: number): 'vu-zone-green' | 'vu-zone-amber' | 'vu-zone-red' {
  if (index >= 30) return 'vu-zone-red'; // +3dB / >500 Mbps overdrive zone
  if (index >= 21) return 'vu-zone-amber'; // 0dB / 100-500 Mbps nominal hot zone
  return 'vu-zone-green'; // -20dB..0dB safe phosphor zone
}

function usePeakHold(valueMbps: number, active: boolean): number {
  const [decayedPeak, setDecayedPeak] = useState<number>(0);
  const peakRef = useRef<number>(0);
  const holdUntilRef = useRef<number>(0);
  const currentSeg = mbpsToSegments(valueMbps);

  useEffect(() => {
    if (currentSeg >= peakRef.current) {
      peakRef.current = currentSeg;
      holdUntilRef.current = Date.now() + 1100;
    }
  }, [currentSeg]);

  useEffect(() => {
    if (!active && currentSeg === 0 && decayedPeak === 0) return;
    const timer = window.setInterval(() => {
      if (Date.now() > holdUntilRef.current && peakRef.current > 0) {
        peakRef.current = peakRef.current - 1;
      }
      setDecayedPeak(peakRef.current);
    }, 90);
    return () => window.clearInterval(timer);
  }, [active, currentSeg, decayedPeak]);

  return Math.max(currentSeg, decayedPeak);
}

export const CassetteVuMeter: React.FC<CassetteVuMeterProps> = ({
  phase,
  downloadMbps,
  uploadMbps,
  downloadPeakMbps,
  uploadPeakMbps,
}) => {
  const dlSegs = mbpsToSegments(downloadMbps);
  const ulSegs = mbpsToSegments(uploadMbps);
  const dlPeakHold = usePeakHold(downloadMbps, phase === 'download');
  const ulPeakHold = usePeakHold(uploadMbps, phase === 'upload');

  const renderChannel = (
    channelTag: string,
    label: string,
    mbps: number,
    peakMbps: number,
    litSegments: number,
    peakHoldSeg: number,
    isLive: boolean
  ) => (
    <div className={`vu-channel-row ${isLive ? 'vu-channel-live' : ''}`}>
      <div className="vu-ch-meta">
        <span className="vu-ch-tag">{channelTag}</span>
        <span className="vu-ch-name">{label}</span>
        <span className={`vu-ch-lamp ${isLive ? 'lamp-on' : ''}`} aria-hidden="true" />
      </div>

      <div className="vu-bar-track" role="meter" aria-label={`${label} speed`} aria-valuenow={mbps} aria-valuemin={0} aria-valuemax={1000}>
        {Array.from({ length: TOTAL_SEGMENTS }, (_, idx) => {
          const isLit = idx < litSegments;
          const isPeak = peakHoldSeg > 0 && idx === peakHoldSeg - 1;
          const zone = getZoneClass(idx);
          return (
            <span
              key={idx}
              className={`vu-seg ${zone} ${isLit ? 'lit' : ''} ${isPeak ? 'peak-hold' : ''}`}
            />
          );
        })}
      </div>

      <div className="vu-digital-readout">
        <span className="vu-digits">{mbps > 0 ? mbps.toFixed(1).padStart(5, '0') : '000.0'}</span>
        <span className="vu-unit">Mbps</span>
        <span className="vu-peak-sub">PK {peakMbps > 0 ? peakMbps.toFixed(1) : '0.0'}</span>
      </div>
    </div>
  );

  return (
    <div className="vu-deck-chassis clean-box">
      <div className="vu-deck-header">
        <div className="vu-deck-title">
          <span className="vu-rec-dot" data-active={phase === 'download' || phase === 'upload'} />
          <span>VFD PEAK LEVEL METER // STEREO LINK TELEMETRY (1984 DECK)</span>
        </div>
        <div className="vu-deck-mode">
          MODE:{' '}
          <strong>
            {phase === 'idle' && 'STANDBY'}
            {phase === 'latency' && 'PING / SYNC'}
            {phase === 'download' && 'REC ● RX DOWN'}
            {phase === 'upload' && 'REC ● TX UP'}
            {phase === 'complete' && 'PLAYBACK HOLD'}
            {phase === 'aborted' && 'STOP / ABORT'}
            {phase === 'error' && 'LINK FAULT'}
          </strong>
        </div>
      </div>

      <div className="vu-scale-ruler" aria-hidden="true">
        <div className="vu-scale-spacer-left" />
        <div className="vu-scale-ticks">
          {SCALE_TICKS.map((t) => (
            <span
              key={t.label}
              className={`vu-tick ${t.pos >= 80 ? 'vu-tick-hot' : ''}`}
              style={{ left: `${t.pos}%` }}
            >
              {t.label}
            </span>
          ))}
        </div>
        <div className="vu-scale-spacer-right">Mbps</div>
      </div>

      <div className="vu-channels-stack">
        {renderChannel(
          'CH-L',
          'RX DOWN',
          downloadMbps,
          downloadPeakMbps,
          dlSegs,
          dlPeakHold,
          phase === 'download'
        )}
        {renderChannel(
          'CH-R',
          'TX UP',
          uploadMbps,
          uploadPeakMbps,
          ulSegs,
          ulPeakHold,
          phase === 'upload'
        )}
      </div>
    </div>
  );
};

export default CassetteVuMeter;
