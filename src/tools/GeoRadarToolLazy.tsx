import React, { Suspense, lazy } from 'react';

// Code-split: the radar (and its ~73 KiB Natural Earth land path) only loads when MOD-03 is opened.
const GeoRadarTool = lazy(() => import('./GeoRadarTool'));

export const GeoRadarToolLazy: React.FC = () => (
  <Suspense
    fallback={
      <div className="loading-radar clean-box">
        <span className="radar-spinner">◎</span> POWERING UP GEOLOCATION RADAR...
      </div>
    }
  >
    <GeoRadarTool />
  </Suspense>
);

export default GeoRadarToolLazy;
