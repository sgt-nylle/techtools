import { createContext, useContext, useEffect } from 'react';

/**
 * Indicates whether the enclosing tool pane is currently the active keyboard target.
 * In single-pane view, this defaults to `true`.
 * In desktop dual-pane split view, only the currently focused/selected pane has `true`,
 * preventing global `window.addEventListener('keydown', ...)` handlers in inactive panes
 * from intercepting single-letter shortcuts intended for the active pane.
 */
export const PaneActiveContext = createContext<boolean>(true);

export function useIsPaneActive(): boolean {
  return useContext(PaneActiveContext);
}

export function usePaneKeyDown(handler: (e: KeyboardEvent) => void, deps: readonly unknown[]): void {
  const isActive = useIsPaneActive();

  useEffect(() => {
    if (!isActive) return;
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, ...deps]);
}
