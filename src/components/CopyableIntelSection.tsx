import React, { useState, useCallback } from 'react';
import { sound } from '../utils/audio';

interface CopyableIntelSectionProps {
  title: string;
  copyPayload: string;
  badge?: string | null;
  className?: string;
  children: React.ReactNode;
}

/**
 * Tab-focusable C64 diagnostic card.
 * Users can Tab / Shift+Tab onto any section and press [C] (or click COPY [C])
 * to copy the formatted diagnostic output of that section to the clipboard.
 */
export const CopyableIntelSection: React.FC<CopyableIntelSectionProps> = ({
  title,
  copyPayload,
  badge,
  className = '',
  children,
}) => {
  const [copied, setCopied] = useState<boolean>(false);

  const triggerCopy = useCallback(async () => {
    if (!copyPayload) return;
    try {
      await navigator.clipboard.writeText(copyPayload);
      sound.playCopy();
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      sound.playError();
    }
  }, [copyPayload]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;

    if (e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      e.stopPropagation();
      void triggerCopy();
    }
  };

  return (
    <section
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={`intel-section copyable-section c64-box ${copied ? 'section-just-copied' : ''} ${className}`}
      aria-label={`${title} — Press C to copy section output`}
    >
      <div className="section-title-row">
        <h3 className="section-title">{title}</h3>
        <div className="section-header-right">
          {badge && <span className="ttl-pill">{badge}</span>}
          <button
            type="button"
            tabIndex={-1}
            className={`navy-btn btn-xs section-copy-btn ${copied ? 'btn-copied' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              void triggerCopy();
            }}
            title="Focus section with Tab and press [C] to copy"
          >
            {copied ? '✓ COPIED!' : '📋 COPY [C]'}
          </button>
        </div>
      </div>
      {children}
    </section>
  );
};

export default CopyableIntelSection;
