import React from 'react';

/**
 * 8-bit NES/C64 Pixel-Grid Sprite of Swedish Navy Robotbåt HMS Västervik (R136)
 * Norrköping-class (Spica II) Fast Attack Missile Craft:
 * - Stern: Three-tailed Swedish Naval Ensign (Tretungad örlogsflagga) + turbine wake
 * - Aft deck: Angled RBS-15 anti-ship missile box launchers + Proteus turbine exhausts
 * - Midships: Lattice radar mast topped with iconic PEAB 9LV200 ("Ostkupan") spherical radome
 * - Superstructure: Enclosed armored CIC/bridge with illuminated cyan windows
 * - Foredeck: Bofors 57 mm Mk1 naval gun cupola & elevated barrel + flared R136 bow spray
 */
export const HmsVastervik: React.FC<{ className?: string }> = ({ className = '' }) => {
  const pixelSize = 5;
  const cols = 76;
  const rows = [
    // 0: Masthead navigation beacon above 9LV200 radome
    '                                    G                                       ',
    // 1: PEAB 9LV200 ("Ostkupan") spherical fire-control radome top
    '                                   WWW                                      ',
    // 2: 9LV200 radome body
    '                                  WWPWW                                     ',
    // 3: 9LV200 radome base
    '                                   PPP                                      ',
    // 4: Sea Giraffe search radar crossbar & ESM antennas
    '                                 CCCCCCC                                    ',
    // 5: Lattice mainmast upper
    '                                   BBB                                      ',
    // 6: Lattice mainmast & yardarm
    '                                  BBDBB                                     ',
    // 7: Swedish Three-Tailed Naval Ensign (top) + Mast base + Bridge roof
    '  SSGSSS                          BBD B   LLLLLL                            ',
    // 8: Swedish Ensign gold cross + RBS-15 upper canister + Bridge visor
    '   GGGGGG            MMMM         BBBB   LLLLLLLLL                          ',
    // 9: Swedish Ensign swallowtail + Angled RBS-15 missile tubes + Cyan bridge glass
    '  SSGSSS     G      MMMMMM       BBBBBB  LLLCCCCLLL             PP          ',
    // 10: Stern flagstaff + Dual RBS-15 box launchers + Bridge superstructure + 57mm barrel
    '        P          MMMMMMGG     BBBBBBBB LLLCCCCLLLL          PPP           ',
    // 11: Proteus exhaust stack + RBS-15 cradles + Deckhouse + Bofors 57mm Mk1 cupola
    '        P   DDDD  MMMMMMBBBB   BBBBBBBBBBBBBBBBBBBBBB      LLLLPP           ',
    // 12: Aft coaming + Missile blast deflectors + Superstructure + 57mm turret base
    '        P  DDDDDD  BBBBBBBBBB BBBBBBBBBBBBBBBBBBBBBBBB    LLLLLL            ',
    // 13: Sheer strake / Upper weather deck from transom to flared Spica II bow
    '       LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL   ',
    // 14: Upper hull & R136 white tactical hull markings forward
    '       BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBW W WBBBBBBBL   ',
    // 15: Main planing hull side with chine highlight
    '      BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBW W WBBBBBBB    ',
    // 16: Mid-hull strake & high-speed spray rail
    '  WW  LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL     ',
    // 17: Lower hull shadow & sharp V-bow entry
    ' WWWW  DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD  CW  ',
    // 18: Waterline keel & bow wave crest
    'WWCCWW  DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD  CCCWW ',
    // 19: Baltic Sea foamy wake & bow spray
    ' CCCCWWWWCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCWWWWCC ',
    // 20: Sub-surface sonar/wave shimmer
    '   CCCCCC  CCCC    CCCCCC    CCCC    CCCCCC    CCCC    CCCCCC    CCCCCCCC   ',
  ];

  const width = cols * pixelSize;
  const height = rows.length * pixelSize;

  const colorMap: Record<string, string> = {
    L: '#93c5fd', // Light Steel Navy deck/chine highlight
    B: '#2563eb', // Royal Naval Hull Blue
    D: '#0f294a', // Deep Hull Shadow / Turbine cowling
    M: '#3b82f6', // RBS-15 Missile Canister Blue
    C: '#38bdf8', // Radar Cyan / Bridge Glass / Wave Crest
    W: '#f8fafc', // Crisp White (9LV200 Radome, R136 markings, Bow Spray)
    P: '#cbd5e1', // Gunmetal Silver (57mm Bofors barrel, Mast/Radome base)
    G: '#fecc02', // Swedish Naval Gold (Flag Cross, Beacon, RBS-15 hazard trim)
    S: '#006aa7', // Authentic Swedish Ensign Blue
  };

  const pixels: { x: number; y: number; color: string }[] = [];

  rows.forEach((row, rowIndex) => {
    for (let colIndex = 0; colIndex < Math.min(row.length, cols); colIndex++) {
      const ch = row[colIndex];
      if (ch !== ' ' && colorMap[ch]) {
        pixels.push({
          x: colIndex * pixelSize,
          y: rowIndex * pixelSize,
          color: colorMap[ch],
        });
      }
    }
  });

  return (
    <div className={`vastervik-sprite-wrapper ${className}`}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="vastervik-svg"
        shapeRendering="crispEdges"
        role="img"
        aria-label="8-bit Swedish Navy Robotbåt HMS Västervik R136"
      >
        <defs>
          <filter id="navyGlow" x="-12%" y="-12%" width="124%" height="124%">
            <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#38bdf8" floodOpacity="0.65" />
          </filter>
        </defs>

        {/* Naval Radar Bearing & Horizon Grid behind HMS Västervik */}
        <g stroke="#163a66" strokeWidth="1" strokeDasharray="3 4" opacity="0.65">
          <line x1="0" y1="35" x2={width} y2="35" />
          <line x1="0" y1="68" x2={width} y2="68" />
          <line x1="190" y1="4" x2="190" y2={height} />
        </g>

        <g filter="url(#navyGlow)">
          {pixels.map((p, idx) => (
            <rect
              key={idx}
              x={p.x}
              y={p.y}
              width={pixelSize}
              height={pixelSize}
              fill={p.color}
            />
          ))}
        </g>
      </svg>
    </div>
  );
};

export default HmsVastervik;
