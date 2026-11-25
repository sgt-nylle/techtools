#!/usr/bin/env bash
# Downloads the free DB-IP Lite City + ASN MMDB databases (CC BY 4.0, no account/licence key needed)
# into data/geoip/ (override with GEOIP_DIR). The MOD-11 Geo Radar backend (/api/geo) loads them in memory.
#
# MaxMind GeoLite2 is also supported: drop GeoLite2-City.mmdb / GeoLite2-ASN.mmdb into the same folder
# (they take precedence over the DB-IP files when present).
#
# Re-run monthly (DB-IP publishes a new Lite build at the start of each month), then restart techtools.service.
set -euo pipefail
cd "$(dirname "$0")/.."

DEST="${GEOIP_DIR:-data/geoip}"
mkdir -p "$DEST"

month_offset() {
  # $1 = months back (0 = current). GNU date first, BSD/macOS date fallback.
  date -u -d "$(date -u +%Y-%m-15) -$1 month" +%Y-%m 2>/dev/null || date -u -v-"$1"m +%Y-%m
}

fetch_db() {
  local kind="$1" out="$2" month url
  for back in 0 1 2; do
    month="$(month_offset "$back")"
    url="https://download.db-ip.com/free/dbip-${kind}-lite-${month}.mmdb.gz"
    if curl -fsSL --retry 2 --connect-timeout 10 -o "$DEST/$out.gz.part" "$url"; then
      gunzip -c "$DEST/$out.gz.part" >"$DEST/$out.part"
      mv -f "$DEST/$out.part" "$DEST/$out"
      rm -f "$DEST/$out.gz.part"
      echo "OK  $DEST/$out  <-  $url ($(du -h "$DEST/$out" | cut -f1))"
      return 0
    fi
  done
  rm -f "$DEST/$out.gz.part" "$DEST/$out.part"
  echo "FAILED to download DB-IP ${kind} lite database" >&2
  return 1
}

fetch_db city dbip-city-lite.mmdb
fetch_db asn dbip-asn-lite.mmdb

echo "GeoIP databases ready in $DEST — IP geolocation by DB-IP (https://db-ip.com), CC BY 4.0."
