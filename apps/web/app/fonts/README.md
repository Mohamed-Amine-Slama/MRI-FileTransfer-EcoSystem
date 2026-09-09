# Vendored typefaces

Every face here is **self-hosted**, for two reasons that both come from
Landing-Page-Specs §6.10 and §8.2:

1. A third-party font origin on a health property is a CSP hole and a
   data-protection processor nobody signed off. `font-src 'self'` in
   `next.config.mjs` is enforced, so a `fonts.gstatic.com` URL would simply
   not load.
2. `next/font/google` downloads at build time, and when that fetch fails —
   as it does inside a Docker build on a restricted network — Next falls back
   to system fonts and still exits 0. The deployment image ships without its
   typeface and nothing fails. Vendoring makes the image build hermetic.

All four families are **SIL Open Font License 1.1**. Full licence text for
IBM Plex is in `LICENSE.txt`; Reem Kufi and Space Grotesk carry the same
licence, reproduced at <https://openfontlicense.org>.

| File | Family | Role | Bytes | Coverage |
|---|---|---|---|---|
| `IBMPlexSansArabic-{Regular,Medium,SemiBold,Bold}.woff2` | IBM Plex Sans Arabic | Application + landing body, both scripts | ~72–76 KB each | full |
| `ReemKufi-Medium-arabic.woff2` | Reem Kufi (variable, wght 400–700) | Arabic **display** — landing only | 9.2 KB | Arabic subset |
| `SpaceGrotesk-Medium-latin.woff2` | Space Grotesk (variable, wght 300–700) | Latin **display** — landing only | 13.3 KB | Latin subset |
| `IBMPlexMono-Regular-latin.woff2` | IBM Plex Mono | Data, metadata, DICOM-style readouts — landing only | 14.7 KB | Latin subset |

## Why the three landing faces are subset and the Plex Sans Arabic files are not

The three added for the landing page (§3.2) are the Google Fonts **subset**
builds: the Arabic block for Reem Kufi, the Latin block for the other two.
§7.2 sets a target of ≤48 KB per Arabic weight and ≤28 KB per Latin weight,
and all three come in far under it because each carries one script rather
than both.

The IBM Plex Sans Arabic files predate this page, are shared with the whole
signed-in application, and carry both scripts in one file by design (D4: one
family for both scripts, so Arabic and French render with the same voice).
Re-subsetting them is a change to the application's typography, not to the
landing page, so it is deliberately out of scope here.

## Refreshing

`scripts/fetch-fonts.sh` records the exact requests these files came from.
Re-running it will pick up whatever version Google Fonts currently serves, so
diff the result before committing — a font update is a visual change.
