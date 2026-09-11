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

All three families are **SIL Open Font License 1.1**. Full licence text for
IBM Plex is in `LICENSE.txt`, and for Google Sans Flex in
`GoogleSansFlex-OFL.txt`.

| File | Family | Role | Bytes | Coverage |
|---|---|---|---|---|
| `IBMPlexSansArabic-{Regular,Medium,SemiBold,Bold}.woff2` | IBM Plex Sans Arabic | Application + landing body, both scripts | ~72–76 KB each | full |
| `IBMPlexSansArabic-Light.woff2` | IBM Plex Sans Arabic | Arabic **display** (weight 300), declared in `components/corridor/fonts.ts` — landing only, not preloaded | ~75 KB | full |
| `GoogleSansFlex-latin.woff2` | Google Sans Flex (variable, wght 300–500) | Latin display + body — landing only | ~49.6 KB | Latin subset |
| `IBMPlexMono-Regular-latin.woff2` | IBM Plex Mono | Data, metadata, DICOM-style readouts — landing only | 14.7 KB | Latin subset |

## Why the Latin landing faces are subset and the Plex Sans Arabic files are not

The two Latin faces added for the landing page (§3.2) — Google Sans Flex and
IBM Plex Mono — are the Google Fonts **Latin subset** builds fetched by
`scripts/fetch-fonts.sh`: the Latin block only, not the full character set.

`IBMPlexSansArabic-Light.woff2`, the landing page's Arabic display weight, is
fetched as a **complete** file instead, from IBM's own release — like the four
base Plex Sans Arabic weights below, and unlike the two Latin faces above.

The four base IBM Plex Sans Arabic weights (declared in `app/layout.tsx`)
predate this page, are shared with the whole signed-in application, and carry
both scripts in one file by design (D4: one family for both scripts, so
Arabic and French render with the same voice). Re-subsetting them is a change
to the application's typography, not to the landing page, so it is
deliberately out of scope here.

Light is the exception among the "full, both-script" builds: although it
carries the same complete file layout as the four base weights, it is
declared in `components/corridor/fonts.ts` with the other landing-only faces
and kept off the preload list, because §3.2 requires every display face to be
`preload: false` and the signed-in application never requests weight 300.

## Refreshing

`scripts/fetch-fonts.sh` records the exact requests these files came from.
Re-running it will pick up whatever version Google Fonts currently serves, so
diff the result before committing — a font update is a visual change.
