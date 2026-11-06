import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { sound } from '../utils/audio';

type GenMode = 'password' | 'passphrase' | 'tokens';
type ComplexityPreset = 'pin' | '64bit' | 'standard' | 'fortress';

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?';
// Characters easily confused across proportional/sans-serif fonts (0/O/o, 1/l/I/|)
const CONFUSING_CHARS = new Set(['0', 'O', 'o', '1', 'l', 'I', '|']);
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

// Multi-branch passphrase dictionary: Navy, Nature, Food, Drinks, Cars, Fitness & Tech
const RAW_WORDLIST = [
  // Navy & Maritime
  'anchor', 'arctic', 'baltic', 'beacon', 'compass', 'convoy', 'corvette', 'cruiser',
  'dolphin', 'fathom', 'fjord', 'fleet', 'frigate', 'galley', 'gotland', 'harbor',
  'helmsman', 'horizon', 'iceberg', 'island', 'keel', 'kestrel', 'lagoon', 'lighthouse',
  'mariner', 'nautilus', 'navigant', 'ocean', 'osprey', 'pelican', 'periscope', 'polaris',
  'propeller', 'radar', 'rudder', 'sailor', 'seabird', 'sonar', 'spica', 'squadron',
  'starboard', 'submarine', 'tempest', 'trident', 'vessel', 'viking', 'visby', 'voyager',

  // Nature & Outdoors
  'acorn', 'alpine', 'amber', 'autumn', 'bamboo', 'birch', 'blossom', 'boulder',
  'breeze', 'canyon', 'cedar', 'cliff', 'clover', 'coral', 'cricket', 'crystal',
  'cypress', 'daisy', 'desert', 'eclipse', 'emerald', 'falcon', 'fern', 'firefly',
  'forest', 'glacier', 'granite', 'grove', 'heather', 'hilltop', 'jasmine', 'juniper',
  'lavender', 'maple', 'meadow', 'monsoon', 'mountain', 'oakwood', 'orchid', 'otter',
  'panther', 'pebble', 'pinecone', 'prairie', 'raindrop', 'redwood', 'river', 'robin',
  'sequoia', 'sparrow', 'summit', 'sunbeam', 'sunrise', 'thistle', 'thunder', 'timber',
  'tundra', 'valley', 'volcano', 'waterfall', 'willow', 'woodland', 'zephyr',

  // Food & Culinary
  'almond', 'apricot', 'avocado', 'bagel', 'basil', 'biscuit', 'blueberry', 'brioche',
  'brownie', 'burrito', 'caramel', 'cashew', 'cheddar', 'cherry', 'cinnamon', 'coconut',
  'cookie', 'croissant', 'cupcake', 'dumpling', 'fennel', 'focaccia', 'garlic', 'ginger',
  'granola', 'guava', 'hazelnut', 'honey', 'lasagna', 'lemon', 'lentil', 'mango',
  'melon', 'muffin', 'mustard', 'nachos', 'noodle', 'nutmeg', 'olive', 'omelet',
  'orange', 'pancake', 'papaya', 'paprika', 'parsley', 'pasta', 'peach', 'peanut',
  'pecan', 'pepper', 'pickle', 'pistachio', 'pizza', 'popcorn', 'pretzel', 'pumpkin',
  'quinoa', 'radish', 'raisin', 'ramen', 'raspberry', 'risotto', 'rosemary', 'saffron',
  'salmon', 'salsa', 'sesame', 'sorbet', 'spinach', 'strawberry', 'sushi', 'taco',
  'tangerine', 'thyme', 'toffee', 'tomato', 'truffle', 'vanilla', 'waffle', 'walnut',
  'wasabi', 'yogurt',

  // Drinks & Cafe
  'americano', 'barista', 'bourbon', 'cappuccino', 'chai', 'cider', 'cocoa', 'coffee',
  'cola', 'cordial', 'cortado', 'espresso', 'frappe', 'hibiscus', 'icedtea', 'kombucha',
  'latte', 'lemonade', 'limeade', 'macchiato', 'malbec', 'matcha', 'merlot', 'milkshake',
  'mimosa', 'mocha', 'mojito', 'nectar', 'oolong', 'pilsner', 'porter', 'prosecco',
  'ristretto', 'rooibos', 'sangria', 'seltzer', 'smoothie', 'soda', 'spritzer',
  'stout', 'teacup', 'tonic',

  // Cars & Motorsport
  'alloy', 'apex', 'axle', 'boost', 'bumper', 'cabriolet', 'camber', 'camshaft',
  'chassis', 'chicane', 'clutch', 'cockpit', 'coupe', 'cruising', 'cylinder', 'dashboard',
  'diffuser', 'downforce', 'drivetrain', 'dynamo', 'exhaust', 'fastback', 'fender', 'flywheel',
  'formula', 'gearbox', 'grille', 'hairpin', 'hatchback', 'headlight', 'highway', 'hybrid',
  'ignition', 'injector', 'manifold', 'muffler', 'mustang', 'nitro', 'octane', 'odometer',
  'offroad', 'overdrive', 'paddock', 'pedal', 'piston', 'pitstop', 'radiator', 'rally',
  'redline', 'roadster', 'rotor', 'sedan', 'shifter', 'spoiler', 'steering', 'supercar',
  'tailgate', 'throttle', 'torque', 'touring', 'traction', 'turbo', 'wheelbase',

  // Fitness & Sports
  'aerobics', 'agility', 'athlete', 'barbell', 'biathlon', 'boxing', 'burpee', 'cadence',
  'cardio', 'climber', 'cooldown', 'crossfit', 'cycling', 'deadlift', 'decathlon', 'dumbbell',
  'endurance', 'fencing', 'footwork', 'freestyle', 'gymnast', 'halftime', 'hamstring', 'handstand',
  'hurdle', 'hydrate', 'interval', 'jogging', 'kayak', 'kettlebell', 'kickbox', 'lunge',
  'marathon', 'medal', 'mobility', 'olympic', 'paddle', 'parkour', 'peloton', 'pilates',
  'plank', 'playoff', 'podium', 'posture', 'pullup', 'pushup', 'racquet', 'recovery',
  'reflex', 'relay', 'rowing', 'runner', 'shuttle', 'skater', 'slalom', 'squat',
  'stamina', 'stretch', 'stride', 'surfing', 'swimmer', 'tempo', 'tennis', 'treadmill',
  'triathlon', 'trophy', 'vault', 'volley', 'warmup', 'wellness', 'workout', 'yoga',

  // Tech & Computing
  'algorithm', 'analog', 'android', 'applet', 'archive', 'avatar', 'backend', 'bandwidth',
  'battery', 'binary', 'bitstream', 'bluetooth', 'boolean', 'browser', 'buffer', 'bytecode',
  'cache', 'camera', 'chipset', 'circuit', 'cloudnet', 'cluster', 'codec', 'compile',
  'console', 'cortex', 'crypto', 'cursor', 'cyber', 'database', 'debug', 'desktop',
  'digital', 'display', 'docker', 'domain', 'driver', 'ethernet', 'fiber', 'firewall',
  'firmware', 'frontend', 'gadget', 'gateway', 'gigabit', 'graphics', 'hardware', 'headset',
  'hotkey', 'index', 'internet', 'kernel', 'keyboard', 'laptop', 'laser', 'latency',
  'linux', 'logic', 'macro', 'mainframe', 'matrix', 'memory', 'microchip', 'modem',
  'monitor', 'network', 'neural', 'notebook', 'optical', 'packet', 'parser', 'pixel',
  'platform', 'plugin', 'pointer', 'portal', 'processor', 'protocol', 'proxy', 'python',
  'quantum', 'query', 'reboot', 'render', 'router', 'runtime', 'sandbox', 'scanner',
  'schema', 'script', 'sensor', 'server', 'shader', 'silicon', 'socket', 'software',
  'storage', 'stream', 'subnet', 'switch', 'syntax', 'tablet', 'terminal', 'thread',
  'token', 'tracker', 'transistor', 'uplink', 'vector', 'virtual', 'widget', 'wireless',
];

const WORDLIST = Array.from(new Set(RAW_WORDLIST));

const PREFS_COOKIE_NAME = 'tt_passgen_prefs';
const PREFS_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

interface PassGenPrefs {
  length: number;
  useUpper: boolean;
  useLower: boolean;
  useDigits: boolean;
  useSymbols: boolean;
  noConfuse: boolean;
  batchCount: number;
  wordCount: number;
  separator: string;
  capitalizeWords: boolean;
  appendDigits: boolean;
}

// Default: 64bit (16) preset + No Confuse checked
const DEFAULT_PREFS: PassGenPrefs = {
  length: 16,
  useUpper: true,
  useLower: true,
  useDigits: true,
  useSymbols: false,
  noConfuse: true,
  batchCount: 5,
  wordCount: 4,
  separator: '-',
  capitalizeWords: false,
  appendDigits: true,
};

function readPassGenCookie(): PassGenPrefs {
  if (typeof document === 'undefined') return DEFAULT_PREFS;
  try {
    const match = document.cookie
      .split('; ')
      .find((entry) => entry.startsWith(`${PREFS_COOKIE_NAME}=`));
    if (!match) return DEFAULT_PREFS;
    const rawJson = decodeURIComponent(match.slice(PREFS_COOKIE_NAME.length + 1));
    const parsed = JSON.parse(rawJson) as Partial<PassGenPrefs>;

    const clampInt = (val: unknown, min: number, max: number, fallback: number) => {
      const n = Number(val);
      return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
    };

    const validSeps = ['-', '.', '_', ' '];
    const validBatches = [1, 5, 10];

    return {
      length: clampInt(parsed.length, 6, 64, DEFAULT_PREFS.length),
      useUpper: typeof parsed.useUpper === 'boolean' ? parsed.useUpper : DEFAULT_PREFS.useUpper,
      useLower: typeof parsed.useLower === 'boolean' ? parsed.useLower : DEFAULT_PREFS.useLower,
      useDigits: typeof parsed.useDigits === 'boolean' ? parsed.useDigits : DEFAULT_PREFS.useDigits,
      useSymbols: typeof parsed.useSymbols === 'boolean' ? parsed.useSymbols : DEFAULT_PREFS.useSymbols,
      noConfuse: typeof parsed.noConfuse === 'boolean' ? parsed.noConfuse : DEFAULT_PREFS.noConfuse,
      batchCount: validBatches.includes(Number(parsed.batchCount))
        ? Number(parsed.batchCount)
        : DEFAULT_PREFS.batchCount,
      wordCount: clampInt(parsed.wordCount, 3, 8, DEFAULT_PREFS.wordCount),
      separator:
        typeof parsed.separator === 'string' && validSeps.includes(parsed.separator)
          ? parsed.separator
          : DEFAULT_PREFS.separator,
      capitalizeWords:
        typeof parsed.capitalizeWords === 'boolean'
          ? parsed.capitalizeWords
          : DEFAULT_PREFS.capitalizeWords,
      appendDigits:
        typeof parsed.appendDigits === 'boolean' ? parsed.appendDigits : DEFAULT_PREFS.appendDigits,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function writePassGenCookie(prefs: PassGenPrefs): void {
  if (typeof document === 'undefined') return;
  try {
    const encoded = encodeURIComponent(JSON.stringify(prefs));
    document.cookie = `${PREFS_COOKIE_NAME}=${encoded}; Max-Age=${PREFS_COOKIE_MAX_AGE}; Path=/; SameSite=Lax`;
  } catch {
    // Ignore cookie storage restrictions
  }
}

function secureRandomInt(maxExclusive: number): number {
  if (maxExclusive <= 1) return 0;
  const maxUint32 = 0xffffffff;
  const limit = maxUint32 - ((maxUint32 + 1) % maxExclusive);
  const buf = new Uint32Array(1);
  while (true) {
    window.crypto.getRandomValues(buf);
    if (buf[0] <= limit) {
      return buf[0] % maxExclusive;
    }
  }
}

function secureShuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function randomBytesHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function randomBytesBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  window.crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomBase62(length: number): string {
  const chars: string[] = [];
  for (let i = 0; i < length; i++) {
    chars.push(BASE62[secureRandomInt(BASE62.length)]);
  }
  return chars.join('');
}

function generateUuidV4(): string {
  if (typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

export const PassGenTool: React.FC = () => {
  const initialPrefs = useMemo(() => readPassGenCookie(), []);

  const [mode, setMode] = useState<GenMode>('password');

  // Password state (defaults to 64bit (16) + No Confuse checked, honoring saved cookie)
  const [length, setLength] = useState<number>(initialPrefs.length);
  const [useUpper, setUseUpper] = useState<boolean>(initialPrefs.useUpper);
  const [useLower, setUseLower] = useState<boolean>(initialPrefs.useLower);
  const [useDigits, setUseDigits] = useState<boolean>(initialPrefs.useDigits);
  const [useSymbols, setUseSymbols] = useState<boolean>(initialPrefs.useSymbols);
  const [noConfuse, setNoConfuse] = useState<boolean>(initialPrefs.noConfuse);
  const [batchCount, setBatchCount] = useState<number>(initialPrefs.batchCount);
  const [pwNonce, setPwNonce] = useState<number>(0);

  // Passphrase state
  const [wordCount, setWordCount] = useState<number>(initialPrefs.wordCount);
  const [separator, setSeparator] = useState<string>(initialPrefs.separator);
  const [capitalizeWords, setCapitalizeWords] = useState<boolean>(initialPrefs.capitalizeWords);
  const [appendDigits, setAppendDigits] = useState<boolean>(initialPrefs.appendDigits);
  const [ppNonce, setPpNonce] = useState<number>(0);

  // Token state
  const [apiPrefix, setApiPrefix] = useState<string>('sw_live_');
  const [tokNonce, setTokNonce] = useState<number>(0);
  const prefixInputRef = useRef<HTMLInputElement>(null);

  // Copy feedback
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Persist user preferences in cookie whenever modified
  useEffect(() => {
    writePassGenCookie({
      length,
      useUpper,
      useLower,
      useDigits,
      useSymbols,
      noConfuse,
      batchCount,
      wordCount,
      separator,
      capitalizeWords,
      appendDigits,
    });
  }, [
    length,
    useUpper,
    useLower,
    useDigits,
    useSymbols,
    noConfuse,
    batchCount,
    wordCount,
    separator,
    capitalizeWords,
    appendDigits,
  ]);

  const copyText = useCallback(async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      sound.playCopy();
      setCopiedId(id);
      window.setTimeout(() => {
        setCopiedId((prev) => (prev === id ? null : prev));
      }, 1600);
    } catch {
      sound.playError();
    }
  }, []);

  const { passwords, poolSize } = useMemo(() => {
    void pwNonce;
    const filterChars = (str: string) =>
      noConfuse ? [...str].filter((c) => !CONFUSING_CHARS.has(c)).join('') : str;

    const groups: string[] = [];
    if (useUpper) groups.push(filterChars(UPPER));
    if (useLower) groups.push(filterChars(LOWER));
    if (useDigits) groups.push(filterChars(DIGITS));
    if (useSymbols) groups.push(filterChars(SYMBOLS));

    const validGroups = groups.filter((g) => g.length > 0);
    if (validGroups.length === 0) {
      return { passwords: [] as string[], poolSize: 0 };
    }

    const fullPool = validGroups.join('');
    const list: string[] = [];
    for (let b = 0; b < batchCount; b++) {
      const chars: string[] = [];
      for (let g = 0; g < Math.min(validGroups.length, length); g++) {
        const grp = validGroups[g];
        chars.push(grp[secureRandomInt(grp.length)]);
      }
      while (chars.length < length) {
        chars.push(fullPool[secureRandomInt(fullPool.length)]);
      }
      list.push(secureShuffle(chars).join(''));
    }
    return { passwords: list, poolSize: fullPool.length };
  }, [length, useUpper, useLower, useDigits, useSymbols, noConfuse, batchCount, pwNonce]);

  const passphrases = useMemo(() => {
    void ppNonce;
    const list: string[] = [];
    for (let b = 0; b < 5; b++) {
      const picked: string[] = [];
      for (let w = 0; w < wordCount; w++) {
        let word = WORDLIST[secureRandomInt(WORDLIST.length)];
        if (capitalizeWords) {
          word = word.charAt(0).toUpperCase() + word.slice(1);
        }
        picked.push(word);
      }
      let phrase = picked.join(separator);
      if (appendDigits) {
        const num = String(secureRandomInt(90) + 10);
        phrase = `${phrase}${separator === ' ' ? '' : separator}${num}`;
      }
      list.push(phrase);
    }
    return list;
  }, [wordCount, separator, capitalizeWords, appendDigits, ppNonce]);

  const tokens = useMemo(() => {
    void tokNonce;
    const safePrefix = apiPrefix.replace(/\s+/g, '');
    return {
      uuid: generateUuidV4(),
      hex128: randomBytesHex(16),
      hex256: randomBytesHex(32),
      base64url256: randomBytesBase64Url(32),
      base64url512: randomBytesBase64Url(64),
      apiKey: `${safePrefix}${randomBase62(36)}`,
    };
  }, [apiPrefix, tokNonce]);

  // Apply complexity preset while honoring the user's current NO CONFUSE setting
  const applyPreset = useCallback((preset: ComplexityPreset) => {
    sound.playBlip();
    setMode('password');
    if (preset === 'pin') {
      setLength(8);
      setUseUpper(false);
      setUseLower(false);
      setUseDigits(true);
      setUseSymbols(false);
    } else if (preset === '64bit') {
      setLength(16);
      setUseUpper(true);
      setUseLower(true);
      setUseDigits(true);
      setUseSymbols(false);
    } else if (preset === 'standard') {
      setLength(20);
      setUseUpper(true);
      setUseLower(true);
      setUseDigits(true);
      setUseSymbols(true);
    } else {
      setLength(32);
      setUseUpper(true);
      setUseLower(true);
      setUseDigits(true);
      setUseSymbols(true);
    }
    setPwNonce((n) => n + 1);
  }, []);

  // Determine which preset currently matches active password configuration
  const activePreset = useMemo((): ComplexityPreset | null => {
    if (length === 8 && !useUpper && !useLower && useDigits && !useSymbols) {
      return 'pin';
    }
    if (length === 16 && useUpper && useLower && useDigits && !useSymbols) {
      return '64bit';
    }
    if (length === 20 && useUpper && useLower && useDigits && useSymbols) {
      return 'standard';
    }
    if (length === 32 && useUpper && useLower && useDigits && useSymbols) {
      return 'fortress';
    }
    return null;
  }, [length, useUpper, useLower, useDigits, useSymbols]);

  // Keyboard shortcuts for PassGenTool
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const isTextInput =
        (target?.tagName === 'INPUT' &&
          (target as HTMLInputElement).type !== 'checkbox' &&
          (target as HTMLInputElement).type !== 'range') ||
        target?.tagName === 'TEXTAREA';
      if (isTextInput) return;

      const k = e.key.toLowerCase();

      // Mode switching: [P] Passwords, [W] Passphrases, [T] Tokens
      if (k === 'p') {
        e.preventDefault();
        sound.playClick();
        setMode('password');
        return;
      }
      if (k === 'w') {
        e.preventDefault();
        sound.playClick();
        setMode('passphrase');
        return;
      }
      if (k === 't') {
        e.preventDefault();
        sound.playClick();
        setMode('tokens');
        return;
      }

      // [R] Regenerate / Roll active mode
      if (k === 'r') {
        e.preventDefault();
        sound.playBlip();
        if (mode === 'password') setPwNonce((n) => n + 1);
        else if (mode === 'passphrase') setPpNonce((n) => n + 1);
        else setTokNonce((n) => n + 1);
        return;
      }

      // [C] Copy primary item when no specific secret row handled it
      if (k === 'c') {
        e.preventDefault();
        if (mode === 'password' && passwords[0]) {
          void copyText(passwords[0], 'pw-0');
        } else if (mode === 'passphrase' && passphrases[0]) {
          void copyText(passphrases[0], 'pp-0');
        } else if (mode === 'tokens') {
          void copyText(tokens.uuid, 'tok-uuid');
        }
        return;
      }

      // [A] Copy All
      if (k === 'a') {
        if (mode === 'password' && passwords.length > 0) {
          e.preventDefault();
          void copyText(passwords.join('\n'), 'pw-all');
        } else if (mode === 'passphrase' && passphrases.length > 0) {
          e.preventDefault();
          void copyText(passphrases.join('\n'), 'pp-all');
        }
        return;
      }

      if (mode === 'password') {
        if (k === 'n') {
          e.preventDefault();
          applyPreset('pin');
        } else if (k === 'b' || k === 'e') {
          e.preventDefault();
          applyPreset('64bit');
        } else if (k === 'd') {
          e.preventDefault();
          applyPreset('standard');
        } else if (k === 'f') {
          e.preventDefault();
          applyPreset('fortress');
        } else if (k === '-') {
          e.preventDefault();
          sound.playClick();
          setLength((l) => Math.max(6, l - 2));
        } else if (k === '+' || k === '=') {
          e.preventDefault();
          sound.playClick();
          setLength((l) => Math.min(64, l + 2));
        } else if (k === 'u') {
          e.preventDefault();
          sound.playClick();
          setUseUpper((v) => !v);
        } else if (k === 'l') {
          e.preventDefault();
          sound.playClick();
          setUseLower((v) => !v);
        } else if (k === 'g') {
          e.preventDefault();
          sound.playClick();
          setUseDigits((v) => !v);
        } else if (k === 'y') {
          e.preventDefault();
          sound.playClick();
          setUseSymbols((v) => !v);
        } else if (k === 'x') {
          e.preventDefault();
          sound.playClick();
          setNoConfuse((v) => !v);
        }
      } else if (mode === 'passphrase') {
        if (k === '-') {
          e.preventDefault();
          sound.playClick();
          setWordCount((w) => Math.max(3, w - 1));
        } else if (k === '+' || k === '=') {
          e.preventDefault();
          sound.playClick();
          setWordCount((w) => Math.min(8, w + 1));
        } else if (k === 'k') {
          e.preventDefault();
          sound.playClick();
          setCapitalizeWords((v) => !v);
        } else if (k === 'g') {
          e.preventDefault();
          sound.playClick();
          setAppendDigits((v) => !v);
        }
      } else if (mode === 'tokens') {
        if (k === 'q' || k === '/') {
          e.preventDefault();
          sound.playClick();
          prefixInputRef.current?.focus();
          prefixInputRef.current?.select();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, passwords, passphrases, tokens.uuid, copyText, applyPreset]);

  const entropyBits =
    mode === 'password'
      ? poolSize > 1
        ? Math.round(length * Math.log2(poolSize))
        : 0
      : mode === 'passphrase'
      ? Math.round(wordCount * Math.log2(WORDLIST.length) + (appendDigits ? Math.log2(90) : 0))
      : 256;

  const strengthLabel = useMemo(() => {
    if (mode === 'password') {
      if (poolSize <= 1) {
        return { text: 'LOW ENTROPY', cls: 'status-err' };
      }
      if (length >= 32 && entropyBits >= 100) {
        return { text: 'ULTRA NAVY CRYPTO', cls: 'status-ultra' };
      }
      if (entropyBits >= 110) {
        return { text: 'NAVY CRYPTO GRADE', cls: 'status-ok' };
      }
      if (entropyBits >= 75) {
        return { text: 'STRONG', cls: 'status-ok' };
      }
      if (entropyBits >= 50) {
        return { text: 'MODERATE', cls: 'status-warn' };
      }
      return { text: 'LOW ENTROPY', cls: 'status-err' };
    }

    if (mode === 'passphrase') {
      if (wordCount > 5) {
        return { text: 'NAVY CRYPTO GRADE', cls: 'status-ok' };
      }
      if (wordCount >= 4) {
        return { text: 'MODERATE', cls: 'status-warn' };
      }
      return { text: 'LOW ENTROPY', cls: 'status-err' };
    }

    return { text: 'ULTRA NAVY CRYPTO', cls: 'status-ultra' };
  }, [mode, length, poolSize, entropyBits, wordCount]);

  return (
    <div className="tool-panel">
      {/* MODE SWITCHER */}
      <div className="sub-tabs-row">
        <button
          type="button"
          className={`navy-tab-btn ${mode === 'password' ? 'active' : ''}`}
          onClick={() => {
            sound.playClick();
            setMode('password');
          }}
        >
          🔑 PASSWORDS [P]
        </button>
        <button
          type="button"
          className={`navy-tab-btn ${mode === 'passphrase' ? 'active' : ''}`}
          onClick={() => {
            sound.playClick();
            setMode('passphrase');
          }}
        >
          📜 PASSPHRASES [W]
        </button>
        <button
          type="button"
          className={`navy-tab-btn ${mode === 'tokens' ? 'active' : ''}`}
          onClick={() => {
            sound.playClick();
            setMode('tokens');
          }}
        >
          🪙 API TOKENS &amp; KEYS [T]
        </button>
      </div>

      {/* ENTROPY & CSPRNG TELEMETRY BANNER */}
      <div className="telemetry-strip c64-box">
        <div className="tele-cell">
          <span className="tele-lbl">ENGINE</span>
          <span className="tele-val text-cyan">WEB CRYPTO CSPRNG</span>
        </div>
        <div className="tele-cell">
          <span className="tele-lbl">ENTROPY</span>
          <span className="tele-val text-gold">~{entropyBits} BITS</span>
        </div>
        <div className="tele-cell">
          <span className="tele-lbl">STRENGTH</span>
          <span className={`tele-val ${strengthLabel.cls}`}>{strengthLabel.text}</span>
        </div>
        <div className="tele-cell">
          <span className="tele-lbl">PRIVACY</span>
          <span className="tele-val status-ok">100% LOCAL BROWSER</span>
        </div>
      </div>

      {/* ==================== 1. PASSWORD MODE ==================== */}
      {mode === 'password' && (
        <>
          <div className="controls-card c64-box">
            <div className="preset-bar">
              <span className="control-heading">COMPLEXITY PRESETS:</span>
              <div className="preset-buttons">
                <button
                  type="button"
                  className={`navy-btn btn-sm ${activePreset === 'pin' ? 'btn-active' : ''}`}
                  onClick={() => applyPreset('pin')}
                >
                  PIN (8) [N]
                </button>
                <button
                  type="button"
                  className={`navy-btn btn-sm ${activePreset === '64bit' ? 'btn-active' : ''}`}
                  onClick={() => applyPreset('64bit')}
                >
                  64BIT (16) [B]
                </button>
                <button
                  type="button"
                  className={`navy-btn btn-sm ${activePreset === 'standard' ? 'btn-active' : ''}`}
                  onClick={() => applyPreset('standard')}
                >
                  STANDARD IT (20) [D]
                </button>
                <button
                  type="button"
                  className={`navy-btn btn-sm ${activePreset === 'fortress' ? 'btn-active' : ''}`}
                  onClick={() => applyPreset('fortress')}
                >
                  FORTRESS (32) [F]
                </button>
              </div>
            </div>

            <div className="slider-grid">
              <div className="slider-block">
                <label htmlFor="pw-len">
                  LENGTH [- / +]: <strong className="text-gold">{length} CHARS</strong>
                </label>
                <div className="range-row">
                  <button
                    type="button"
                    className="navy-btn btn-sm"
                    title="Decrease length [-]"
                    onClick={() => {
                      sound.playClick();
                      setLength((l) => Math.max(6, l - 2));
                    }}
                  >
                    [-]
                  </button>
                  <input
                    id="pw-len"
                    type="range"
                    min={6}
                    max={64}
                    value={length}
                    onChange={(e) => setLength(Number(e.target.value))}
                  />
                  <button
                    type="button"
                    className="navy-btn btn-sm"
                    title="Increase length [+]"
                    onClick={() => {
                      sound.playClick();
                      setLength((l) => Math.min(64, l + 2));
                    }}
                  >
                    [+]
                  </button>
                </div>
              </div>

              <div className="slider-block">
                <label>BATCH COUNT:</label>
                <div className="preset-buttons">
                  {[1, 5, 10].map((cnt) => (
                    <button
                      key={cnt}
                      type="button"
                      className={`navy-btn btn-sm ${batchCount === cnt ? 'btn-active' : ''}`}
                      onClick={() => {
                        sound.playClick();
                        setBatchCount(cnt);
                      }}
                    >
                      {cnt}×
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="toggles-grid">
              <label className="retro-check">
                <input
                  type="checkbox"
                  checked={useUpper}
                  onChange={(e) => {
                    sound.playClick();
                    setUseUpper(e.target.checked);
                  }}
                />
                <span>UPPERCASE (A–Z) [U]</span>
              </label>
              <label className="retro-check">
                <input
                  type="checkbox"
                  checked={useLower}
                  onChange={(e) => {
                    sound.playClick();
                    setUseLower(e.target.checked);
                  }}
                />
                <span>LOWERCASE (a–z) [L]</span>
              </label>
              <label className="retro-check">
                <input
                  type="checkbox"
                  checked={useDigits}
                  onChange={(e) => {
                    sound.playClick();
                    setUseDigits(e.target.checked);
                  }}
                />
                <span>DIGITS (0–9) [G]</span>
              </label>
              <label className="retro-check">
                <input
                  type="checkbox"
                  checked={useSymbols}
                  onChange={(e) => {
                    sound.playClick();
                    setUseSymbols(e.target.checked);
                  }}
                />
                <span>SYMBOLS (!@#...) [Y]</span>
              </label>
              <label
                className="retro-check"
                title="Excludes look-alike characters (0, O, o, 1, l, I) that can be misread across fonts"
              >
                <input
                  type="checkbox"
                  checked={noConfuse}
                  onChange={(e) => {
                    sound.playClick();
                    setNoConfuse(e.target.checked);
                  }}
                />
                <span>NO CONFUSE [X]</span>
              </label>
            </div>

            <div className="action-bar-right">
              <button
                type="button"
                className="navy-btn btn-primary"
                onClick={() => {
                  sound.playBlip();
                  setPwNonce((n) => n + 1);
                }}
              >
                ⟳ REGENERATE [R]
              </button>
              {passwords.length > 1 && (
                <button
                  type="button"
                  className={`navy-btn ${copiedId === 'pw-all' ? 'btn-copied' : ''}`}
                  onClick={() => copyText(passwords.join('\n'), 'pw-all')}
                >
                  {copiedId === 'pw-all' ? '✓ COPIED ALL' : '📋 COPY ALL [A]'}
                </button>
              )}
            </div>
          </div>

          <div className="output-list c64-box">
            {passwords.length === 0 ? (
              <div className="empty-alert status-err">
                ⚠ Enable at least one character set above to generate passwords.
              </div>
            ) : (
              passwords.map((pw, idx) => {
                const id = `pw-${idx}`;
                return (
                  <div
                    key={id}
                    tabIndex={0}
                    className={`secret-row focusable-row ${copiedId === id ? 'row-copied' : ''}`}
                    onKeyDown={(e) => {
                      if (
                        !e.metaKey &&
                        !e.ctrlKey &&
                        !e.altKey &&
                        (e.key === 'c' || e.key === 'C' || e.key === 'Enter')
                      ) {
                        e.preventDefault();
                        e.stopPropagation();
                        void copyText(pw, id);
                      }
                    }}
                  >
                    <span className="secret-idx">#{idx + 1}</span>
                    <code className="secret-code">{pw}</code>
                    <button
                      type="button"
                      tabIndex={-1}
                      className={`navy-btn btn-sm ${copiedId === id ? 'btn-copied' : ''}`}
                      onClick={() => copyText(pw, id)}
                    >
                      {copiedId === id ? '✓ COPIED' : 'COPY [C]'}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {/* ==================== 2. PASSPHRASE MODE ==================== */}
      {mode === 'passphrase' && (
        <>
          <div className="controls-card c64-box">
            <div className="slider-grid">
              <div className="slider-block">
                <label htmlFor="word-cnt">
                  WORDS [- / +]: <strong className="text-gold">{wordCount} WORDS</strong>
                </label>
                <div className="range-row">
                  <button
                    type="button"
                    className="navy-btn btn-sm"
                    onClick={() => {
                      sound.playClick();
                      setWordCount((w) => Math.max(3, w - 1));
                    }}
                  >
                    [-]
                  </button>
                  <input
                    id="word-cnt"
                    type="range"
                    min={3}
                    max={8}
                    value={wordCount}
                    onChange={(e) => setWordCount(Number(e.target.value))}
                  />
                  <button
                    type="button"
                    className="navy-btn btn-sm"
                    onClick={() => {
                      sound.playClick();
                      setWordCount((w) => Math.min(8, w + 1));
                    }}
                  >
                    [+]
                  </button>
                </div>
              </div>
              <div className="slider-block">
                <label>SEPARATOR:</label>
                <div className="preset-buttons">
                  {[
                    { label: 'HYPHEN (-)', val: '-' },
                    { label: 'DOT (.)', val: '.' },
                    { label: 'UNDERSCORE (_)', val: '_' },
                    { label: 'SPACE', val: ' ' },
                  ].map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      className={`navy-btn btn-sm ${separator === s.val ? 'btn-active' : ''}`}
                      onClick={() => {
                        sound.playClick();
                        setSeparator(s.val);
                      }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="toggles-grid">
              <label className="retro-check">
                <input
                  type="checkbox"
                  checked={capitalizeWords}
                  onChange={(e) => {
                    sound.playClick();
                    setCapitalizeWords(e.target.checked);
                  }}
                />
                <span>CAPITALIZE WORDS [K]</span>
              </label>
              <label className="retro-check">
                <input
                  type="checkbox"
                  checked={appendDigits}
                  onChange={(e) => {
                    sound.playClick();
                    setAppendDigits(e.target.checked);
                  }}
                />
                <span>APPEND 2-DIGIT NUMBER [G]</span>
              </label>
            </div>

            <div className="action-bar-right">
              <button
                type="button"
                className="navy-btn btn-primary"
                onClick={() => {
                  sound.playBlip();
                  setPpNonce((n) => n + 1);
                }}
              >
                ⟳ REGENERATE [R]
              </button>
              <button
                type="button"
                className={`navy-btn ${copiedId === 'pp-all' ? 'btn-copied' : ''}`}
                onClick={() => copyText(passphrases.join('\n'), 'pp-all')}
              >
                {copiedId === 'pp-all' ? '✓ COPIED ALL' : '📋 COPY ALL [A]'}
              </button>
            </div>
          </div>

          <div className="output-list c64-box">
            {passphrases.map((pp, idx) => {
              const id = `pp-${idx}`;
              return (
                <div
                  key={id}
                  tabIndex={0}
                  className={`secret-row focusable-row ${copiedId === id ? 'row-copied' : ''}`}
                  onKeyDown={(e) => {
                    if (
                      !e.metaKey &&
                      !e.ctrlKey &&
                      !e.altKey &&
                      (e.key === 'c' || e.key === 'C' || e.key === 'Enter')
                    ) {
                      e.preventDefault();
                      e.stopPropagation();
                      void copyText(pp, id);
                    }
                  }}
                >
                  <span className="secret-idx">#{idx + 1}</span>
                  <code className="secret-code">{pp}</code>
                  <button
                    type="button"
                    tabIndex={-1}
                    className={`navy-btn btn-sm ${copiedId === id ? 'btn-copied' : ''}`}
                    onClick={() => copyText(pp, id)}
                  >
                    {copiedId === id ? '✓ COPIED' : 'COPY [C]'}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ==================== 3. API TOKENS & KEYS MODE ==================== */}
      {mode === 'tokens' && (
        <>
          <div className="controls-card c64-box">
            <div className="inline-input-row">
              <label htmlFor="tok-prefix">API KEY PREFIX [Q]:</label>
              <input
                ref={prefixInputRef}
                id="tok-prefix"
                type="text"
                value={apiPrefix}
                maxLength={20}
                onChange={(e) => setApiPrefix(e.target.value)}
                className="navy-input input-compact"
                placeholder="sw_live_ (ESC unlocks keys)"
              />
              <button
                type="button"
                className="navy-btn btn-primary"
                onClick={() => {
                  sound.playBlip();
                  setTokNonce((n) => n + 1);
                }}
              >
                ⟳ ROLL ALL TOKENS [R]
              </button>
            </div>
          </div>

          <div className="output-list c64-box">
            {[
              { id: 'tok-uuid', label: 'UUID v4 (RFC 4122)', val: tokens.uuid },
              { id: 'tok-api', label: 'PREFIXED API SECRET KEY (BASE62)', val: tokens.apiKey },
              { id: 'tok-hex128', label: '128-BIT HEX KEY (AES-128 / SALT)', val: tokens.hex128 },
              { id: 'tok-hex256', label: '256-BIT HEX KEY (AES-256 / HMAC)', val: tokens.hex256 },
              { id: 'tok-b64-256', label: '256-BIT BASE64URL SECRET (JWT HS256)', val: tokens.base64url256 },
              { id: 'tok-b64-512', label: '512-BIT BASE64URL SECRET (JWT HS512)', val: tokens.base64url512 },
            ].map((item) => (
              <div
                key={item.id}
                tabIndex={0}
                className={`token-card focusable-row ${copiedId === item.id ? 'row-copied' : ''}`}
                onKeyDown={(e) => {
                  if (
                    !e.metaKey &&
                    !e.ctrlKey &&
                    !e.altKey &&
                    (e.key === 'c' || e.key === 'C' || e.key === 'Enter')
                  ) {
                    e.preventDefault();
                    e.stopPropagation();
                    void copyText(item.val, item.id);
                  }
                }}
              >
                <div className="token-card-header">
                  <span className="token-label">{item.label}</span>
                  <button
                    type="button"
                    tabIndex={-1}
                    className={`navy-btn btn-sm ${copiedId === item.id ? 'btn-copied' : ''}`}
                    onClick={() => copyText(item.val, item.id)}
                  >
                    {copiedId === item.id ? '✓ COPIED' : 'COPY [C]'}
                  </button>
                </div>
                <code className="secret-code token-code-block">{item.val}</code>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="c64-box dim-note">
        🔒 <strong className="text-gold">100% LOCAL GENERATION:</strong> All passwords, passphrases, and API tokens are
        generated strictly inside your browser via Web Crypto CSPRNG — never on the server and never transmitted over
        the network.
      </div>
    </div>
  );
};
