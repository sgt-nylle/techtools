# TechTools // HMS Västervik (R136) ⚓

> **🚀 LIVE APPLICATION:** **[https://techtools.subwrite.se](https://techtools.subwrite.se)**  
> **IT Network TechTools for Navy Sailors!**

> [!TIP]
> **🧩 NEW — Browser Extension for Chrome, Edge & Brave:** take TechTools with you as a toolbar popup or a **docked side panel** next to your Azure / vCenter / AWS / GitHub dashboards. Fuzzy-search launcher, a pinnable **default tool**, 5 themes, offline tools, and right-click **“Inspect with TechTools”** on selected text. One-line installers for Linux, macOS & Windows → **[jump to Browser Extension install & docs ↓](#browser-extension-chrome--edge--brave--firefox)**

[![Launch TechTools](https://img.shields.io/badge/LAUNCH_APP-techtools.subwrite.se-2563eb?style=for-the-badge&logo=googlechrome&logoColor=white)](https://techtools.subwrite.se)
[![Browser Extension](https://img.shields.io/badge/NEW-Browser_Extension-16a34a?style=for-the-badge&logo=googlechrome&logoColor=white)](#browser-extension-chrome--edge--brave--firefox)
[![Companion: subwrite.se](https://img.shields.io/badge/COMPANION-subwrite.se-facc15?style=for-the-badge)](https://subwrite.se)

A modular clean, optimized Swedish Navy (*Kungliga Flottan*) IT troubleshooting web suite designed as a companion subsite to [subwrite.se](https://subwrite.se), featuring a custom pixel-art SVG sprite of the iconic *Norrköping*-class (*Spica II*) fast-attack missile boat **Robotbåt R136 HMS Västervik**. Launch and use the full suite directly in your browser at **[https://techtools.subwrite.se](https://techtools.subwrite.se)**.

> [!IMPORTANT]
> **100% Local Password, Token & Enterprise Auth Processing (Never on the Server):** All passwords, passphrases, UUIDs, cryptographic keys, and API tokens in `MOD-01`, as well as all IPv4/IPv6 CIDR calculations in `MOD-07` and all **JWT, OIDC, and SAML 2.0 authentication tokens** in `MOD-08`, are generated or decoded **strictly inside your own browser**. No generated secret or pasted enterprise bearer token / SAML assertion is ever transmitted to, logged by, or processed on the server.

---

## Diagnostic Modules (`v0.5.3`)

1. **`MOD-01` — Password & Token Generator (`#/password-generator`)**
   - **Generated 100% Locally in Your Browser (Not on the Server):** Uses client-side CSPRNG (`window.crypto.getRandomValues`) with unbiased rejection sampling — zero network traffic, zero server involvement, and zero logging.
   - **`64BIT (16)` & `NO CONFUSE` Enabled by Default (Cookie-Persisted):** Opens with **`64BIT (16)`** (`16` chars, `A–Z`, `a–z`, `0–9`) and **`NO CONFUSE`** enabled by default — excluding look-alike characters (`0`, `O`, `o`, `1`, `l`, `I`, `|`) that can be misread across proportional/sans-serif fonts — while saving any user preset or toggle changes in a local preference cookie (`tt_passgen_prefs`).
   - **Complexity Presets & Strength Tiers:** Presets (`PIN (8)`, `64BIT (16)`, `STANDARD IT (20)`, `FORTRESS (32)`), custom length (`6–64`), character class toggles, batch generation (`1×`, `5×`, `10×`), and live entropy telemetry (`ULTRA NAVY CRYPTO` for `>= 32` char passwords, `NAVY CRYPTO GRADE` for `> 5` word passphrases).
   - **Multi-Branch Passphrases & Developer Tokens:** Memorable cross-domain word passphrases (`3–8` words blending Navy, Nature, Food, Drinks, Cars, Fitness, and Tech vocabulary) plus developer/auth tokens (`UUID v4`, `Hex 128/256-bit`, `Base64URL 256/512-bit`, and custom-prefixed `Base62` API keys).
2. **`MOD-02` — DNS & Domain Registry Intel (`#/dns-inspector`)**
   - Selectable DNS resolvers: **Google `8.8.8.8` (default)**, **Cloudflare `1.1.1.1`**, or **Custom** public DNS server IP / authoritative nameserver hostname.
   - Parallel lookups for `A`, `AAAA`, `CNAME`, `PTR`, `MX` (including mail exchanger IPv4 resolution), `NS`, `SOA`, `TXT`, and `CAA`.
   - **DNSSEC Zone Key (`DNSKEY`) & Delegation Signer (`DS`) Analysis:** Queries `DNSKEY` and `DS` records via DoH (`application/dns-json`), computes RFC 4034 Key Tags, identifies `KSK` (Flag 257) and `ZSK` (Flag 256) roles, maps cryptographic algorithms & digest types to plain text, and verifies Chain-of-Trust linkage between parent `DS` records and zone `KSK` keys.
   - Automated **SPF** (`v=spf1`) and **DMARC** (`_dmarc`) email security posture auditing.
   - Live port-43 **WHOIS Domain Registration** lookup (supporting `.se`/`.nu` via `whois.iis.se`, Verisign, PIR, EURid, and automatic IANA TLD referral discovery).
3. **`MOD-03` — What's My IP? & Range Owner (`#/whats-my-ip`)**
   - Displays caller's public IPv4/IPv6 address, reverse `PTR` hostname, routed BGP CIDR prefix, Autonomous System (`ASN` + ISP holder), and RIR allocation block owner/netname/country/abuse contact.
   - Includes an external IP/hostname lookup bar to inspect any third-party IP block.
4. **`MOD-04` — Certificate & CSR Analyzer (`#/cert-analyzer`)**
   - Base64 / PEM certificate analyzer detecting X.509 certs, Certificate Signing Requests (CSR), and public keys.
   - Extracts Subject, Issuer, Serial, SHA-256 fingerprint, validity dates, days remaining, SAN names, Key Usage, and Extended Key Usage (Server/Client auth).
   - Verifies against system Trust Store and discovers full certificate chains via Authority Information Access (AIA) with full-chain export in Base64 PEM.
   - **Private Key Security Intercept Guard:** Rejects private keys with `"Security alert! We will not process private keys! Abandon Ship!"`.
   - Rejects non-cert payloads with `"Navy Cert Format Not DETECTED!"` and clears the input.
5. **`MOD-05` — Email Message Header Analyzer (`#/mail-header-analyzer`)**
   - Analyzes raw RFC 5322 email headers and reconstructs full chronological transport traces with per-hop latency calculations, IP addresses, protocols, and TLS ciphers.
   - Audits SPF, DKIM (including selector, domain, and signature parameters), DMARC policy alignment, and ARC headers.
   - Rejects non-header payloads with `"Navy Mail Header Format Not DETECTED!"` and clears the input.
6. **`MOD-06` — External Endpoint & TLS Probe — URL Tester (`#/url-tester`)**
   - Tests how public corporate URLs, reverse proxies, and custom TCP ports (default `443`, `1–65535`) respond from the **external public internet** (bypassing internal corporate split-horizon DNS and outbound port blocks).
   - **Active Sonar ICMP Ping (`PING OK`):** Fires a concurrent 3-pulse ICMP Echo probe (`min / avg / max ms`, packet loss %, and `TTL`) alongside TCP/TLS/HTTP probing.
   - **Multi-Layer Telemetry:** Measures public DNS resolution (`8.8.8.8` / `1.1.1.1`), TCP 3-way handshake (`OPEN` vs `ECONNREFUSED` vs `ETIMEDOUT` firewall drop), TLS handshake, HTTP TTFB, status codes, HTML `<title>` / JSON preview, security headers (`HSTS`, `CSP`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`), non-HTTP service banners (e.g. SSH/SMTP), and up to 5 HTTP `3xx` redirect hops.
   - **Live SSL / TLS Certificate Inspection:** Inspects negotiated TLS protocol & cipher suite, CA trust store verification, SAN/CN hostname match, validity countdown, SHA-256 fingerprint, wire chain depth, and Base64 PEM / Full-Chain export.
7. **`MOD-07` — Subnet & Supernetting Calculator — IPv4 / IPv6 (`#/subnet-calculator`)**
   - **100% Client-Side TypeScript BigInt Engine:** Instantaneous zero-network calculation for any IPv4 (`/0–/32`) or IPv6 (`/0–/128`) CIDR block (e.g. `10.120.4.0/22` or `2001:db8::/48`).
   - Computes Netmask, Wildcard mask, canonical Network address, Broadcast / last address, Usable host range, Total usable hosts, RFC scope classification, parent Supernet (`-1` bit), and full bitwise binary representation.
   - **Reverse DNS PTR Generator:** Automatically builds `in-addr.arpa` (including RFC 2317 classless delegation) for IPv4 and full 32-nibble `ip6.arpa` zones/records for IPv6.
   - **Interactive Subnet Divider & Carving Visualizer:** Quick slider & preset buttons to subdivide any network block into smaller subnets (e.g. splitting a `/22` into four `/24` blocks) with one-click drill-down.
8. **`MOD-08` — JWT, OIDC & SAML Auth Inspector (`#/auth-inspector`)**
   - **100% Client-Side Decoder:** Zero external API calls or server transmission to safeguard sensitive enterprise bearer tokens and SAML assertions.
   - Decodes JOSE Header, Claims Payload, and cryptographic Signature length/hex preview for JWT & OIDC tokens.
   - **Human-Readable Timestamps:** Converts `iat`, `nbf`, `exp`, and `auth_time` to local & UTC time with live status badges (`ACTIVE (expires in 48m)` or `EXPIRED`).
   - **Microsoft Entra ID / OIDC Claim Highlighter:** Formats and highlights `upn`, `oid`, `tid`, `roles`, `groups`, `scp`, `amr`, and translates well-known Entra Directory Role Template GUIDs (`wids`).
   - **SAML 2.0 Response XML Viewer:** Decodes Base64 / URL-encoded `SAMLResponse` payloads, extracts Issuer, Subject `NameID`, Conditions window, AttributeStatement claims, and pretty-prints the XML document.
9. **`MOD-09` — HTTP Security Headers & CSP Evaluator (`#/security-headers`)**
   - Evaluates target URL HTTP response headers via the backend fetch/probe pipeline and computes a `0–100` compliance score (`GRADE A+` to `F`).
   - Audits and scores **HSTS** (`Strict-Transport-Security`), **CSP** (`Content-Security-Policy` with explicit warnings for `'unsafe-inline'`, `'unsafe-eval'`, and wildcard `*` origins), **`X-Frame-Options`** / `frame-ancestors`, **`X-Content-Type-Options: nosniff`**, **`Referrer-Policy`**, and **`Permissions-Policy`**.
   - Displays results as a retro terminal compliance checklist with `PASS` / `WARN` / `FAIL` badges, remediation guidance, and a parsed CSP Directive Matrix.

---

## Desktop Split-Screen / Dual-Pane Mode (`Ctrl+Shift+D`)

On desktop viewports (`>= 1024px`), TechTools supports running **two diagnostic modules side-by-side**:

- **Launch / Toggle:** Press `Ctrl+Shift+D` or click **`◫ SPLIT VIEW [Ctrl+Shift+D]`** in the top command bar (or **`◫ + SPLIT PANE`** inside any active tool banner).
- **Independent Instances & State:** **Pane A** (left) and **Pane B** (right) run independent React module instances with separate inputs, results, and per-pane module selector dropdowns.
- **Arrow-Key Window Switching (`←` / `→`):** Press **`←` (`ArrowLeft`)** to focus **Pane A** or **`→` (`ArrowRight`)** (or `↑`/`↓`) to focus **Pane B**. Once a pane is active (`● ACTIVE WINDOW`), pressing **`1`–`9`** or any single-letter tool shortcut (`R`, `Q`, `C`, etc.) immediately operates on that active window.
- **Resizable `50/50` Terminal Divider:** Drag the center `║` divider between `32%` and `68%` (double-click to reset to `50/50`), or click the **`[X]`** button on either pane to close it and return to single-module view.

---

## Module Input Requirements & Technical Reference (`MOD-07`, `MOD-08`, `MOD-09`)

### `MOD-07` — Subnet & Supernetting Calculator (IPv4 / IPv6)
- **Execution Model:** 100% client-side TypeScript `BigInt` bitwise arithmetic (`0` network calls).
- **Input Requirements:**
  - **IPv4 CIDR:** Dotted-quad IPv4 address with optional `/0`–`/32` prefix (defaults to `/24` if omitted), e.g. `10.120.4.0/22`, `192.168.1.50/26`, `100.64.0.0/10`. Supports RFC 3021 `/31` point-to-point links and `/32` host routes.
  - **IPv6 CIDR:** Compressed (`::`), expanded, or IPv4-mapped IPv6 address with optional `/0`–`/128` prefix (defaults to `/64` if omitted), e.g. `2001:db8::/48`, `2001:db8:85a3::8a2e:370:7334/64`.
- **Generated Telemetry:** Canonical CIDR, Netmask, Wildcard mask (for router ACLs/OSPF), Network & Broadcast/Last addresses, Usable host range & count, parent Supernet (`-1` bit), bitwise binary table (`[B]`), reverse DNS `in-addr.arpa` / nibble `ip6.arpa` PTR records, and interactive child subnet carving (`1` to `6` extra prefix bits, up to `64` child blocks).

### `MOD-08` — JWT, OIDC & SAML Auth Inspector
- **Execution Model & Privacy Requirement:** **100% client-side browser decoding** (`atob` + `TextDecoder` + `DOMParser`). Enterprise access tokens, ID tokens, and SAML assertions often carry live session privileges or PII and **must never be sent to external decoding APIs**. `MOD-08` processes tokens strictly in local browser memory with zero network traffic.
- **JWT & OIDC Input Requirements (`[J]` Mode):**
  - Accepts standard RFC 7519 **JWS Compact Serialization** tokens consisting of 3 dot-separated Base64URL segments (`header.payload.signature`) or 2-segment unsigned tokens (`header.payload`), with or without a leading `Bearer ` prefix.
  - **Note on JWE (Encrypted Tokens):** Opaque or JWE-encrypted tokens (5 dot-separated segments) cannot be plaintext-decoded without the recipient private decryption key.
  - **Timestamp Claims (`iat`, `nbf`, `exp`, `auth_time`):** Must be numeric Unix epoch seconds. Automatically converted to local and UTC time with live countdown/expiry badges (`ACTIVE (expires in 48m)` or `EXPIRED`).
  - **Highlighted Microsoft Entra ID & OIDC Claims:** Automatically extracts and formats `upn` (User Principal Name), `preferred_username`, `name`, `email`, `oid` (Object ID), `tid` (Tenant GUID), `roles`, `groups`, `scp` (OAuth2 scopes), `azp` / `appid`, `amr` (Authentication Methods Reference), `iss`, `sub`, `aud`, `ver`, and translates well-known Entra Directory Role Template GUIDs in `wids` (e.g. Global Administrator, Security Administrator).
- **SAML 2.0 Input Requirements (`[M]` Mode):**
  - Accepts **Base64-encoded** `SAMLResponse` payloads, **URL-encoded** `SAMLResponse=...` HTTP POST body parameters, or **raw SAML 2.0 XML** (`<samlp:Response>` or `<saml:Assertion>`).
  - Extracts `Issuer`, `Destination`, `InResponseTo`, `StatusCode`, Subject `NameID`, `Conditions` (`NotBefore` / `NotOnOrAfter` with live validity status), `AudienceRestriction`, all `<saml:AttributeStatement>` claims, and pretty-prints the XML document.

### `MOD-09` — HTTP Security Headers & CSP Evaluator
- **Execution Model:** Queries the target URL via the hardened backend `/api/probe` pipeline (enforcing `isPublicRoutableIp` SSRF protection on both the initial target and up to 5 HTTP `3xx` redirects).
- **Input Requirements:** Any publicly routable corporate URL or hostname (defaults to HTTPS port `443`). Private RFC 1918, loopback, and link-local addresses are blocked by the SSRF guard.
- **Scoring & Compliance Matrix (`0–100` Points, `GRADE A+` to `F`):**
  - **`Strict-Transport-Security` (HSTS — 20 pts):** Requires `max-age >= 31536000` (1 year) for full pass; warns on shorter `max-age`; checks `includeSubDomains` and `preload`.
  - **`Content-Security-Policy` (CSP — 30 pts):** Parses all CSP directives and flags `'unsafe-inline'`, `'unsafe-eval'`, wildcard (`*`, `http:`, `https:`) origins, or Report-Only policies.
  - **`X-Frame-Options` / `frame-ancestors` (15 pts):** Verifies `DENY`, `SAMEORIGIN`, or CSP `frame-ancestors`.
  - **`X-Content-Type-Options` (15 pts):** Verifies exact `nosniff` enforcement.
  - **`Referrer-Policy` (10 pts):** Verifies privacy-preserving policies (`no-referrer`, `same-origin`, `strict-origin`, `strict-origin-when-cross-origin`).
  - **`Permissions-Policy` (10 pts):** Verifies explicit browser hardware/sensor feature lockdown (e.g. `camera=(), microphone=(), geolocation=()`).

---

## Keyboard Shortcuts

| Context | Key | Action |
| :--- | :--- | :--- |
| **Command Deck** | `1` – `9` / `↑` `↓` `←` `→` / `Tab` | SELECT a module only (card is focused and scrolled into view) |
| | `Enter` | Launch the selected module |
| **Global (inside a tool)** | `1` – `9` | Jump directly to module `MOD-01` .. `MOD-09` in the active pane (when outside text inputs) |
| | `Ctrl+Shift+D` | Toggle **Desktop Dual-Pane Split-Screen Mode** (`50/50` resizable side-by-side modules) |
| | `←` / `→` (in Split View) | Switch active window between **Pane A** (`←`) and **Pane B** (`→`) so `1`–`9` & tool shortcuts control that window |
| | `ESC` | Blur focused text input (unlocking shortcuts), or return to the R136 Command Deck |
| | `S` | Toggle synthesized clean Naval CIC sound effects ON / OFF |
| | `Tab` / `Shift+Tab` | Step through buttons, secret rows, and diagnostic intel sections |
| | `C` | Copy the currently focused intel section / secret row |
| **MOD-01 (PassGen)** | `P` / `W` / `T` | Switch between Passwords, Passphrases, and API Tokens |
| | `N` / `B` (or `E`) / `D` / `F` | Apply preset: `PIN (8)`, `64BIT (16)`, `STANDARD IT (20)`, `FORTRESS (32)` |
| | `-` / `+` | Decrease / increase password length or passphrase word count |
| | `U` / `L` / `G` / `Y` / `X` | Toggle Upper, Lower, Digits, Symbols, or **`NO CONFUSE`** (`0/O, 1/l/I`) |
| | `R` / `C` / `A` | Regenerate (`R`), Copy `#1` or focused row (`C`), Copy All (`A`) |
| **MOD-02 (DNS & WHOIS)** | `Q` (or `/`) / `R` | Focus domain input (`Q`), Run/re-scan DNS & WHOIS (`R`) |
| | `G` / `F` / `U` | Select DNS resolver: Google `8.8.8.8` (`G`, default), Cloudflare `1.1.1.1` (`F`), Custom DNS (`U`) |
| | `A` / `I` / `M` / `N` / `W` | Filter view: All, IP/PTR, MX/SPF/DMARC, NS/SOA/TXT, WHOIS |
| | `V` | Toggle Raw WHOIS record |
| **MOD-03 (What's My IP)** | `C` / `M` / `R` / `Q` / `V` | Copy IP (`C`), My IP (`M`), Re-scan (`R`), Focus target input (`Q`), Raw RIR (`V`) |
| **MOD-04 (Cert Analyzer)** | `Q` (or `/`) / `R` | Focus cert textarea (`Q`), Analyze certificate/CSR/key (`R`) |
| | `X` | Export and copy full discovered certificate chain in Base64 PEM |
| | `V` | Toggle OpenSSL ASN.1 decoded text view |
| **MOD-05 (Mail Headers)** | `Q` (or `/`) / `R` | Focus header textarea (`Q`), Run header trace analysis (`R`) |
| | `A` / `H` / `U` | View filter: All Intel (`A`), Message Hops Trace (`H`), SPF/DKIM/DMARC Audit (`U`) |
| | `V` | Toggle raw email headers table |
| **MOD-06 (URL Tester)** | `Q` (or `/`) / `P` / `R` | Focus URL input (`Q`), Focus Port input (`P`), Run external probe (`R`) |
| | `M` / `F` / `L` | Toggle HTTP `GET`/`HEAD` (`M`), Follow `3xx` redirects (`F`), Cycle SSL mode (`L`) |
| | `A` / `H` / `T` / `D` | View filter: All Intel (`A`), Connectivity & HTTP (`H`), SSL/TLS Cert (`T`), Headers (`D`) |
| | `X` | Export and copy full live PEM certificate chain |
| **MOD-07 (Subnet Calc)** | `Q` (or `/`) | Focus IPv4/IPv6 CIDR input |
| | `-` / `+` | Supernet (`-1` prefix bit) / Subnet (`+1` prefix bit) |
| | `B` | Toggle bitwise binary breakdown table |
| **MOD-08 (Auth Inspector)** | `Q` (or `/`) | Focus JWT / SAML token input |
| | `J` / `M` | Switch between JWT & OIDC Inspector (`J`) and SAML 2.0 XML Viewer (`M`) |
| **MOD-09 (Sec Headers)** | `Q` (or `/`) / `R` / `F` | Focus URL input (`Q`), Evaluate headers (`R`), Toggle Follow `3xx` (`F`) |
| | `A` / `W` / `P` / `V` | Filter: All Checks (`A`), Warnings & Failures (`W`), CSP Matrix (`P`), Raw Headers (`V`) |

---

## Browser Extension (Chrome · Edge · Brave · Firefox)

Use TechTools straight from your browser toolbar or as a **docked side panel** next to Azure / vCenter / AWS / GitHub dashboards. It packages the same tools locally (no iframe): Pass & Tokens, Mail Headers, Subnet Calc and JWT/SAML work **offline**; DNS, IP, Cert, URL Tester and Sec Headers call the TechTools API.

**Features:** fuzzy-search launcher (`1–9` / `↑↓` / `Enter`), pin a **default tool** to open on launch, 5 themes synced between popup and panel, and right-click **Inspect with TechTools** on selected text (auto-detects JWT, SAML, PEM certs, mail headers, CIDR, IP, URL, domain).

| Shortcut | Action |
|---|---|
| `Alt+Shift+K` | Open popup |
| `Alt+Shift+S` | Open side panel |
| `Alt+T` / `Alt+P` | Cycle theme / pin current tool as default (inside the extension) |

> **Shortcut tip:** `Alt+Shift+T` is reserved by Chrome/Edge (it focuses the browser toolbar), which is why the popup uses `Alt+Shift+K`. If a key is unassigned or clashes, rebind it at `chrome://extensions/shortcuts` (Edge: `edge://extensions/shortcuts`).

### Easy install (scripts)

> Browsers don't allow fully silent installs of unpacked extensions, so the scripts download + unpack the extension to a stable folder and walk you through the one-time **Load unpacked** click (~10 s). Re-run to update.

**Linux / macOS**
```bash
curl -fsSL https://techtools.subwrite.se/downloads/install-extension.sh | bash -s -- --open
# options: --browser chrome|chromium|brave|edge|firefox   --dir <folder>   --open (opens the extensions page)
```

**Windows (PowerShell)**
```powershell
irm https://techtools.subwrite.se/downloads/install-extension.ps1 | iex
# or download first:  .\install-extension.ps1 -Open -Browser edge
```

Default install folders: `~/.local/share/techtools-extension` (Linux), `~/Library/Application Support/TechTools/extension` (macOS), `%LOCALAPPDATA%\TechTools\extension` (Windows).

### Manual install

1. Download **[techtools-extension-latest.zip](https://techtools.subwrite.se/downloads/techtools-extension-latest.zip)** and unzip it to a folder you will keep (the browser loads it from there).
2. Open the extensions page — **Chrome** `chrome://extensions` · **Edge** `edge://extensions` · **Brave** `brave://extensions`.
3. Enable **Developer mode**, click **Load unpacked**, select the unzipped folder.
4. Pin the TechTools icon from the puzzle-piece menu. Adjust shortcuts at `chrome://extensions/shortcuts`.
5. To update: re-download/unzip over the same folder and press **↻** on the extension card.

**Firefox (temporary add-on, experimental):** Firefox needs a slightly different manifest (`background.scripts`, no side panel), so use the dedicated build: `curl -fsSL https://techtools.subwrite.se/downloads/install-extension.sh | bash -s -- --browser firefox`, or unzip **[techtools-extension-firefox.zip](https://techtools.subwrite.se/downloads/techtools-extension-firefox.zip)** manually. Then open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → pick `manifest.json` (removed on browser restart; the side panel is Chromium-only).

### Build from source

```bash
npm install
npm run build:ext     # -> extension/dist  (load this folder unpacked; `npm run watch:ext` while developing)
npm run build:ext:firefox   # Firefox variant -> extension/dist-firefox
npm run release       # web build + Chromium & Firefox zips + installer scripts in dist/downloads/ (served by the site)
npm run typecheck:ext
```

See [`extension/README.md`](extension/README.md) for architecture, folder structure, permissions and known limitations.

---

## Extending With New Tools

TechTools uses a plugin-style registry so new troubleshooting tools can be added with minimal boilerplate:

1. Create a React component in `src/tools/<YourTool>.tsx` (and, if server-side network probing is needed, add a route in `server/apiHandler.mjs`).
2. Append a `ToolModule` entry to `TOOL_MODULES` in `src/tools/registry.ts`.
3. The Command Deck cards, persistent top module bar, URL `#/<tool-id>` routing, and `[1–9]` keyboard shortcuts automatically register the new module.

---

## Security & Architecture

- **100% Local Client-Side Secret Generation:** All passwords, passphrases, UUIDs, hex keys, and API tokens are generated exclusively inside the user's browser via `window.crypto.getRandomValues` — **never on the server** and never transmitted over the network.
- **Zero External Runtime Dependencies on Backend:** Pure Node.js v20+ (`node:dns`, `node:net`, `node:tls`, `node:https`, `node:http`) with zero third-party API keys required.
- **Built-In Rate Limiting, SSRF Protection & Input Sanitization:** Per-IP sliding-window rate limiter (`60 req/min/IP`), strict `isPublicRoutableIp` SSRF validation (blocking RFC1918, loopback, link-local/cloud metadata, CGNAT, and internal suffixes on initial targets and all HTTP redirect hops), IP-pinned outbound sockets, and port-43 CRLF stripping.

---

## Changelog

- **`v0.5.3`** — Store-ready manifest: description shortened to the 132-char store limit (Edge Add-ons validation), new `scripts/validate-manifest.mjs` runs during packaging, canonical download `techtools-extension-latest.zip`.
- **`v0.5.2`** — Manifest fix: Chromium manifest now uses only `background.service_worker` (removes the *'background.scripts requires manifest version 2 or lower'* warning). Firefox gets its own generated build (`techtools-extension-firefox.zip`, `npm run build:ext:firefox`).
- **`v0.5.1`** — Extension shortcut fix: popup command moved from `Alt+Shift+T` (reserved by Chrome/Edge for toolbar focus) to `Alt+Shift+K`; README highlights the browser extension.
- **`v0.5.0`** — Browser Extension (Chromium MV3, Firefox experimental):
  - New `extension/` bundle (popup 720×580 + side panel) built from the same React tools via `vite.extension.config.ts`; `chrome.storage` default-tool pinning, fuzzy launcher, themes sync, `Alt+Shift+T` / `Alt+Shift+S` commands and an **Inspect with TechTools** context menu with content auto-detection.
  - Packaged download + easy installers: `/downloads/techtools-extension-latest.zip`, `install-extension.sh` (Linux/macOS) and `install-extension.ps1` (Windows). `npm run release` builds everything.
- **`v0.4.0`** — Theme Switcher & 5 Themes:
  - Added a header theme dropdown and `Alt+T` shortcut (disabled while typing in inputs). Choice is persisted via the `tt_theme` cookie with `localStorage` fallback and applied before first paint.
  - Themes: **`bridge`** (default, clean light), **`navy`** (classic dark sonar terminal), **`amber-phosphor`** (black + amber), **`oled-black`** (true black, single cyan accent), **`paper-navy`** (high-contrast cream + navy).
  - HMS Västervik sprite now re-colors per theme and bobs in every theme; larger/bolder module switcher (1–9) text in the flat themes.
- **`v0.3.2`** — MOD-08 Auth Inspector Cleared Defaults:
  - JWT and SAML input fields now start empty (no pre-loaded sample) with a helpful empty-state prompt; sample tokens remain available via the sample buttons.
- **`v0.3.1`** — Split-View Arrow-Key Window Switching (`←` / `→`) & Auth/Security Module Documentation:
  - Added keyboard arrow-key window switching (`←` / `→` and `↑` / `↓`) in Desktop Split-Screen Mode to rapidly move active focus between **Pane A** and **Pane B**, plus dedicated banner `FOCUS [◄]` / `FOCUS [►]` buttons and a center-divider quick-switch toggle so `[1–9]` and tool shortcuts immediately target the chosen window.
  - Added comprehensive repository documentation covering `MOD-07`, `MOD-08` (JWT/OIDC/Entra ID & SAML 2.0 input requirements and client-side privacy architecture), and `MOD-09` (HTTP security header scoring & CSP evaluation criteria).
- **`v0.3.0`** — 9-Module Expansion (`MOD-07`, `MOD-08`, `MOD-09`), Desktop Dual-Pane Split-Screen & 3×3 Navigation Scaling:
  - Added **`MOD-07` Subnet & Supernetting Calculator (IPv4 / IPv6)** (`#/subnet-calculator`) with 100% client-side TypeScript `BigInt` CIDR math, bitwise binary visualizer, `in-addr.arpa` / `ip6.arpa` reverse DNS PTR generator, and interactive subnet carving slider.
  - Added **`MOD-08` JWT, OIDC & SAML Auth Inspector** (`#/auth-inspector`) with 100% client-side decoding, human-readable `iat`/`nbf`/`exp` timestamps with active/expired status badges, Microsoft Entra ID claim highlighting (`upn`, `oid`, `tid`, `roles`, `groups`, `wids`), and a Base64 SAML 2.0 Response XML formatter.
  - Added **`MOD-09` HTTP Security Headers & CSP Evaluator** (`#/security-headers`) with terminal `PASS`/`WARN`/`FAIL` compliance checklist scoring HSTS, CSP (`unsafe-inline`, `unsafe-eval`, and wildcard warnings), `X-Frame-Options`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and `Permissions-Policy`.
  - Added **Desktop Split-Screen / Dual-Pane Mode** (`Ctrl+Shift+D` or top-bar `◫ SPLIT VIEW` toggle) with independent module state per pane, draggable `50/50` terminal divider, per-pane module selector & `[X]` close buttons, and active-pane keyboard shortcut routing.
  - Scaled the Command Deck and persistent module switcher bar cleanly to a responsive 3×3 9-module layout.
- **`v0.2.7`** — Expanded DNSSEC Zone Key (`DNSKEY`) & Delegation Signer (`DS`) Inspector (`MOD-02`):
  - Added DoH (`application/dns-json`) `DNSKEY` and `DS` queries with RFC 4034 Key Tag computation, KSK (Flag 257) / ZSK (Flag 256) identification, plain-text cryptographic algorithm and digest type mapping, expandable/copyable Base64 public keys, and parent `DS` to zone `KSK` Chain-of-Trust verification.
- **`v0.2.6`** — Cloudflare Trusted Proxy & Real Client IP Resolution (`MOD-03` & Rate Limiter):
  - Hardened [`extractClientIp`](server/apiHandler.mjs) to trust reverse-proxy headers only from local/private proxy sockets (`127.0.0.1` / loopback) and prioritize Caddy-verified `X-Real-IP` / `Cf-Connecting-Ip` before `X-Forwarded-For`, alongside Cloudflare CIDR `trusted_proxies` in production Caddy.
- **`v0.2.5`** — Official Domain Contact Footer (`sysop@subwrite.se`):
  - Added official contact address (`contact: sysop@subwrite.se`) to the persistent clean bottom footer bar, the starter Command Deck "About TechTools" footer, and repository documentation.
- **`v0.2.4`** — Password Generator Enhancements, Lighter Marine Blue Theme & Authentic Robotbåt Redesign:
  - **Password & Token Generator (`MOD-01`):**
    - Updated default preset to **`64BIT (16)`** (`16` chars, `A–Z`, `a–z`, `0–9`) and reworked ambiguous filtering into **`NO CONFUSE`** mode (default checked, excluding font-confusable look-alike characters `0, O, o, 1, l, I, |`), honoring user adjustments across visits via cookie (`tt_passgen_prefs`).
    - Expanded passphrase dictionary across **Navy, Nature, Food, Drinks, Cars, Fitness, and Tech** vocabulary.
    - Updated strength status tiers: `>= 32` character passwords (`FORTRESS (32)`+) display **`ULTRA NAVY CRYPTO`**, and `> 5` word passphrases (`6–8` words) display **`NAVY CRYPTO GRADE`**.
    - Highlighted across tool UI and documentation that all passwords, passphrases, and tokens are generated **100% locally in the browser and never on the server**.
  - **Theme, Robotbåt & UX Polish:**
    - Lifted console palette to a brighter **Swedish Marine / Royal Blue** theme with softened CRT scanlines/vignette and responsive single-row 6-module desktop navigation.
    - Redesigned **Robotbåt R136 HMS Västervik** pixel-art SVG faithfully after the *Norrköping*-class (*Spica II*) profile (tandem forward-upward RBS-15 box launchers, open X-braced lattice mast + oval Sea Giraffe radome, tall aft pole mast + 3-tailed Swedish Naval Ensign, stepped bridge + 9LV200 director, Bofors 57 mm cupola gun, and M90 splinter camouflage), added gentle wave bobbing animation, and updated the `1200×630` `og-image.png` social preview.
    - Cleared pre-filled default domain in `MOD-02` (**DNS & WHOIS**) in favor of a standard input prompt placeholder.
- **`v0.2.3`** — External Endpoint & TLS Probe (`MOD-06`) & Active Sonar ICMP Ping:
  - Added `MOD-06` **URL Tester — External Endpoint & TLS Probe** (`#/url-tester`) for testing public corporate URLs and custom TCP ports (default `443`) from outside internal networks and firewalls.
  - Added **Active Sonar ICMP Ping (`PING OK`)** running concurrently with DNS/TCP/TLS/HTTP probes (`min / avg / max ms`, packet loss %, `TTL`, and ICMP-filtered firewall detection).
  - Added live SSL/TLS handshake & certificate inspection (protocol/cipher, CA trust store check, SAN/CN hostname match, expiry countdown, wire chain summary, and PEM chain export), HTTP `3xx` redirect hop tracing, security header posture checks, and non-HTTP TCP banner detection.
  - Restricted the crawler-friendly "About TechTools" footer to the starter Command Deck view only.
- **`v0.2.1`** — Two new tools, deck navigation and SEO:
  - Added `MOD-04` Certificate & CSR Analyzer (X.509 / CSR / public key detection, trust verification, AIA chain discovery and export, private key intercept guard).
  - Added `MOD-05` Email Message Header Analyzer (hop trace with delays, SPF / DKIM / DMARC / ARC audit, tab-selectable copyable tiles).
  - Command Deck: `1`–`5` now only select a module and `Enter` launches it; tabbing to a module scrolls it into view.
  - Added crawler-friendly "About TechTools" footer, Open Graph / Twitter / schema.org metadata and an optimized `og-image.png`.
- **`v0.1.2`** — Keyboard-first workflow & selectable DNS resolvers:
  - Added single-letter keyboard shortcuts across `MOD-01`, `MOD-02`, and `MOD-03`, plus `ESC` input-blur before returning to Command Deck.
  - Added `Tab`-selectable diagnostic sections and secret rows with `[C]` one-key clipboard copy (`CopyableIntelSection`).
  - Added DNS server selector in `MOD-02` (`Google 8.8.8.8` default, `Cloudflare 1.1.1.1`, and `Custom` public DNS IP/hostname with SSRF protection and port-53 reachability/refusal diagnostics).
  - Unified `FORTRESS (32)` preset styling and removed the redundant `DECK` button from the module switcher bar.
- **`v0.1.0`** — Initial release of TechTools (`techtools.subwrite.se`) featuring clean Swedish Navy theme, optimized `R136 HMS Västervik` pixel SVG, Password & Token Generator, DNS & WHOIS Inspector, and What's My IP / RIR Range Owner Intel.

---

## Local Development & Production

```bash
# Install dependencies
npm install

# Run local dev server (Frontend + embedded Node API on http://localhost:5174)
npm run dev

# Lint & Production build
npm run lint
npm run build

# Start standalone production API/static server (default 127.0.0.1:3001)
npm start
```

---

## Community & Contact

Join our Discord server or reach out for questions, feedback, or bug reports regarding [techtools.subwrite.se](https://techtools.subwrite.se):

- **Live Application:** **[https://techtools.subwrite.se](https://techtools.subwrite.se)**
- **Discord:** [https://discord.gg/9uXbaunJb](https://discord.gg/9uXbaunJb)
- **Email:** [sysop@subwrite.se](mailto:sysop@subwrite.se)
- **GitHub:** [sgt-nylle/techtools](https://github.com/sgt-nylle/techtools)

---

## ⚓ Launch TechTools Online

Run all nine IT diagnostic utilities instantly in your browser (no installation or registration required):

🚀 **[Launch techtools.subwrite.se ↗](https://techtools.subwrite.se)**

---

### ⚓ Design & Aesthetic Notes
The visual identity, naming conventions, and UI themes across this project are inspired by vintage Swedish naval and maritime defense computing aesthetics (cold-war CRT telemetry, green/amber phosphors, sonar consoles). 

This is purely a stylistic and retro-computing design choice. The project has no official affiliation with the Swedish Armed Forces (Försvarsmakten) or any military organization.


