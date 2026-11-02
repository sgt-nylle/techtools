import React, { useEffect, useState } from 'react';
import { HmsVastervik } from './HmsVastervik';
import type { ToolModule } from '../tools/types';
import { sound } from '../utils/audio';

interface CommandDeckProps {
  modules: ToolModule[];
  onSelectTool: (toolId: string) => void;
  quickIp: string | null;
}

export const CommandDeck: React.FC<CommandDeckProps> = ({
  modules,
  onSelectTool,
  quickIp,
}) => {
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        sound.playClick();
        setSelectedIndex((prev) => (prev + 1) % modules.length);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        sound.playClick();
        setSelectedIndex((prev) => (prev - 1 + modules.length) % modules.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        sound.playBlip();
        const chosen = modules[selectedIndex];
        if (chosen) onSelectTool(chosen.id);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modules, selectedIndex, onSelectTool]);

  return (
    <div className="command-deck">
      {/* HERO TITLE & 8-BIT HMS VÄSTERVIK SPRITE */}
      <div className="deck-hero c64-box">
        <div className="deck-flair">⚓ ★ ⚓</div>
        <h1 className="deck-title">TECHTOOLS</h1>
        <div className="deck-subtitle">
          R136 HMS VÄSTERVIK // NAVAL IT TROUBLESHOOTING CONSOLE
        </div>

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
          <span>-- SELECT DIAGNOSTIC MODULE [1–{modules.length} / ▲▼ + ENTER] --</span>
          <span className="slot-status">{modules.length} ACTIVE MODULES • EXPANSION READY</span>
        </div>

        <div className="module-cards-grid">
          {modules.map((mod, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <button
                key={mod.id}
                type="button"
                className={`module-card ${isSelected ? 'selected' : ''}`}
                onMouseEnter={() => setSelectedIndex(idx)}
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
