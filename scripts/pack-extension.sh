#!/usr/bin/env bash
# Builds the browser extension and packages it for download.
#   Output (served by the web app after `npm run build` + deploy):
#     dist/downloads/techtools-extension.zip          (latest)
#     dist/downloads/techtools-extension-<version>.zip
#     dist/downloads/install-extension.sh | install-extension.ps1
# Run AFTER `npm run build` (Vite empties dist/). Use `npm run release`.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="$(node -p "require('./package.json').version")"
npm run --silent build:ext

OUT="dist/downloads"
mkdir -p "$OUT"
rm -f "$OUT"/techtools-extension*.zip

( cd extension/dist && zip -qr -X "../../$OUT/techtools-extension-$VERSION.zip" . )
cp "$OUT/techtools-extension-$VERSION.zip" "$OUT/techtools-extension.zip"
cp scripts/install-extension.sh scripts/install-extension.ps1 "$OUT/"

echo "Packed extension v$VERSION:"
ls -la "$OUT"
