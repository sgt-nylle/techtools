import React, { useId, useMemo } from 'react';
import { WORLD_LAND_PATH, WORLD_MAP_HEIGHT as H, WORLD_MAP_WIDTH as W } from '../tools/geo/worldLand';

export interface RadarPoint {
  lat: number;
  lon: number;
  label?: string;
}

interface RadarMapProps {
  /** Primary contact (IP registry location). */
  target: RadarPoint | null;
  /** Active CDN edge POP (plotted with a dashed vector to the target when present). */
  edge?: RadarPoint | null;
  /** Additional resolved IPs (secondary contacts). */
  extras?: RadarPoint[];
  /** Show the idle sweep centred on the map while a lookup is in flight. */
  scanning?: boolean;
}

/** Equirectangular projection onto viewBox "0 0 1000 500". */
function projectLatLon(lat: number, lon: number): { x: number; y: number } {
  return { x: (lon + 180) * (W / 360), y: (90 - lat) * (H / 180) };
}

const SWEEP_RADIUS = 340;
const SWEEP_ANGLE_DEG = 46;
const MERIDIANS = Array.from({ length: 25 }, (_, i) => -180 + i * 15);
const PARALLELS = Array.from({ length: 13 }, (_, i) => -90 + i * 15);
const LAT_LABELS = [60, 30, 0, -30, -60];
const LON_LABELS = [-120, -60, 0, 60, 120];

function sweepPath(): string {
  const a = (SWEEP_ANGLE_DEG * Math.PI) / 180;
  const x2 = SWEEP_RADIUS * Math.cos(a);
  const y2 = SWEEP_RADIUS * Math.sin(a);
  return `M0 0 L${SWEEP_RADIUS} 0 A${SWEEP_RADIUS} ${SWEEP_RADIUS} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z`;
}

const SWEEP_D = sweepPath();

/** Gentle arc between HQ and edge POP (quadratic curve lifted towards the pole). */
function vectorPath(t: { x: number; y: number } | null, e: { x: number; y: number } | null): string | null {
  if (!t || !e) return null;
  const dist = Math.hypot(e.x - t.x, e.y - t.y);
  if (dist < 4) return null;
  const mx = (t.x + e.x) / 2;
  const my = (t.y + e.y) / 2 - Math.min(120, dist * 0.22);
  return `M${t.x.toFixed(1)} ${t.y.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${e.x.toFixed(1)} ${e.y.toFixed(1)}`;
}

function formatLatLabel(lat: number): string {
  if (lat === 0) return 'EQ';
  return `${Math.abs(lat)}°${lat > 0 ? 'N' : 'S'}`;
}

function formatLonLabel(lon: number): string {
  if (lon === 0) return '0°';
  return `${Math.abs(lon)}°${lon > 0 ? 'E' : 'W'}`;
}

/**
 * Self-contained equirectangular SVG world radar (zero external tiles / requests).
 * All colours come from the active theme's CSS variables (see .radar-* rules in App.css).
 */
export const RadarMap: React.FC<RadarMapProps> = ({ target, edge, extras = [], scanning = false }) => {
  const rawId = useId();
  const uid = useMemo(() => rawId.replace(/[^a-zA-Z0-9_-]/g, ''), [rawId]);
  const clipId = `radar-clip-${uid}`;
  const sweepGradId = `radar-sweep-${uid}`;
  const glowId = `radar-glow-${uid}`;

  const t = target ? projectLatLon(target.lat, target.lon) : null;
  const e = edge ? projectLatLon(edge.lat, edge.lon) : null;
  const sweepCenter = t || { x: W / 2, y: H / 2 };
  const a = (SWEEP_ANGLE_DEG * Math.PI) / 180;
  const vectorD = vectorPath(t, e);

  const labelAnchor = (x: number): 'start' | 'end' => (x > W - 180 ? 'end' : 'start');
  const labelDx = (x: number): number => (x > W - 180 ? -14 : 14);

  return (
    <svg
      className={`radar-map-svg ${scanning ? 'radar-scanning' : ''}`}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={
        target
          ? `Radar world map with contact at latitude ${target.lat.toFixed(2)}, longitude ${target.lon.toFixed(2)}${
              edge ? ` and edge POP at ${edge.lat.toFixed(2)}, ${edge.lon.toFixed(2)}` : ''
            }`
          : 'Radar world map — scanning'
      }
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width={W} height={H} />
        </clipPath>
        <linearGradient
          id={sweepGradId}
          gradientUnits="userSpaceOnUse"
          x1={SWEEP_RADIUS}
          y1={0}
          x2={SWEEP_RADIUS * Math.cos(a)}
          y2={SWEEP_RADIUS * Math.sin(a)}
        >
          <stop offset="0" className="radar-sweep-stop-tail" />
          <stop offset="1" className="radar-sweep-stop-head" />
        </linearGradient>
        <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect className="radar-ocean" x="0" y="0" width={W} height={H} />

      <g clipPath={`url(#${clipId})`}>
        {/* GRATICULE */}
        <g className="radar-graticule">
          {MERIDIANS.map((lon) => {
            const x = (lon + 180) * (W / 360);
            return (
              <line
                key={`m${lon}`}
                x1={x}
                y1={0}
                x2={x}
                y2={H}
                className={lon === 0 ? 'grat-major grat-axis' : lon % 30 === 0 ? 'grat-major' : 'grat-minor'}
              />
            );
          })}
          {PARALLELS.map((lat) => {
            const y = (90 - lat) * (H / 180);
            return (
              <line
                key={`p${lat}`}
                x1={0}
                y1={y}
                x2={W}
                y2={y}
                className={lat === 0 ? 'grat-major grat-axis' : lat % 30 === 0 ? 'grat-major' : 'grat-minor'}
              />
            );
          })}
        </g>

        {/* LAND MASSES (Natural Earth 1:110m, public domain) */}
        <path className="radar-land" d={WORLD_LAND_PATH} />

        {/* GRATICULE LABELS */}
        <g className="radar-grat-labels" aria-hidden="true">
          {LAT_LABELS.map((lat) => (
            <text key={`ll${lat}`} x={6} y={(90 - lat) * (H / 180) - 4}>
              {formatLatLabel(lat)}
            </text>
          ))}
          {LON_LABELS.map((lon) => (
            <text key={`lo${lon}`} x={(lon + 180) * (W / 360) + 4} y={H - 6}>
              {formatLonLabel(lon)}
            </text>
          ))}
        </g>

        {/* RANGE RINGS + SWEEP */}
        <g transform={`translate(${sweepCenter.x.toFixed(1)} ${sweepCenter.y.toFixed(1)})`}>
          {[60, 130, 210, 300].map((r) => (
            <circle key={`ring${r}`} r={r} className="radar-range-ring" />
          ))}
          <g className="radar-sweep-rotor">
            <path d={SWEEP_D} fill={`url(#${sweepGradId})`} className="radar-sweep-wedge" />
            <line
              x1={0}
              y1={0}
              x2={(SWEEP_RADIUS * Math.cos(a)).toFixed(1)}
              y2={(SWEEP_RADIUS * Math.sin(a)).toFixed(1)}
              className="radar-sweep-edge"
            />
          </g>
        </g>

        {/* CROSSHAIR */}
        {t && (
          <g className="radar-crosshair" aria-hidden="true">
            <line x1={0} y1={t.y} x2={W} y2={t.y} />
            <line x1={t.x} y1={0} x2={t.x} y2={H} />
          </g>
        )}

        {/* HQ -> EDGE POP VECTOR */}
        {vectorD && <path d={vectorD} className="radar-vector" />}

        {/* SECONDARY CONTACTS */}
        {extras.map((p, i) => {
          const q = projectLatLon(p.lat, p.lon);
          return (
            <g key={`extra-${i}`} transform={`translate(${q.x.toFixed(1)} ${q.y.toFixed(1)})`} className="radar-extra">
              <circle r={3} />
            </g>
          );
        })}

        {/* EDGE POP CONTACT */}
        {e && (
          <g transform={`translate(${e.x.toFixed(1)} ${e.y.toFixed(1)})`} className="radar-edge" filter={`url(#${glowId})`}>
            <circle r={14} className="radar-ping-ring radar-ping-ring-edge" />
            <rect x={-5} y={-5} width={10} height={10} transform="rotate(45)" className="radar-edge-core" />
            {edge?.label && (
              <text x={labelDx(e.x)} y={-10} textAnchor={labelAnchor(e.x)} className="radar-label radar-label-edge">
                {edge.label}
              </text>
            )}
          </g>
        )}

        {/* PRIMARY CONTACT: PING BLIP + RETICLE */}
        {t && (
          <g transform={`translate(${t.x.toFixed(1)} ${t.y.toFixed(1)})`} className="radar-target" filter={`url(#${glowId})`}>
            <circle r={16} className="radar-ping-ring" />
            <circle r={16} className="radar-ping-ring radar-ping-ring-delay" />
            <path
              className="radar-reticle"
              d="M-13 -6 V-13 H-6 M6 -13 H13 V-6 M13 6 V13 H6 M-6 13 H-13 V6"
            />
            <circle r={4} className="radar-blip-core" />
            {target?.label && (
              <text x={labelDx(t.x)} y={e && e.y < t.y ? 20 : -10} textAnchor={labelAnchor(t.x)} className="radar-label">
                {target.label}
              </text>
            )}
          </g>
        )}
      </g>

      <rect className="radar-frame" x="0.5" y="0.5" width={W - 1} height={H - 1} />
    </svg>
  );
};

export default RadarMap;
