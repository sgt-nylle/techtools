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
 * - Arrow keys    -> move selection across the module grid
 * - [Enter]       -> LAUNCH the selected module
 * - [Tab]         -> native focus; focusing a card also selects it and scrolls it into view
 */
export const CommandDeck: React.FC<CommandDeckProps> = ({ modules, onSelectTool, quickIp }) => {
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const gridRef = useRef<HTMLDivElement | null>(null);
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
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;

      const total = modules.length;
      if (total === 0) return;

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        sound.playClick();
        selectIndex((selectedIndex + 1) % total, true);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        sound.playClick();
        selectIndex((selectedIndex - 1 + total) % total, true);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        sound.playClick();
        const cols = gridRef.current
          ? Math.max(1, window.getComputedStyle(gridRef.current).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length)
          : 1;
        let nextIdx: number;
        if (e.key === 'ArrowDown') {
          nextIdx = selectedIndex + cols < total ? selectedIndex + cols : selectedIndex % cols;
        } else {
          const col = selectedIndex % cols;
          nextIdx = selectedIndex - cols >= 0 ? selectedIndex - cols : col + Math.floor((total - 1 - col) / cols) * cols;
        }
        selectIndex(nextIdx, true);
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
      {/* HERO TITLE & FAST HMS VÄSTERVIK SPRITE */}
      <div className="deck-hero clean-box">
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
      <div className="deck-modules-box clean-box">
        <div className="deck-modules-header">
          <span>-- SELECT MODULE [◄►▲▼ / TAB] • [ENTER] LAUNCH --</span>
          <span className="slot-status">{modules.length} ACTIVE MODULES • EXPANSION READY</span>
        </div>

        <div ref={gridRef} className="module-cards-grid">
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
                    {mod.code}
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
