#!/usr/bin/env bash
# Re-download the landing page's vendored faces — app/fonts/README.md.
#
# Google Fonts serves a different file per User-Agent; this one asks for woff2.
# Re-running picks up whatever version is served today, so diff before
# committing: a font update is a visual change.
set -euo pipefail
cd "$(dirname "$0")/../app/fonts"

UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

# get <css2 family query> <subset comment> <output file>
get() {
  local url
  url=$(curl -sS -A "$UA" "https://fonts.googleapis.com/css2?family=$1&display=swap" \
    | awk -v want="/* $2 */" 'index($0,want){f=1;next} f&&/src: url\(/{match($0,/https:[^)]*/); print substr($0,RSTART,RLENGTH); exit}')
  [ -n "$url" ] || { echo "no $2 subset found for $1" >&2; exit 1; }
  echo "$3 <- $url"
  curl -sS -o "$3" "$url"
}

# Latin display + body. Variable, weight 300–500; the latin subset covers fr and en.
get "Google+Sans+Flex:wght@300..500" latin GoogleSansFlex-latin.woff2
# Data, metadata and DICOM-style readouts.
get "IBM+Plex+Mono:wght@400"         latin IBMPlexMono-Regular-latin.woff2

# Arabic display weight. A COMPLETE file (both scripts), like the four Plex
# Sans Arabic weights the root layout already ships — from IBM's own release.
curl -sS -o IBMPlexSansArabic-Light.woff2 \
  https://raw.githubusercontent.com/IBM/plex/master/packages/plex-sans-arabic/fonts/complete/woff2/IBMPlexSansArabic-Light.woff2

# Google Sans Flex's licence text, from the family's own download manifest.
curl -sS 'https://fonts.google.com/download/list?family=Google%20Sans%20Flex' \
  | python3 -c 'import json,sys; t=sys.stdin.read(); d=json.loads(t[t.index("{"):]); print(next(f["contents"] for f in d["manifest"]["files"] if f["filename"]=="OFL.txt"), end="")' \
  > GoogleSansFlex-OFL.txt

ls -la ./*.woff2 ./GoogleSansFlex-OFL.txt
