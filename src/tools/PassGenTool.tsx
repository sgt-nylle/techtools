import React, { useState, useCallback, useMemo } from 'react';
import { sound } from '../utils/audio';

type GenMode = 'password' | 'passphrase' | 'tokens';

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?';
const AMBIGUOUS = new Set(['0', 'O', 'o', '1', 'l', 'I', '|']);
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

const WORDLIST = [
  'anchor', 'arctic', 'armor', 'atlas', 'baltic', 'beacon', 'bearing', 'binary',
  'bismuth', 'blade', 'bofors', 'bridge', 'buffer', 'bunker', 'cable', 'caliber',
  'cannon', 'captain', 'carbon', 'carrier', 'cipher', 'circuit', 'citadel', 'cluster',
  'cobalt', 'compass', 'conduit', 'console', 'convoy', 'copper', 'corsair', 'cortex',
  'cruiser', 'crypto', 'current', 'cursor', 'cyclone', 'daemon', 'dagger', 'delta',
  'depth', 'diesel', 'dipole', 'docker', 'dolphin', 'domain', 'doppler', 'dragon',
  'dynamo', 'echo', 'eclipse', 'egress', 'emerald', 'engine', 'enigma', 'entropy',
  'eskort', 'falcon', 'fathom', 'fiber', 'filter', 'fjord', 'fleet', 'fortress',
  'frigate', 'fusion', 'galaxy', 'galley', 'gamma', 'gateway', 'glacier', 'gotland',
  'granite', 'gripen', 'gyro', 'harbor', 'header', 'helium', 'helmsman', 'horizon',
  'hull', 'hunter', 'hydra', 'iceberg', 'ignite', 'impulse', 'ingress', 'ion',
  'iron', 'island', 'jacket', 'javelin', 'jetstream', 'joule', 'juniper', 'keel',
  'kernel', 'kestrel', 'keypair', 'kilowatt', 'kraken', 'lambda', 'lancer', 'laser',
  'latch', 'latitude', 'ledger', 'legend', 'lidar', 'lighthouse', 'link', 'lithium',
  'lock', 'logic', 'lookup', 'magnet', 'mariner', 'mast', 'matrix', 'mercury',
  'meteor', 'metric', 'micron', 'mirage', 'missile', 'modem', 'module', 'monolith',
  'mortar', 'mutex', 'nautilus', 'naval', 'nebula', 'neptune', 'network', 'neutron',
  'nexus', 'nickel', 'nimbus', 'nitrogen', 'node', 'nordic', 'nova', 'obsidian',
  'ocean', 'octane', 'omega', 'onyx', 'optic', 'orbit', 'osprey', 'oxide',
  'packet', 'paladin', 'paradox', 'patrol', 'payload', 'pegasus', 'pelican', 'periscope',
  'phantom', 'phoenix', 'photon', 'pilot', 'pinnacle', 'piston', 'plasma', 'platoon',
  'polaris', 'portal', 'poseidon', 'prism', 'probe', 'propeller', 'protocol', 'proton',
  'proxy', 'pulsar', 'python', 'quantum', 'quartz', 'quasar', 'quorum', 'radar',
  'radome', 'radius', 'raptor', 'reactor', 'relay', 'replica', 'resolve', 'ridge',
  'rocket', 'router', 'rudder', 'runway', 'sapphire', 'scanner', 'scepter', 'schema',
  'scout', 'sector', 'seismic', 'sensor', 'sentinel', 'serial', 'server', 'shadow',
  'shield', 'signal', 'silicon', 'silver', 'siren', 'socket', 'sodium', 'solaris',
  'sonar', 'spark', 'spectra', 'sphinx', 'spica', 'spire', 'squadron', 'starlight',
  'stealth', 'steel', 'stellar', 'stern', 'stratum', 'stream', 'strider', 'subnet',
  'summit', 'switch', 'synapse', 'syntax', 'system', 'tactical', 'tangent', 'target',
  'tempest', 'tensor', 'terminal', 'thermal', 'thorium', 'thruster', 'thunder', 'timber',
  'titan', 'token', 'torpedo', 'torrent', 'tower', 'tracer', 'transit', 'trident',
  'trigger', 'tritium', 'tunnel', 'turbine', 'turret', 'typhoon', 'ultra', 'uplink',
  'uranium', 'valkyrie', 'vanguard', 'vector', 'velvet', 'vertex', 'vessel', 'viking',
  'viper', 'visby', 'voltage', 'vortex', 'voyager', 'warden', 'wave', 'zephyr',
];

/** Unbiased CSPRNG integer in [0, maxExclusive) using rejection sampling */
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
  const [mode, setMode] = useState<GenMode>('password');

  // Password state
  const [length, setLength] = useState<number>(20);
  const [useUpper, setUseUpper] = useState<boolean>(true);
  const [useLower, setUseLower] = useState<boolean>(true);
  const [useDigits, setUseDigits] = useState<boolean>(true);
  const [useSymbols, setUseSymbols] = useState<boolean>(true);
  const [excludeAmbiguous, setExcludeAmbiguous] = useState<boolean>(true);
  const [batchCount, setBatchCount] = useState<number>(5);
  const [pwNonce, setPwNonce] = useState<number>(0);

  // Passphrase state
  const [wordCount, setWordCount] = useState<number>(4);
  const [separator, setSeparator] = useState<string>('-');
  const [capitalizeWords, setCapitalizeWords] = useState<boolean>(false);
  const [appendDigits, setAppendDigits] = useState<boolean>(true);
  const [ppNonce, setPpNonce] = useState<number>(0);

  // Token state
  const [apiPrefix, setApiPrefix] = useState<string>('sw_live_');
  const [tokNonce, setTokNonce] = useState<number>(0);

  // Copy feedback
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
    // Reference pwNonce to trigger fresh CSPRNG draw on demand
    void pwNonce;
    const filterChars = (str: string) =>
      excludeAmbiguous ? [...str].filter((c) => !AMBIGUOUS.has(c)).join('') : str;

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
  }, [length, useUpper, useLower, useDigits, useSymbols, excludeAmbiguous, batchCount, pwNonce]);

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

  const applyPreset = (preset: 'pin' | 'readable' | 'standard' | 'fortress') => {
    sound.playBlip();
    setMode('password');
    if (preset === 'pin') {
      setLength(8);
      setUseUpper(false);
      setUseLower(false);
      setUseDigits(true);
      setUseSymbols(false);
      setExcludeAmbiguous(false);
    } else if (preset === 'readable') {
      setLength(14);
      setUseUpper(true);
      setUseLower(true);
      setUseDigits(true);
      setUseSymbols(false);
      setExcludeAmbiguous(true);
    } else if (preset === 'standard') {
      setLength(20);
      setUseUpper(true);
      setUseLower(true);
      setUseDigits(true);
      setUseSymbols(true);
      setExcludeAmbiguous(true);
    } else {
      setLength(32);
      setUseUpper(true);
      setUseLower(true);
      setUseDigits(true);
      setUseSymbols(true);
      setExcludeAmbiguous(false);
    }
    setPwNonce((n) => n + 1);
  };

  const entropyBits =
    mode === 'password'
      ? poolSize > 1
        ? Math.round(length * Math.log2(poolSize))
        : 0
      : mode === 'passphrase'
      ? Math.round(wordCount * Math.log2(WORDLIST.length) + (appendDigits ? Math.log2(90) : 0))
      : 256;

  const strengthLabel =
    entropyBits >= 110
      ? { text: 'NAVAL CRYPTO GRADE', cls: 'status-ok' }
      : entropyBits >= 75
      ? { text: 'STRONG', cls: 'status-ok' }
      : entropyBits >= 50
      ? { text: 'MODERATE', cls: 'status-warn' }
      : { text: 'LOW ENTROPY', cls: 'status-err' };

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
          🔑 PASSWORDS
        </button>
        <button
          type="button"
          className={`navy-tab-btn ${mode === 'passphrase' ? 'active' : ''}`}
          onClick={() => {
            sound.playClick();
            setMode('passphrase');
          }}
        >
          📜 PASSPHRASES
        </button>
        <button
          type="button"
          className={`navy-tab-btn ${mode === 'tokens' ? 'active' : ''}`}
          onClick={() => {
            sound.playClick();
            setMode('tokens');
          }}
        >
          🪙 API TOKENS & KEYS
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
                <button type="button" className="navy-btn btn-sm" onClick={() => applyPreset('pin')}>
                  PIN (8 NUM)
                </button>
                <button type="button" className="navy-btn btn-sm" onClick={() => applyPreset('readable')}>
                  EASY-READ (14)
                </button>
                <button type="button" className="navy-btn btn-sm" onClick={() => applyPreset('standard')}>
                  STANDARD IT (20)
                </button>
                <button type="button" className="navy-btn btn-sm btn-gold" onClick={() => applyPreset('fortress')}>
                  ★ FORTRESS (32)
                </button>
              </div>
            </div>

            <div className="slider-grid">
              <div className="slider-block">
                <label htmlFor="pw-len">
                  LENGTH: <strong className="text-gold">{length} CHARS</strong>
                </label>
                <div className="range-row">
                  <button
                    type="button"
                    className="navy-btn btn-sm"
                    onClick={() => {
                      sound.playClick();
                      setLength((l) => Math.max(6, l - 2));
                    }}
                  >
                    -
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
                    onClick={() => {
                      sound.playClick();
                      setLength((l) => Math.min(64, l + 2));
                    }}
                  >
                    +
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
                <span>UPPERCASE (A–Z)</span>
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
                <span>LOWERCASE (a–z)</span>
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
                <span>DIGITS (0–9)</span>
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
                <span>SYMBOLS (!@#$%...)</span>
              </label>
              <label className="retro-check">
                <input
                  type="checkbox"
                  checked={excludeAmbiguous}
                  onChange={(e) => {
                    sound.playClick();
                    setExcludeAmbiguous(e.target.checked);
                  }}
                />
                <span>NO AMBIGUOUS (0OIl1|)</span>
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
                ⟳ REGENERATE PASSWORDS
              </button>
              {passwords.length > 1 && (
                <button
                  type="button"
                  className="navy-btn"
                  onClick={() => copyText(passwords.join('\n'), 'pw-all')}
                >
                  {copiedId === 'pw-all' ? '✓ COPIED ALL' : '📋 COPY ALL'}
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
                  <div key={id} className="secret-row">
                    <span className="secret-idx">#{idx + 1}</span>
                    <code className="secret-code">{pw}</code>
                    <button
                      type="button"
                      className={`navy-btn btn-sm ${copiedId === id ? 'btn-copied' : ''}`}
                      onClick={() => copyText(pw, id)}
                    >
                      {copiedId === id ? '✓ COPIED' : 'COPY'}
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
                  WORDS: <strong className="text-gold">{wordCount} WORDS</strong>
                </label>
                <input
                  id="word-cnt"
                  type="range"
                  min={3}
                  max={8}
                  value={wordCount}
                  onChange={(e) => setWordCount(Number(e.target.value))}
                />
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
                <span>CAPITALIZE WORDS</span>
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
                <span>APPEND 2-DIGIT NUMBER</span>
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
                ⟳ REGENERATE PASSPHRASES
              </button>
            </div>
          </div>

          <div className="output-list c64-box">
            {passphrases.map((phrase, idx) => {
              const id = `pp-${idx}`;
              return (
                <div key={id} className="secret-row">
                  <span className="secret-idx">#{idx + 1}</span>
                  <code className="secret-code">{phrase}</code>
                  <button
                    type="button"
                    className={`navy-btn btn-sm ${copiedId === id ? 'btn-copied' : ''}`}
                    onClick={() => copyText(phrase, id)}
                  >
                    {copiedId === id ? '✓ COPIED' : 'COPY'}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ==================== 3. TOKENS & API KEYS MODE ==================== */}
      {mode === 'tokens' && (
        <>
          <div className="controls-card c64-box">
            <div className="inline-input-row">
              <label htmlFor="api-prefix">API KEY PREFIX:</label>
              <input
                id="api-prefix"
                type="text"
                maxLength={20}
                value={apiPrefix}
                onChange={(e) => setApiPrefix(e.target.value)}
                className="navy-input input-compact"
                placeholder="sw_live_"
              />
              <button
                type="button"
                className="navy-btn btn-primary"
                onClick={() => {
                  sound.playBlip();
                  setTokNonce((n) => n + 1);
                }}
              >
                ⟳ ROLL ALL TOKENS
              </button>
            </div>
          </div>

          <div className="output-list c64-box">
            {[
              { id: 'tok-uuid', label: 'UUID v4 (RFC 4122)', val: tokens.uuid },
              { id: 'tok-api', label: 'PREFIXED API / BEARER TOKEN (BASE62)', val: tokens.apiKey },
              { id: 'tok-b64-256', label: 'BASE64URL SECRET (256-BIT / JWT / OAUTH)', val: tokens.base64url256 },
              { id: 'tok-hex-256', label: 'HEX KEY (256-BIT / 64 HEX CHARS)', val: tokens.hex256 },
              { id: 'tok-hex-128', label: 'HEX TOKEN (128-BIT / 32 HEX CHARS)', val: tokens.hex128 },
              { id: 'tok-b64-512', label: 'BASE64URL SECRET (512-BIT / HMAC-SHA512)', val: tokens.base64url512 },
            ].map((item) => (
              <div key={item.id} className="token-card">
                <div className="token-card-header">
                  <span className="token-label">{item.label}</span>
                  <button
                    type="button"
                    className={`navy-btn btn-sm ${copiedId === item.id ? 'btn-copied' : ''}`}
                    onClick={() => copyText(item.val, item.id)}
                  >
                    {copiedId === item.id ? '✓ COPIED' : 'COPY'}
                  </button>
                </div>
                <code className="secret-code token-code-block">{item.val}</code>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default PassGenTool;
