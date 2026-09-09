#!/usr/bin/env bash
# Re-downloads the three landing-page display/data faces — Landing-Page-Specs §3.2, §7.2.
#
# These are the Google Fonts SUBSET builds (one script per file), fetched once
# and committed. §6.10 forbids a third-party font origin on this property, so
# the files must live in the repository; this script exists so that "where did
# these bytes come from" has an answer other than someone's memory.
#
# A font update is a visual change. Diff the output before committing.
#
#   bash apps/web/scripts/fetch-fonts.sh
set -euo pipefail

cd "$(dirname "$0")/../app/fonts"

# Google Fonts serves woff2 only to a browser UA; anything else gets ttf.
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

# $1 = css2 family spec, $2 = subset comment to select, $3 = output file
get() {
  local url
  url=$(curl -sS -A "$UA" "https://fonts.googleapis.com/css2?family=$1&display=swap" \
    | awk -v want="/* $2 */" 'index($0,want){f=1;next} f&&/src: url\(/{match($0,/https:[^)]*/); print substr($0,RSTART,RLENGTH); exit}')
  [ -n "$url" ] || { echo "no $2 subset found for $1" >&2; exit 1; }
  echo "$3 <- $url"
  curl -sS -o "$3" "$url"
}

# Arabic display (§3.2: a genuine display Arabic, not a bolded text face).
get "Reem+Kufi:wght@500"      arabic ReemKufi-Medium-arabic.woff2
# Latin display, paired with it.
get "Space+Grotesk:wght@500"  latin  SpaceGrotesk-Medium-latin.woff2
# Data, metadata, and the DICOM-style readouts. Same superfamily as the body
# face, so mono metadata does not feel imported.
get "IBM+Plex+Mono:wght@400"  latin  IBMPlexMono-Regular-latin.woff2

ls -la ./*.woff2
