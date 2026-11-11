import { DEFAULT_THEME, loadTheme, saveTheme, type ThemeId } from '../../src/utils/theme';

/**
 * Persistent extension state. Uses `chrome.storage.local` (shared by popup, side panel and
 * service worker, and synced live through `storage.onChanged`). Falls back to localStorage
 * when running outside an extension (e.g. previewing popup.html in a normal tab).
 */
export interface ExtSettings {
  /** Tool pinned as the default (module id), or null. */
  defaultToolId: string | null;
  /** What to show when the extension opens. */
  startMode: 'launcher' | 'default-tool';
  theme: ThemeId;
}

/** Hand-off from the context-menu service worker to the UI. */
export interface PendingInput {
  toolId: string | null;
  text: string;
  /** Optional hint, e.g. 'saml' switches the JWT/SAML tool to its SAML tab. */
  hint?: 'saml';
  ts: number;
}

const SETTINGS_KEY = 'tt_ext_settings';
const PENDING_KEY = 'tt_ext_pending';

const hasChromeStorage = typeof chrome !== 'undefined' && !!chrome.storage?.local;

export const DEFAULT_SETTINGS: ExtSettings = {
  defaultToolId: null,
  startMode: 'launcher',
  theme: DEFAULT_THEME,
};

async function readKey<T>(key: string): Promise<T | undefined> {
  if (hasChromeStorage) {
    const res = await chrome.storage.local.get(key);
    return res[key] as T | undefined;
  }
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

async function writeKey(key: string, value: unknown): Promise<void> {
  if (hasChromeStorage) {
    await chrome.storage.local.set({ [key]: value });
    return;
  }
  localStorage.setItem(key, JSON.stringify(value));
}

async function removeKey(key: string): Promise<void> {
  if (hasChromeStorage) {
    await chrome.storage.local.remove(key);
    return;
  }
  localStorage.removeItem(key);
}

export async function getSettings(): Promise<ExtSettings> {
  const stored = await readKey<Partial<ExtSettings>>(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, theme: loadTheme(), ...stored };
}

export async function patchSettings(patch: Partial<ExtSettings>): Promise<ExtSettings> {
  const next = { ...(await getSettings()), ...patch };
  await writeKey(SETTINGS_KEY, next);
  // Mirror theme into localStorage so theme-boot.js can paint the right theme instantly.
  if (patch.theme) saveTheme(patch.theme);
  return next;
}

/** Reads and clears the pending context-menu input (ignores anything older than 30s). */
export async function takePendingInput(): Promise<PendingInput | null> {
  const pending = await readKey<PendingInput>(PENDING_KEY);
  if (!pending) return null;
  await removeKey(PENDING_KEY);
  return Date.now() - pending.ts < 30_000 ? pending : null;
}

/** Subscribe to settings changes made in another extension surface (popup <-> side panel). */
export function onSettingsChanged(cb: (s: ExtSettings) => void): () => void {
  if (!hasChromeStorage) return () => {};
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && changes[SETTINGS_KEY]) {
      cb({ ...DEFAULT_SETTINGS, ...(changes[SETTINGS_KEY].newValue as Partial<ExtSettings>) });
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
