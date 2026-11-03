import type React from 'react';

export type ToolCategory = 'SECURITY' | 'DNS & MAIL' | 'NETWORK' | 'DIAGNOSTICS' | 'CRYPTO & SSL' | 'MAIL SECURITY';

/**
 * Modular Tool Contract for techtools.subwrite.se.
 *
 * To add a new troubleshooting tool in the future:
 * 1. Create `src/tools/MyNewTool.tsx` (and optional `/api/...` route in `server/apiHandler.mjs`).
 * 2. Append a `ToolModule` object to `TOOL_MODULES` in `src/tools/registry.ts`.
 * The Command Deck, Top Navigation Bar, URL hash router, and keyboard shortcuts update automatically.
 */
export interface ToolModule {
  id: string;
  code: string;
  shortcut: string;
  title: string;
  shortTitle: string;
  category: ToolCategory;
  badge: string;
  description: string;
  capabilities: string[];
  Component: React.FC;
}
