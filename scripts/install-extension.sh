#!/usr/bin/env bash
# TechTools browser extension — easy installer for Linux / macOS.
#
#   curl -fsSL https://techtools.subwrite.se/downloads/install-extension.sh | bash
#   ./scripts/install-extension.sh [--open] [--browser chrome|chromium|brave|edge|firefox] [--dir PATH]
#
# What it does: downloads the latest packaged extension (or uses a local build in
# ./extension/dist when run from the repo), unpacks it to a stable folder, then shows the
# remaining one-time "Load unpacked" step. Browsers do not allow fully silent installs of
# unpacked extensions, so the last click is yours (about 10 seconds). Re-run to update.
set -euo pipefail

BASE_URL="${TECHTOOLS_URL:-https://techtools.subwrite.se}"
ZIP_NAME="techtools-extension-latest.zip"
case "$(uname -s)" in
  Darwin) DEFAULT_DIR="$HOME/Library/Application Support/TechTools/extension" ;;
  *) DEFAULT_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/techtools-extension" ;;
esac
DEST="$DEFAULT_DIR"; OPEN=0; BROWSER=""

while [ $# -gt 0 ]; do
  case "$1" in
    --open) OPEN=1 ;;
    --browser) BROWSER="${2:-}"; shift ;;
    --dir) DEST="${2:-}"; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }

[ "$BROWSER" = "firefox" ] && ZIP_NAME="techtools-extension-firefox.zip"
# ?t=<epoch> busts CDN caches so updates are always fetched fresh
ZIP_URL="$BASE_URL/downloads/$ZIP_NAME?t=$(date +%s)"
SRC_LOCAL=""
LOCAL_SUB="dist"; [ "$BROWSER" = "firefox" ] && LOCAL_SUB="dist-firefox"
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "$(dirname "${BASH_SOURCE[0]}")/../extension/$LOCAL_SUB/manifest.json" ]; then
  SRC_LOCAL="$(cd "$(dirname "${BASH_SOURCE[0]}")/../extension/$LOCAL_SUB" && pwd)"
fi

command -v unzip >/dev/null 2>&1 || [ -n "$SRC_LOCAL" ] || { echo "Please install 'unzip' first." >&2; exit 1; }

mkdir -p "$DEST"
# Safety: only replace a folder that is empty or already holds a TechTools install.
if [ -n "$(ls -A "$DEST")" ] && ! grep -q '"TechTools' "$DEST/manifest.json" 2>/dev/null; then
  echo "Refusing to overwrite non-empty folder that is not a TechTools install: $DEST" >&2
  exit 1
fi
if [ -n "$SRC_LOCAL" ]; then
  say "Using local build: $SRC_LOCAL"
  rm -rf "$DEST"/* && cp -r "$SRC_LOCAL"/. "$DEST"/
else
  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  say "Downloading $ZIP_URL"
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$ZIP_URL" -o "$TMP/ext.zip"; else wget -qO "$TMP/ext.zip" "$ZIP_URL"; fi
  rm -rf "$DEST"/* && unzip -q "$TMP/ext.zip" -d "$DEST"
fi

[ -f "$DEST/manifest.json" ] || { echo "Install failed: manifest.json missing in $DEST" >&2; exit 1; }
VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$DEST/manifest.json" | head -1)"
say "TechTools extension v$VERSION unpacked to: $DEST"

# Copy the path to the clipboard when possible (handy for the folder picker).
if command -v pbcopy >/dev/null 2>&1; then printf '%s' "$DEST" | pbcopy && say "Folder path copied to clipboard."
elif command -v wl-copy >/dev/null 2>&1; then printf '%s' "$DEST" | wl-copy && say "Folder path copied to clipboard."
elif command -v xclip >/dev/null 2>&1; then printf '%s' "$DEST" | xclip -selection clipboard && say "Folder path copied to clipboard."
fi

find_bin() {
  for c in "$@"; do command -v "$c" >/dev/null 2>&1 && { command -v "$c"; return 0; }; done
  return 1
}
CHROMIUM_BINS=(google-chrome google-chrome-stable chromium chromium-browser brave-browser brave microsoft-edge microsoft-edge-stable)
case "$BROWSER" in
  chrome)   CHROMIUM_BINS=(google-chrome google-chrome-stable) ;;
  chromium) CHROMIUM_BINS=(chromium chromium-browser) ;;
  brave)    CHROMIUM_BINS=(brave-browser brave) ;;
  edge)     CHROMIUM_BINS=(microsoft-edge microsoft-edge-stable) ;;
esac

if [ "$BROWSER" = "firefox" ]; then
  cat <<EOF

Firefox (temporary add-on, removed on restart):
  1. Open  about:debugging#/runtime/this-firefox
  2. Click "Load Temporary Add-on…"
  3. Select  $DEST/manifest.json
EOF
  [ "$OPEN" = 1 ] && { FF="$(find_bin firefox || true)"; [ -n "$FF" ] && "$FF" "about:debugging#/runtime/this-firefox" >/dev/null 2>&1 & }
  exit 0
fi

cat <<EOF

Finish in your browser (one-time, ~10 seconds):
  1. Open  chrome://extensions   (Edge: edge://extensions · Brave: brave://extensions)
  2. Turn on "Developer mode" (top-right)
  3. Click "Load unpacked" and choose:
       $DEST
  4. Pin the TechTools icon, then press Alt+Shift+K (popup) or Alt+Shift+S (side panel).

Update later by re-running this script, then click the ↻ reload icon on the extension card.
EOF

if [ "$OPEN" = 1 ]; then
  BIN="$(find_bin "${CHROMIUM_BINS[@]}" || true)"
  if [ -n "$BIN" ]; then
    case "$BIN" in *edge*) URL="edge://extensions" ;; *brave*) URL="brave://extensions" ;; *) URL="chrome://extensions" ;; esac
    say "Opening $URL with $BIN"
    "$BIN" "$URL" >/dev/null 2>&1 &
  elif [ "$(uname -s)" = "Darwin" ]; then
    open -a "Google Chrome" "chrome://extensions" 2>/dev/null || say "Could not find a Chromium browser to open."
  else
    say "Could not find a Chromium-based browser to open."
  fi
fi
