# TechTools — Browser Extension (Chromium MV3 / Firefox)

Brings the TechTools modules into the browser as an **action popup** (720×580) and a
**docked side panel**. It reuses the web app's React tools, theme tokens and CSS — nothing is
embedded via iframe; everything is packaged locally.

## Folder structure

```
techtools/
├── vite.extension.config.ts        # second Vite build -> extension/dist
├── extension/
│   ├── README.md
│   ├── tsconfig.json               # `npm run typecheck:ext`
│   ├── app/                        # extension UI source (bundled)
│   │   ├── popup.html              # action popup  (html.ext-popup  -> 720x580)
│   │   ├── sidepanel.html          # side panel    (html.ext-panel  -> fills viewport)
│   │   ├── ext-main.tsx            # entry (loads fetch shim, theme CSS, app)
│   │   ├── ExtensionApp.tsx        # launcher/palette, tool view, top nav, shortcuts
│   │   ├── ext-storage.ts          # chrome.storage.local: default tool, start mode, theme, pending input
│   │   ├── ext-fetch-shim.ts       # routes /api/* to https://techtools.subwrite.se
│   │   ├── prefill.ts              # fills the tool input from a context-menu selection
│   │   └── ext.css                 # popup/panel viewport constraints + launcher styles
│   ├── public/                     # copied verbatim into the bundle
│   │   ├── manifest.json
│   │   ├── background.js           # service worker: context menus + commands
│   │   ├── theme-boot.js           # paints saved theme before first render (MV3: no inline JS)
│   │   └── icons/icon{16,48,128}.png
│   └── dist/                       # build output — LOAD THIS (git-ignored)
└── src/ …                          # existing web app (tools, theme.ts, CSS) — imported, not copied
```

## Install

End users: see **Browser Extension** in the [main README](../README.md#browser-extension-chrome--edge--brave--firefox) (one-line installers for Linux/macOS/Windows + manual steps).

## Load unpacked from source (Chrome / Edge / Brave)

```bash
cd techtools
npm install
npm run build:ext          # -> extension/dist   (use `npm run watch:ext` while developing)
```

1. Open `chrome://extensions` (Edge: `edge://extensions`, Brave: `brave://extensions`).
2. Enable **Developer mode**.
3. **Load unpacked** → select `techtools/extension/dist`.
4. Pin the extension from the puzzle-piece menu.
5. After code changes: rebuild, then click the ↻ reload icon on the extension card.
6. Set/adjust shortcuts at `chrome://extensions/shortcuts`. Chrome only applies `suggested_key` on a fresh install; if a shortcut shows as *Not set* after an update, assign it there (or remove and re-add the extension).

**Firefox (scaffolded, untested):** `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* →
`extension/dist/manifest.json`. `chrome.sidePanel` doesn't exist in Firefox, so the PANEL button
hides itself (a `sidebar_action` entry would be the Firefox equivalent).

## Behaviour

| Feature | How |
|---|---|
| Popup | `Alt+Shift+K` (`_execute_action`) or toolbar icon. (`Alt+Shift+T` is reserved by Chrome/Edge for toolbar focus and cannot be used.) |
| Side panel | `Alt+Shift+S`, the **▥ PANEL** button, `Alt+S`, or right-click → *Open TechTools side panel* |
| Launcher | Search box is focused on open: fuzzy filter, `↑/↓` + `Enter`, or `1–9` when the search is empty |
| Default tool | In a tool: **☆ PIN** / `Alt+P`. Launcher footer: choose *ON OPEN → Launcher / Default tool* |
| Back to list | **⚓ TOOLS** button or `Esc` (first `Esc` blurs a focused input) |
| Switch tool | Top-bar dropdown, or `1–9` when not typing |
| Theme | Same 5 themes; `Alt+T` cycles; synced between popup and panel via `chrome.storage.onChanged` |
| Context menu | Select text → right-click → **Inspect with TechTools** → *Auto-detect* or pick a tool |

Auto-detect: JWT → JWT/SAML · SAML XML/Base64 → JWT/SAML (SAML tab) · PEM → Cert Analyzer ·
mail headers → Mail Header Analyzer · CIDR → Subnet Calculator · IP → IP lookup ·
URL → URL Probe · domain → DNS. Otherwise the launcher opens with the text as the search query.
The selection is handed over through `chrome.storage.local` (`tt_ext_pending`, 30 s TTL) and typed into
the tool's first input; for lookup tools press `Enter` to run.

## Offline vs. online

* **LOCAL** (work offline): Pass & Tokens, Mail Headers, Subnet Calc, JWT/SAML.
* **ONLINE** (need `https://techtools.subwrite.se/api/*`, allowed via `host_permissions`): DNS & WHOIS,
  What's My IP, Cert Analyzer, URL Tester, Sec Headers.

## Known limitations / follow-ups

* Retro pixel fonts (`Press Start 2P`, `VT323`) are loaded from Google Fonts on the website. The extension doesn't
  fetch remote fonts (offline + store policy), so **Navy** falls back to the system monospace font. Bundle
  `@fontsource/*` packages to restore them.
* `chrome.action.openPopup()` from the context menu needs Chrome 127+; otherwise the worker falls back to the side
  panel, then to a small popup window.
* Base64 / timestamp converters aren't web-app modules yet. Adding a module to `src/tools/registry.ts`
  makes it appear in the web app **and** the extension automatically.
* Store publishing needs: privacy policy (no data collected; API calls only for ONLINE tools), screenshots,
  and `npm run build:ext` zipped from `extension/dist`.
