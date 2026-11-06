# TechTools // HMS Västervik (R136) ⚓

> **Swedish Navy Commodore 64 IT Troubleshooting & Diagnostic Suite (`techtools.subwrite.se`)**

A modular retro C64 / Swedish Navy (*Kungliga Flottan*) IT troubleshooting web suite designed as a companion subsite to [subwrite.se](https://subwrite.se), featuring a custom pixel-art SVG sprite of the iconic *Norrköping*-class (*Spica II*) fast-attack missile boat **Robotbåt R136 HMS Västervik**.

> [!IMPORTANT]
> **100% Local Password & Token Generation (Never on the Server):** All passwords, passphrases, UUIDs, cryptographic keys, and API tokens in `MOD-01` are generated **strictly inside your own browser** using the Web Crypto API (`window.crypto.getRandomValues`). No generated secret is ever created on, logged by, or transmitted to the server.

---

## Diagnostic Modules (`v0.2.4`)

1. **`MOD-01` — Password & Token Generator (`#/password-generator`)**
   - **Generated 100% Locally in Your Browser (Not on the Server):** Uses client-side CSPRNG (`window.crypto.getRandomValues`) with unbiased rejection sampling — zero network traffic, zero server involvement, and zero logging.
   - **`64BIT (16)` & `NO CONFUSE` Enabled by Default (Cookie-Persisted):** Opens with **`64BIT (16)`** (`16` chars, `A–Z`, `a–z`, `0–9`) and **`NO CONFUSE`** enabled by default — excluding look-alike characters (`0`, `O`, `o`, `1`, `l`, `I`, `|`) that can be misread across proportional/sans-serif fonts — while saving any user preset or toggle changes in a local preference cookie (`tt_passgen_prefs`).
   - **Complexity Presets & Strength Tiers:** Presets (`PIN (8)`, `64BIT (16)`, `STANDARD IT (20)`, `FORTRESS (32)`), custom length (`6–64`), character class toggles, batch generation (`1×`, `5×`, `10×`), and live entropy telemetry (`ULTRA NAVY CRYPTO` for `>= 32` char passwords, `NAVY CRYPTO GRADE` for `> 5` word passphrases).
   - **Multi-Branch Passphrases & Developer Tokens:** Memorable cross-domain word passphrases (`3–8` words blending Navy, Nature, Food, Drinks, Cars, Fitness, and Tech vocabulary) plus developer/auth tokens (`UUID v4`, `Hex 128/256-bit`, `Base64URL 256/512-bit`, and custom-prefixed `Base62` API keys).
2. **`MOD-02` — DNS & Domain Registry Intel (`#/dns-inspector`)**
   - Selectable DNS resolvers: **Google `8.8.8.8` (default)**, **Cloudflare `1.1.1.1`**, or **Custom** public DNS server IP / authoritative nameserver hostname.
   - Parallel lookups for `A`, `AAAA`, `CNAME`, `PTR`, `MX` (including mail exchanger IPv4 resolution), `NS`, `SOA`, `TXT`, and `CAA`.
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

---

## Keyboard Shortcuts

| Context | Key | Action |
| :--- | :--- | :--- |
| **Command Deck** | `1` – `6` / `↑` `↓` `←` `→` / `Tab` | SELECT a module only (card is focused and scrolled into view) |
| | `Enter` | Launch the selected module |
| **Global (inside a tool)** | `1` – `6` | Jump directly to module `MOD-01` .. `MOD-06` (when outside text inputs) |
| | `ESC` | Blur focused text input (unlocking shortcuts), or return to the R136 Command Deck |
| | `S` | Toggle synthesized 8-bit Naval CIC sound effects ON / OFF |
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

- **`v0.2.4`** — Password Generator Enhancements, Lighter Marine Blue Theme & Authentic Robotbåt Redesign:
  - **Password & Token Generator (`MOD-01`):**
    - Updated default preset to **`64BIT (16)`** (`16` chars, `A–Z`, `a–z`, `0–9`) and reworked ambiguous filtering into **`NO CONFUSE`** mode (default checked, excluding font-confusable look-alike characters `0, O, o, 1, l, I, |`), honoring user adjustments across visits via cookie (`tt_passgen_prefs`).
    - Expanded passphrase dictionary across **Navy, Nature, Food, Drinks, Cars, Fitness, and Tech** vocabulary.
    - Updated strength status tiers: `>= 32` character passwords (`FORTRESS (32)`+) display **`ULTRA NAVY CRYPTO`**, and `> 5` word passphrases (`6–8` words) display **`NAVY CRYPTO GRADE`**.
    - Highlighted across tool UI and documentation that all passwords, passphrases, and tokens are generated **100% locally in the browser and never on the server**.
  - **Theme, Robotbåt & UX Polish:**
    - Lifted console palette to a brighter **Swedish Marine / C64 Royal Blue** theme with softened CRT scanlines/vignette and responsive single-row 6-module desktop navigation.
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
  - Added crawler-friendly "About TechTools" footer, Open Graph / Twitter / schema.org metadata and an 8-bit `og-image.png`.
- **`v0.1.2`** — Keyboard-first workflow & selectable DNS resolvers:
  - Added single-letter keyboard shortcuts across `MOD-01`, `MOD-02`, and `MOD-03`, plus `ESC` input-blur before returning to Command Deck.
  - Added `Tab`-selectable diagnostic sections and secret rows with `[C]` one-key clipboard copy (`CopyableIntelSection`).
  - Added DNS server selector in `MOD-02` (`Google 8.8.8.8` default, `Cloudflare 1.1.1.1`, and `Custom` public DNS IP/hostname with SSRF protection and port-53 reachability/refusal diagnostics).
  - Unified `FORTRESS (32)` preset styling and removed the redundant `DECK` button from the module switcher bar.
- **`v0.1.0`** — Initial release of TechTools (`techtools.subwrite.se`) featuring Swedish Navy C64 theme, 8-bit `R136 HMS Västervik` pixel SVG, Password & Token Generator, DNS & WHOIS Inspector, and What's My IP / RIR Range Owner Intel.

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
