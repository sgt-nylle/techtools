export type ThemeId = 'bridge' | 'navy' | 'radar' | 'oled-black' | 'paper-navy';

export interface ThemeDef {
  id: ThemeId;
  label: string;
  title: string;
  metaColor: string;
  /** Flat themes drop CRT scanlines / vignette / glow effects. */
  flat: boolean;
}

export const THEMES: ThemeDef[] = [
  { id: 'bridge', label: 'BRIDGE', title: 'Bridge — Clean Navy / Light (default)', metaColor: '#f5f7fa', flat: true },
  { id: 'navy', label: 'NAVY', title: 'Navy — Classic Sub (dark sonar terminal)', metaColor: '#123878', flat: false },
  { id: 'radar', label: 'RADAR', title: 'Radar — Amber Phosphor Terminal (black + amber)', metaColor: '#000000', flat: true },
  { id: 'oled-black', label: 'OLED', title: 'OLED Black — Pure Dark (true black, single accent)', metaColor: '#000000', flat: true },
  { id: 'paper-navy', label: 'PAPER', title: 'Paper Navy — High-Contrast Light (cream + deep navy)', metaColor: '#faf6ea', flat: true },
];

export const DEFAULT_THEME: ThemeId = 'bridge';

const THEME_COOKIE = 'tt_theme';
const THEME_STORAGE_KEY = 'tt_theme';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function isThemeId(v: unknown): v is ThemeId {
  return THEMES.some((t) => t.id === v);
}

function readCookie(): string | null {
  try {
    const entry = document.cookie.split('; ').find((c) => c.startsWith(`${THEME_COOKIE}=`));
    return entry ? decodeURIComponent(entry.slice(THEME_COOKIE.length + 1)) : null;
  } catch {
    return null;
  }
}

/** Reads the persisted theme (cookie first, localStorage fallback). */
export function loadTheme(): ThemeId {
  const fromCookie = readCookie();
  if (fromCookie === 'clean') return 'bridge'; // legacy id (renamed)
  if (fromCookie === 'amber-phosphor' || fromCookie === 'amber') return 'radar'; // legacy id (renamed)
  if (isThemeId(fromCookie)) return fromCookie;
  try {
    const fromStorage = localStorage.getItem(THEME_STORAGE_KEY);
    if (fromStorage === 'clean') return 'bridge'; // legacy id (renamed)
    if (fromStorage === 'amber-phosphor' || fromStorage === 'amber') return 'radar'; // legacy id (renamed)
    if (isThemeId(fromStorage)) return fromStorage;
  } catch {
    // storage unavailable
  }
  return DEFAULT_THEME;
}

/** Applies the theme to <html> and the browser theme-color meta tag. */
export function applyTheme(id: ThemeId): void {
  document.documentElement.setAttribute('data-theme', id);
  const def = THEMES.find((t) => t.id === id);
  if (def?.flat) document.documentElement.setAttribute('data-flat', '');
  else document.documentElement.removeAttribute('data-flat');
  if (def) {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', def.metaColor);
  }
}

/** Persists the theme via cookie, with localStorage as a fallback/mirror. */
export function saveTheme(id: ThemeId): void {
  try {
    document.cookie = `${THEME_COOKIE}=${encodeURIComponent(id)}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax`;
  } catch {
    // cookies blocked
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    // storage unavailable
  }
}

export function nextTheme(id: ThemeId): ThemeId {
  const idx = THEMES.findIndex((t) => t.id === id);
  return THEMES[(idx + 1) % THEMES.length].id;
}
