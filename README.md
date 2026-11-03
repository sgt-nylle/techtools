# TechTools // HMS Västervik (R136) ⚓

> **Swedish Navy Commodore 64 IT Troubleshooting & Diagnostic Suite (`techtools.subwrite.se`)**

A modular retro C64 / Swedish Navy (*Kungliga Flottan*) IT troubleshooting web suite designed as a companion subsite to [subwrite.se](https://subwrite.se), featuring a custom 8-bit pixel-grid SVG sprite of the iconic *Norrköping*-class fast-attack missile boat **Robotbåt R136 HMS Västervik**.

---

## Diagnostic Modules (`v0.1.2`)

1. **`MOD-01` — Password & Token Generator (`#/password-generator`)**
   - **100% Client-Side CSPRNG (`window.crypto.getRandomValues`)** with unbiased rejection sampling—zero network traffic, zero server logging.
   - Complexity presets (`PIN`, `Easy-Read`, `Standard IT`, `Fortress`), custom length (`6–64`), character class toggles, ambiguous-character filter (`0OIl1|`), live entropy meter, and batch generation.
   - Memorable word passphrases (`3–8` words) and developer/auth tokens (`UUID v4`, `Hex 128/256-bit`, `Base64URL 256/512-bit`, and custom-prefixed `Base62` API keys).
2. **`MOD-02` — DNS & Domain Registry Intel (`#/dns-inspector`)**
   - Selectable DNS resolvers: **Google `8.8.8.8` (default)**, **Cloudflare `1.1.1.1`**, or **Custom** public DNS server IP / authoritative nameserver hostname.
   - Parallel lookups for `A`, `AAAA`, `CNAME`, `PTR`, `MX` (including mail exchanger IPv4 resolution), `NS`, `SOA`, `TXT`, and `CAA`.
   - Automated **SPF** (`v=spf1`) and **DMARC** (`_dmarc`) email security posture auditing.
   - Live port-43 **WHOIS Domain Registration** lookup (supporting `.se`/`.nu` via `whois.iis.se`, Verisign, PIR, EURid, and automatic IANA TLD referral discovery).
3. **`MOD-03` — What's My IP? & Range Owner (`#/whats-my-ip`)**
   - Displays caller's public IPv4/IPv6 address, reverse `PTR` hostname, routed BGP CIDR prefix, Autonomous System (`ASN` + ISP holder), and RIR allocation block owner/netname/country/abuse contact.
   - Includes an external IP/hostname lookup bar to inspect any third-party IP block.

---

## Keyboard Shortcuts

| Context | Key | Action |
| :--- | :--- | :--- |
| **Command Deck** | `↑` / `↓` / `←` / `→` | Move cursor between diagnostic modules |
| | `Enter` | Launch highlighted module |
| **Global** | `1` – `3` | Jump directly to module `MOD-01` .. `MOD-03` (when outside text inputs) |
| | `ESC` | Blur focused text input (unlocking shortcuts), or return to the R136 Command Deck |
| | `S` | Toggle synthesized 8-bit Naval CIC sound effects ON / OFF |
| | `Tab` / `Shift+Tab` | Step through buttons, secret rows, and diagnostic intel sections |
| | `C` | Copy the currently focused intel section / secret row |
| **MOD-01 (PassGen)** | `P` / `W` / `T` | Switch between Passwords, Passphrases, and API Tokens |
| | `N` / `E` / `D` / `F` | Apply preset: `PIN`, `Easy-Read`, `Standard IT`, `Fortress` |
| | `-` / `+` | Decrease / increase password length or passphrase word count |
| | `U` / `L` / `G` / `Y` / `X` | Toggle Upper, Lower, Digits, Symbols, or No Ambiguous |
| | `R` / `C` / `A` | Regenerate (`R`), Copy `#1` or focused row (`C`), Copy All (`A`) |
| **MOD-02 (DNS & WHOIS)** | `Q` (or `/`) / `R` | Focus domain input (`Q`), Run/re-scan DNS & WHOIS (`R`) |
| | `G` / `F` / `U` | Select DNS resolver: Google `8.8.8.8` (`G`, default), Cloudflare `1.1.1.1` (`F`), Custom DNS (`U`) |
| | `A` / `I` / `M` / `N` / `W` | Filter view: All, IP/PTR, MX/SPF/DMARC, NS/SOA/TXT, WHOIS |
| | `V` | Toggle Raw WHOIS record |
| **MOD-03 (What's My IP)** | `C` / `M` / `R` / `Q` / `V` | Copy IP (`C`), My IP (`M`), Re-scan (`R`), Focus target input (`Q`), Raw RIR (`V`) |

---

## Extending With New Tools

TechTools uses a plugin-style registry so new troubleshooting tools can be added with minimal boilerplate:

1. Create a React component in `src/tools/<YourTool>.tsx` (and, if server-side network probing is needed, add a route in `server/apiHandler.mjs`).
2. Append a `ToolModule` entry to `TOOL_MODULES` in `src/tools/registry.ts`.
3. The Command Deck cards, persistent top module bar, URL `#/<tool-id>` routing, and `[1–9]` keyboard shortcuts automatically register the new module.

---

## Security & Architecture

- **Zero External Runtime Dependencies on Backend:** Pure Node.js v20+ (`node:dns`, `node:net`, `node:https`, `node:http`) with zero third-party API keys required.
- **Built-In Rate Limiting & Input Sanitization:** Per-IP sliding-window rate limiter (`60 req/min/IP`), strict hostname/IP validation, and port-43 CRLF stripping.
- **Zero-Trust Secret Generation:** Passwords, passphrases, and tokens never leave the user's browser.

---

## Changelog

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
