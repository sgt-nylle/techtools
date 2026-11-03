import React, { useCallback, useEffect, useRef, useState } from 'react';
import { HmsVastervik } from './HmsVastervik';
import type { ToolModule } from '../tools/types';
import { sound } from '../utils/audio';

interface CommandDeckProps {
  modules: ToolModule[];
  onSelectTool: (toolId: string) => void;
  quickIp: string | null;
}

/**
 * Command Deck keyboard model:
 * - [1]..[N]      -> SELECT module only (focus + scroll into view)
 * - Arrow keys    -> move selection
 * - [Enter]       -> LAUNCH the selected module
 * - [Tab]         -> native focus; focusing a card also selects it and scrolls it into view
 */
export const CommandDeck: React.FC<CommandDeckProps> = ({ modules, onSelectTool, quickIp }) => {
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const revealCard = useCallback((idx: number, moveFocus: boolean) => {
    const el = cardRefs.current[idx];
    if (!el) return;
    if (moveFocus) el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, []);

  const selectIndex = useCallback(
    (idx: number, moveFocus: boolean) => {
      setSelectedIndex(idx);
      revealCard(idx, moveFocus);
    },
    [revealCard]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;

      // [1..N] select only (do NOT launch)
      const digitIdx = modules.findIndex((m) => m.shortcut === e.key);
      if (digitIdx !== -1) {
        e.preventDefault();
        if (digitIdx !== selectedIndex) sound.playClick();
        selectIndex(digitIdx, true);
        return;
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        sound.playClick();
        selectIndex((selectedIndex + 1) % modules.length, true);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        sound.playClick();
        selectIndex((selectedIndex - 1 + modules.length) % modules.length, true);
      } else if (e.key === 'Enter') {
        // A focused card button launches itself through its native click handler.
        if (tag === 'BUTTON' || tag === 'A') return;
        e.preventDefault();
        const chosen = modules[selectedIndex];
        if (chosen) {
          sound.playBlip();
          onSelectTool(chosen.id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modules, selectedIndex, onSelectTool, selectIndex]);

  return (
    <div className="command-deck">
      {/* HERO TITLE & 8-BIT HMS VÄSTERVIK SPRITE */}
      <div className="deck-hero c64-box">
        <div className="deck-flair">⚓ ★ ⚓</div>
        <h1 className="deck-title">TECHTOOLS</h1>
        <div className="deck-subtitle">R136 HMS VÄSTERVIK // NAVAL IT TROUBLESHOOTING CONSOLE</div>

        <HmsVastervik className="deck-vessel-stage" />

        <div className="vessel-spec-strip">
          <span>VESSEL: ROBOTBÅT R136 HMS VÄSTERVIK</span>
          <span className="spec-sep">•</span>
          <span>RADAR: PEAB 9LV200</span>
          <span className="spec-sep">•</span>
          <span>
            YOUR WAN IP: <strong className="text-gold">{quickIp || 'SCANNING...'}</strong>
          </span>
        </div>
      </div>

      {/* EXTENSIBLE DIAGNOSTIC MODULE SELECTOR */}
      <div className="deck-modules-box c64-box">
        <div className="deck-modules-header">
          <span>-- SELECT MODULE [1–{modules.length} / ▲▼ / TAB] • [ENTER] LAUNCH --</span>
          <span className="slot-status">{modules.length} ACTIVE MODULES • EXPANSION READY</span>
        </div>

        <div className="module-cards-grid">
          {modules.map((mod, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <button
                key={mod.id}
                ref={(el) => {
                  cardRefs.current[idx] = el;
                }}
                type="button"
                className={`module-card ${isSelected ? 'selected' : ''}`}
                aria-pressed={isSelected}
                onMouseEnter={() => setSelectedIndex(idx)}
                onFocus={() => selectIndex(idx, false)}
                onClick={() => {
                  sound.playBlip();
                  onSelectTool(mod.id);
                }}
              >
                <div className="module-card-top">
                  <span className="module-code">
                    {isSelected ? '► ' : ''}
                    {mod.code} [{mod.shortcut}]
                  </span>
                  <span className="module-badge">{mod.badge}</span>
                </div>
                <div className="module-card-title">{mod.title}</div>
                <p className="module-card-desc">{mod.description}</p>
                <div className="module-caps-row">
                  {mod.capabilities.map((cap) => (
                    <span key={cap} className="cap-tag">
                      {cap}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default CommandDeck;
