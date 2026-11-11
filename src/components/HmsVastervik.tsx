import React from 'react';

/**
 * Pixel-Art Sprite of Swedish Navy Norrköping-class (Spica II) Robotbåt — HMS Västervik (R136)
 * Modeled faithfully on the real Spica II / Robotbåt profile (R131–R142 sister ships):
 * - Stern: Tandem pair of forward-upward angled RBS-15 anti-ship missile box launchers on deck struts
 * - Aft superstructure: Deckhouse with lifebuoy, tall aft pole mast flying the 3-tailed Swedish Naval Ensign
 * - Mainmast: Open X-braced lattice mast (fackverksmast) with yardarm & oval Ericsson Sea Giraffe radome
 * - Bridge / CIC: Stepped enclosed wheelhouse with 4 forward windows, visor & rooftop 9LV200 director
 * - Foredeck: 53 cm torpedo tube, Bofors 57 mm cupola gun with horizontal barrel, stanchion railings & lifebuoy
 * - Planing hull: Swedish Navy M90 angular splinter camouflage, midships sponson, spray strake, R136 & wake
 *
 * Rendered on a 190×54 pixel grid at 2px per pixel = 380×108 SVG (same footprint as original 380×105).
 */

const ROBOTBAT_COLS = 190;
const ROBOTBAT_ROWS = 54;
const ROBOTBAT_PIXEL_SIZE = 2;

/**
 * Boat colors are CSS variables (--boat-*) defined per theme in index.css, so the sprite
 * re-colors with the selected theme. Navy keeps the original palette.
 */
const PALETTE = {
  hullDark: 'var(--boat-hullDark)', // M90 dark splinter navy-slate
  hullMid: 'var(--boat-hullMid)', // M90 mid splinter steel-blue
  hullLight: 'var(--boat-hullLight)', // M90 light splinter ice-steel
  keel: 'var(--boat-keel)', // Dark lower planing hull / boot-top
  canister: 'var(--boat-canister)', // RBS-15 box launcher & torpedo tube body
  canisterHi: 'var(--boat-canisterHi)', // RBS-15 top edge highlight
  canisterDark: 'var(--boat-canisterDark)', // RBS-15 seam, end-caps & struts
  mast: 'var(--boat-mast)', // Lattice mast, pole mast, pedestal & 9LV200 director
  mastEdge: 'var(--boat-mastEdge)', // Subtle metallic edge highlight on dark mast & struts
  railing: 'var(--boat-railing)', // Fine deck railing wire
  cupola: 'var(--boat-cupola)', // Bofors 57mm cupola & Sea Giraffe radome body
  cupolaHi: 'var(--boat-cupolaHi)', // Radome & gun barrel highlight
  cupolaShadow: 'var(--boat-cupolaShadow)', // Cupola base & lower shadow
  white: 'var(--boat-white)', // Crisp white (visor, lifebuoy quarters, foam crest)
  pennant: 'var(--boat-pennant)', // R136 tactical hull number
  windowDark: 'var(--boat-windowDark)', // Tinted armored bridge windows
  windowGlint: 'var(--boat-windowGlint)', // Cyan instrument/glass glint & wave spray
  wakeMid: 'var(--boat-wakeMid)', // Baltic sea wake mid-cyan
  wakeDeep: 'var(--boat-wakeDeep)', // Sub-surface wake shadow
  flagBlue: 'var(--boat-flagBlue)', // Swedish Naval Ensign blue
  flagGold: 'var(--boat-flagGold)', // Swedish Naval Ensign gold cross & nameplate
  buoyOrange: 'var(--boat-buoyOrange)', // Lifebuoy safety orange
};

interface PixelSpan {
  x: number;
  y: number;
  w: number;
  color: string;
}

function buildRobotbatSpans(): PixelSpan[] {
  const grid: (string | null)[][] = Array.from({ length: ROBOTBAT_ROWS }, () =>
    Array<string | null>(ROBOTBAT_COLS).fill(null)
  );

  const setPx = (x: number, y: number, color: string) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi >= 0 && xi < ROBOTBAT_COLS && yi >= 0 && yi < ROBOTBAT_ROWS) {
      grid[yi][xi] = color;
    }
  };

  const hLine = (x1: number, x2: number, y: number, color: string) => {
    const start = Math.max(0, Math.min(x1, x2));
    const end = Math.min(ROBOTBAT_COLS - 1, Math.max(x1, x2));
    for (let x = start; x <= end; x++) setPx(x, y, color);
  };

  const vLine = (x: number, y1: number, y2: number, color: string) => {
    const start = Math.max(0, Math.min(y1, y2));
    const end = Math.min(ROBOTBAT_ROWS - 1, Math.max(y1, y2));
    for (let y = start; y <= end; y++) setPx(x, y, color);
  };

  const fillRect = (x: number, y: number, w: number, h: number, color: string) => {
    for (let dy = 0; dy < h; dy++) {
      hLine(x, x + w - 1, y + dy, color);
    }
  };

  const drawLine = (x0: number, y0: number, x1: number, y1: number, color: string) => {
    let cx = Math.round(x0);
    let cy = Math.round(y0);
    const tx = Math.round(x1);
    const ty = Math.round(y1);
    const dx = Math.abs(tx - cx);
    const sx = cx < tx ? 1 : -1;
    const dy = -Math.abs(ty - cy);
    const sy = cy < ty ? 1 : -1;
    let err = dx + dy;
    while (true) {
      setPx(cx, cy, color);
      if (cx === tx && cy === ty) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        cx += sx;
      }
      if (e2 <= dx) {
        err += dx;
        cy += sy;
      }
    }
  };

  // Deck sheer profile from stern (x=8) to sharp Spica II bow point (x=185)
  const deckYAt = (x: number): number => {
    if (x < 46) return 37;
    if (x < 88) return 36;
    if (x < 126) return 35;
    if (x < 154) return 34;
    if (x < 173) return 33;
    return 32;
  };

  // Bow stem & lower hull bottom profile
  const hullBottomAt = (x: number): number => {
    if (x <= 165) return 46;
    if (x <= 170) return 45;
    if (x <= 174) return 43;
    if (x <= 177) return 41;
    if (x <= 180) return 38;
    if (x <= 183) return 35;
    return 33;
  };

  // =========================================================================
  // 1. TANDEM RBS-15 MISSILE BOX LAUNCHERS (Angled UPWARD-FORWARD at ~22°)
  // =========================================================================
  // Real Norrköping-class RBS-15 launchers point forward-upward (low at stern/left, high at right/forward)
  const drawRotatedRbs15 = (cx: number, cy: number) => {
    const angle = -0.38; // ~22 degrees upward to the right
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const halfLen = 9.2;
    const halfThick = 3.2;

    // Deck support cradle / A-frame struts under forward & rear ends
    drawLine(cx - 4, cy + 2, cx - 4, 37, PALETTE.canisterDark);
    drawLine(cx + 3, cy, cx + 1, 37, PALETTE.mastEdge);
    drawLine(cx + 6, cy - 1, cx + 7, 37, PALETTE.canisterDark);

    for (let py = cy - 9; py <= cy + 8; py++) {
      for (let px = cx - 12; px <= cx + 12; px++) {
        if (py >= deckYAt(px)) continue;
        const dx = px - cx;
        const dy = py - cy;
        // Local coordinates along tilted launcher axis (u along length, v across thickness)
        const u = dx * cosA + dy * sinA;
        const v = -dx * sinA + dy * cosA;
        if (Math.abs(u) <= halfLen && Math.abs(v) <= halfThick) {
          let col = PALETTE.canister;
          if (v < -halfThick + 1.05) {
            col = PALETTE.canisterHi; // Upper sunlit top edge
          } else if (Math.abs(v) < 0.55) {
            col = PALETTE.canisterDark; // Center seam between upper & lower canisters
          } else if (v > halfThick - 1.0) {
            col = PALETTE.canisterDark; // Bottom shadow edge
          }
          // End-cap stiffening ribs at rear (left) and muzzle (right)
          if (u < -halfLen + 1.2 || u > halfLen - 1.3) {
            col = v < -halfThick + 1.05 ? PALETTE.canisterHi : PALETTE.canisterDark;
          }
          setPx(px, py, col);
        }
      }
    }
  };

  // Rear RBS-15 launcher (overhanging stern) & forward RBS-15 launcher in tandem
  drawRotatedRbs15(14, 31);
  drawRotatedRbs15(32, 31);

  // Whip antenna post & tall tilted HF whip between the tandem launchers (as on R142/R136)
  vLine(24, 24, 29, PALETTE.mast);
  drawLine(24, 24, 21, 11, PALETTE.mastEdge);

  // =========================================================================
  // 2. AFT DECKHOUSE, STEPPED CIC BRIDGE & 9LV200 ROOFTOP DIRECTOR
  // =========================================================================
  // Aft deckhouse (x=44..71, y=29..36) with splinter camo
  for (let x = 44; x <= 71; x++) {
    for (let y = 29; y <= 36; y++) {
      let col = PALETTE.hullMid;
      if (x < 52 && y > 30) col = PALETTE.hullDark;
      else if (x >= 60 && x <= 69 && y <= 34) col = PALETTE.hullLight;
      setPx(x, y, col);
    }
  }
  hLine(44, 71, 29, PALETTE.hullLight);
  // Angled blast shield / coaming just forward of RBS-15 muzzle
  drawLine(43, 27, 45, 29, PALETTE.hullLight);
  drawLine(43, 28, 44, 34, PALETTE.hullDark);

  // Watertight doors outline on deckhouse
  vLine(53, 31, 35, PALETTE.canisterDark);
  vLine(56, 31, 35, PALETTE.canisterDark);
  // Ship nameplate plaque ("VÄSTERVIK") in Swedish Naval Gold
  hLine(62, 66, 30, PALETTE.flagGold);

  // Stepped enclosed Bridge / Wheelhouse (x=72..86, y=25..36)
  for (let x = 72; x <= 86; x++) {
    for (let y = 25; y <= 36; y++) {
      let col = PALETTE.hullMid;
      if (x + y > 109) col = PALETTE.hullDark;
      else if (x >= 75 && x <= 82 && y >= 30) col = PALETTE.hullLight;
      setPx(x, y, col);
    }
  }
  // Crisp white forward bridge roof glare-shield / visor
  hLine(79, 85, 24, PALETTE.white);
  hLine(72, 87, 25, PALETTE.hullLight);

  // 4 armored bridge windows with subtle cyan instrument glint
  const winStarts = [74, 77, 80, 83];
  winStarts.forEach((wx) => {
    fillRect(wx, 26, 2, 3, PALETTE.windowDark);
    setPx(wx, 26, PALETTE.windowGlint);
  });
  // Bridge wing signal box
  fillRect(68, 28, 4, 3, PALETTE.canisterDark);
  hLine(68, 71, 28, PALETTE.hullLight);

  // PEAB 9LV200 optronic/fire-control director on top of bridge roof (x=75..80, y=19..24)
  fillRect(76, 22, 3, 3, PALETTE.mast);
  fillRect(75, 19, 5, 3, PALETTE.mast);
  hLine(75, 79, 19, PALETTE.mastEdge);
  setPx(79, 20, PALETTE.white); // Director optic aperture

  // =========================================================================
  // 3. TALL AFT POLE MAST, SWEDISH NAVAL ENSIGN & OPEN X-LATTICE MAINMAST
  // =========================================================================
  // Tall slender aft pole mast rising to y=3 (tallest point, as on R136/R142)
  vLine(49, 3, 28, PALETTE.mast);
  vLine(50, 4, 28, PALETTE.mastEdge);
  vLine(53, 4, 9, PALETTE.mast);
  drawLine(50, 4, 53, 6, PALETTE.mastEdge);
  drawLine(50, 9, 53, 7, PALETTE.mastEdge);

  // Three-tailed Swedish Naval Ensign (Tretungad örlogsflagga) flying aft from mast
  // x=41..48, y=18..22
  fillRect(43, 18, 6, 5, PALETTE.flagBlue);
  // Three swallowtails at x=41..42
  setPx(41, 18, PALETTE.flagBlue);
  setPx(42, 18, PALETTE.flagBlue);
  setPx(41, 20, PALETTE.flagGold);
  setPx(42, 20, PALETTE.flagGold);
  setPx(41, 22, PALETTE.flagBlue);
  setPx(42, 22, PALETTE.flagBlue);
  // Gold Nordic Cross
  hLine(43, 48, 20, PALETTE.flagGold);
  vLine(46, 18, 22, PALETTE.flagGold);

  // Open X-braced lattice mast (fackverksmast) above aft deckhouse (x=56..65, y=19..28)
  vLine(53, 20, 28, PALETTE.mastEdge); // Aft mast ladder
  for (let ly = 21; ly <= 27; ly += 2) setPx(54, ly, PALETTE.mast);
  drawLine(57, 19, 56, 28, PALETTE.mast); // Left lattice leg
  drawLine(58, 19, 57, 28, PALETTE.mastEdge);
  drawLine(65, 19, 66, 28, PALETTE.mast); // Right lattice leg
  drawLine(64, 19, 65, 28, PALETTE.mastEdge);
  hLine(56, 66, 24, PALETTE.mastEdge); // Mid lattice horizontal bar
  // Upper X-brace
  drawLine(58, 20, 64, 24, PALETTE.mastEdge);
  drawLine(64, 20, 58, 24, PALETTE.mastEdge);
  // Lower X-brace
  drawLine(58, 24, 65, 28, PALETTE.mastEdge);
  drawLine(64, 24, 57, 28, PALETTE.mastEdge);

  // Mainmast horizontal platform / yardarm (y=18..19, x=49..74)
  hLine(49, 73, 18, PALETTE.mastEdge);
  hLine(50, 72, 19, PALETTE.mast);
  // Forward navigation radar scanner bar & grey ESM sensor box on yardarm
  hLine(67, 75, 17, PALETTE.cupolaHi);
  fillRect(64, 14, 4, 4, PALETTE.hullLight);
  // Forward whip antenna
  vLine(72, 9, 24, PALETTE.mastEdge);

  // Ericsson Sea Giraffe radar pedestal & flattened oval radome (x=56..66, y=7..18)
  fillRect(59, 11, 4, 7, PALETTE.mast);
  vLine(59, 11, 17, PALETTE.mastEdge);
  hLine(60, 61, 10, PALETTE.white); // Navigation masthead light / collar
  // Flattened oval radome ("ostkupan")
  hLine(58, 63, 7, PALETTE.cupolaHi);
  hLine(56, 65, 8, PALETTE.cupola);
  hLine(56, 65, 9, PALETTE.cupola);
  hLine(58, 63, 9, PALETTE.cupolaShadow);
  hLine(58, 62, 8, PALETTE.white);

  // =========================================================================
  // 4. FOREDECK TORPEDO TUBE & BOFORS 57 MM CUPOLA NAVAL GUN
  // =========================================================================
  // Horizontal 53 cm torpedo tube along foredeck (x=93..128, y=32..34)
  hLine(94, 127, 32, PALETTE.canisterHi);
  hLine(93, 128, 33, PALETTE.canister);
  hLine(94, 127, 34, PALETTE.canisterDark);

  // Bofors 57 mm stealthy cupola turret (rounded back, sloped front: x=112..126, y=25..33)
  hLine(116, 121, 25, PALETTE.cupolaHi);
  hLine(114, 123, 26, PALETTE.cupolaHi);
  hLine(113, 124, 27, PALETTE.cupola);
  hLine(112, 125, 28, PALETTE.cupola);
  hLine(112, 126, 29, PALETTE.cupola);
  hLine(112, 126, 30, PALETTE.cupola);
  hLine(113, 126, 31, PALETTE.cupolaShadow);
  hLine(113, 125, 32, PALETTE.cupolaShadow);
  // Side 6-tube illumination flare launcher rack on cupola
  drawLine(115, 30, 121, 27, PALETTE.mast);
  drawLine(116, 31, 122, 28, PALETTE.mast);

  // Long horizontal 57 mm gun barrel + muzzle brake pointing forward (x=126..142, y=29..30)
  hLine(126, 141, 29, PALETTE.cupolaHi);
  hLine(126, 140, 30, PALETTE.cupolaShadow);
  fillRect(141, 29, 2, 2, PALETTE.mast); // Muzzle brake

  // Forward deck bitts / windlass & bow jackstaff (gösstake)
  fillRect(156, 31, 4, 2, PALETTE.mast);
  fillRect(165, 31, 2, 2, PALETTE.mast);
  vLine(184, 27, 32, PALETTE.mastEdge);
  setPx(184, 27, PALETTE.flagGold);

  // =========================================================================
  // 5. SLEEK PLANING HULL WITH SWEDISH NAVY M90 SPLINTER CAMOUFLAGE
  // =========================================================================
  // Stern transom trim-tab step
  hLine(5, 9, 38, PALETTE.hullDark);
  hLine(6, 9, 41, PALETTE.keel);

  for (let x = 8; x <= 185; x++) {
    const yTop = deckYAt(x);
    const yBot = hullBottomAt(x);
    for (let y = yTop; y <= yBot; y++) {
      // Dark underwater / boot-top hull band
      if (y >= 44 && x <= 174) {
        setPx(x, y, PALETTE.keel);
        continue;
      }

      // Geometric angular M90 splinter camouflage facets
      let col = PALETTE.hullMid;
      if (x < 26) {
        col = x + y < 58 ? PALETTE.hullDark : y > 41 ? PALETTE.hullLight : PALETTE.hullMid;
      } else if (x < 48) {
        col = x - y > 4 ? PALETTE.hullDark : PALETTE.hullMid;
      } else if (x < 68) {
        col = y > 39 && x < 60 ? PALETTE.hullLight : x + y > 98 ? PALETTE.hullDark : PALETTE.hullMid;
      } else if (x < 92) {
        col = x - y < 44 ? PALETTE.hullDark : y > 40 ? PALETTE.hullMid : PALETTE.hullDark;
      } else if (x < 126) {
        if (y >= 40 && x >= 98 && x <= 124) col = PALETTE.hullLight;
        else if (x + y < 136) col = PALETTE.hullMid;
        else col = PALETTE.hullDark;
      } else if (x < 164) {
        if (y >= 41 && x <= 156) col = PALETTE.hullLight;
        else if (x > 134 && x < 160 && y <= 39) col = PALETTE.hullDark; // High-contrast dark facet behind R136
        else col = PALETTE.hullMid;
      } else {
        col = x + y > 208 ? PALETTE.hullDark : PALETTE.hullMid;
      }

      // Crisp sheer-strake deck edge line
      if (y === yTop) {
        col = PALETTE.hullLight;
      }
      setPx(x, y, col);
    }
  }

  // Midships hull rub-rail / sponson overhang with support brackets (x=49..67, y=37..38)
  hLine(49, 67, 37, PALETTE.hullLight);
  for (let bx = 51; bx <= 66; bx += 3) {
    setPx(bx, 38, PALETTE.keel);
  }

  // Forward high-speed spray strake / chine rail (under R136)
  drawLine(130, 41, 166, 39, PALETTE.white);
  drawLine(130, 42, 166, 40, PALETTE.keel);

  // Bow anchor recess
  fillRect(171, 38, 3, 2, PALETTE.keel);

  // Hull tactical pennant number "R 136" forward on starboard bow (y=35..39)
  const drawGlyph = (gx: number, gy: number, pattern: string[]) => {
    pattern.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        if (row[rx] === '#') {
          setPx(gx + rx, gy + ry, PALETTE.pennant);
        }
      }
    });
  };
  // Crisp R (with beveled loop so it never looks like A)
  drawGlyph(136, 35, ['### ', '#  #', '### ', '# # ', '#  #']);
  // 1
  drawGlyph(142, 35, [' # ', '## ', ' # ', ' # ', '###']);
  // 3
  drawGlyph(146, 35, ['### ', '   #', ' ## ', '   #', '### ']);
  // 6
  drawGlyph(151, 35, [' ###', '#   ', '### ', '#  #', ' ## ']);

  // =========================================================================
  // 6. DECK STANCHION RAILINGS & ICONIC ORANGE/WHITE LIFEBUOYS
  // =========================================================================
  // Aft deck railing (x=9..43)
  hLine(9, 43, 35, PALETTE.railing);
  for (let rx = 10; rx <= 42; rx += 6) vLine(rx, 35, 36, PALETTE.mastEdge);

  // Foredeck railing gently following sheer rise (x=88..183)
  for (let rx = 88; rx <= 183; rx++) {
    const ry = deckYAt(rx) - 2;
    setPx(rx, ry, PALETTE.railing);
    if (rx % 7 === 0) {
      setPx(rx, ry + 1, PALETTE.mastEdge);
    }
  }

  // Lifebuoys (safety orange & white rings: aft railing, deckhouse wall, foredeck railing)
  const drawLifebuoy = (bx: number, by: number) => {
    setPx(bx + 1, by, PALETTE.buoyOrange);
    setPx(bx + 2, by, PALETTE.white);
    setPx(bx, by + 1, PALETTE.white);
    setPx(bx + 3, by + 1, PALETTE.buoyOrange);
    setPx(bx, by + 2, PALETTE.buoyOrange);
    setPx(bx + 3, by + 2, PALETTE.white);
    setPx(bx + 1, by + 3, PALETTE.white);
    setPx(bx + 2, by + 3, PALETTE.buoyOrange);
  };
  drawLifebuoy(27, 34);
  drawLifebuoy(57, 30);
  drawLifebuoy(106, 32);

  // =========================================================================
  // 7. BALTIC SEA HIGH-SPEED TURBINE WAKE & BOW SPRAY
  // =========================================================================
  // Stern Proteus turbine rooster-tail wake
  hLine(2, 12, 45, PALETTE.white);
  hLine(1, 18, 46, PALETTE.white);
  hLine(3, 28, 47, PALETTE.windowGlint);
  // Continuous foamy waterline & high-speed bow wave
  hLine(8, 173, 47, PALETTE.wakeMid);
  hLine(14, 168, 48, PALETTE.windowGlint);
  // White planing spray crests along hull & bow
  hLine(18, 34, 47, PALETTE.white);
  hLine(58, 76, 47, PALETTE.white);
  hLine(105, 126, 47, PALETTE.white);
  hLine(152, 176, 46, PALETTE.white);
  hLine(158, 180, 47, PALETTE.white);
  hLine(166, 183, 45, PALETTE.windowGlint);
  hLine(171, 179, 44, PALETTE.white);
  // Sub-surface wave shimmer
  for (let wx = 10; wx <= 172; wx += 14) {
    hLine(wx, wx + 8, 49, PALETTE.wakeMid);
    hLine(wx + 3, wx + 9, 50, PALETTE.wakeDeep);
  }

  // Merge horizontal color runs into compact SVG <rect> spans
  const spans: PixelSpan[] = [];
  for (let y = 0; y < ROBOTBAT_ROWS; y++) {
    let x = 0;
    while (x < ROBOTBAT_COLS) {
      const c = grid[y][x];
      if (!c) {
        x++;
        continue;
      }
      let w = 1;
      while (x + w < ROBOTBAT_COLS && grid[y][x + w] === c) {
        w++;
      }
      spans.push({ x, y, w, color: c });
      x += w;
    }
  }
  return spans;
}

const ROBOTBAT_SPANS = buildRobotbatSpans();

export const HmsVastervik: React.FC<{ className?: string }> = ({ className = '' }) => {
  const width = ROBOTBAT_COLS * ROBOTBAT_PIXEL_SIZE; // 380px
  const height = ROBOTBAT_ROWS * ROBOTBAT_PIXEL_SIZE; // 108px

  return (
    <div className={`vastervik-sprite-wrapper ${className}`}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="vastervik-svg"
        shapeRendering="crispEdges"
        role="img"
        aria-label="Clean Swedish Navy Norrköping-class Robotbåt HMS Västervik R136"
      >
        <defs>
          <filter id="navyGlow" x="-12%" y="-12%" width="124%" height="124%">
            <feDropShadow dx="0" dy="0" stdDeviation="2.5" style={{ floodColor: 'var(--boat-glow)', floodOpacity: 'var(--boat-glow-opacity)' } as React.CSSProperties} />
          </filter>
        </defs>

        {/* Naval Radar Bearing & Horizon Grid behind HMS Västervik */}
        <g stroke="var(--boat-grid)" strokeWidth="1" strokeDasharray="3 4" opacity="0.5">
          <line x1="0" y1="36" x2={width} y2="36" />
          <line x1="0" y1="70" x2={width} y2="70" />
          <line x1="190" y1="4" x2="190" y2={height} />
        </g>

        <g filter="url(#navyGlow)">
          {ROBOTBAT_SPANS.map((s, idx) => (
            <rect
              key={idx}
              x={s.x * ROBOTBAT_PIXEL_SIZE}
              y={s.y * ROBOTBAT_PIXEL_SIZE}
              width={s.w * ROBOTBAT_PIXEL_SIZE}
              height={ROBOTBAT_PIXEL_SIZE}
              style={{ fill: s.color }}
            />
          ))}
        </g>
      </svg>
    </div>
  );
};

export default HmsVastervik;
