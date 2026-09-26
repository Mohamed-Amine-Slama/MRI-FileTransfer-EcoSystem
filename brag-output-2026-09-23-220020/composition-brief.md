# Hyperframes Composition Brief: MIR

## Objective

Create a short launch-style brag video for **MIR**, a cross-border medical
imaging transfer platform. The video plays the product straight for fifteen
seconds and then turns: it ends on the project's own gate report saying
`NOT LAUNCHABLE`. The discipline is the brag.

## Output

- Composition directory: `brag-output-2026-09-23-220020/composition/`
- Rendered video: `brag-output-2026-09-23-220020/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 24.6s target (hard bound: 15–25s)

## Source Material

- **Project root:** `/mnt/c/Users/moham/OneDrive/Desktop/MIR`
- **Primary files read:**
  - `README.md` — the "NOT READY FOR REAL PATIENTS" warning and property list
  - `apps/web/lib/site/copy.ts` — all site copy, three locales (source of every line below)
  - `apps/web/app/corridor.css` — the `:root` design tokens
  - `apps/web/components/corridor/scenes/S04UploadDemo.tsx` — the upload demo ("THE ARGUMENT"), `TOTAL_FILES = 312`
  - `apps/web/components/corridor/scenes/S05Consent.tsx` — the consent/revoke scene
  - `apps/web/components/corridor/primitives/MirMark.tsx` — the reticle mark geometry
  - `apps/web/components/corridor/fonts.ts` — the three faces
  - `scripts/verify-gates.mjs` — run live; its output is quoted verbatim
  - `apps/web/public/seq/hero/SOURCE.md` — proof the imagery is synthetic
- **Product name:** MIR
- **Tagline / strongest claim:** "Their scan arrives before they do."
- **Key UI moments to recreate:**
  1. The upload demo card mid-transfer, with the **Cut the connection** button — the bar must **freeze** and **resume from the same position**, never restart.
  2. The consent card with a **Revoke** control that locks three study thumbnails.
  3. The `pnpm verify:gates` terminal output ending in `NOT LAUNCHABLE.`

### Copy that must appear verbatim

All lines are exact from `apps/web/lib/site/copy.ts` unless marked otherwise.

- `Cross-border medical imaging transfer` (en.heroEyebrow)
- `Their scan arrives before they do.` (en.heroHeadline)
- `الصورة تصل قبل المريض.` (ar.heroHeadline — RTL, IBM Plex Sans Arabic Light)
- `Try to break it.` (en.uploadTitle)
- `Cut the connection` (en.uploadCut)
- `Uploading` / `Connection cut` / `Complete` (en.uploadState*)
- `Retrying in` + `s` (en.uploadRetryIn, en.uploadSeconds)
- `Resumed exactly where it stopped. Nothing re-sent.` (en.uploadResumedLine)
- `Transfer complete. The study's checksum matched.` (en.uploadCompleteLine — note the typographic apostrophe `’`)
- `Consent is a record, not a checkbox.` (en.consentTitle)
- `Granted to` (en.consentGrantedTo)
- `Receiving doctor — the name is shown to the patient` (en.consentRecipientRedacted)
- `Revoke` (en.consentRevoke)
- `Consent revoked. The study is no longer reachable.` (en.consentRevokedNotice)
- `Files` / `Rate` (en.uploadFilesLabel, en.uploadRateLabel)

From `node scripts/verify-gates.mjs`, verbatim:

- `$ pnpm verify:gates` (the command)
- `OK    P7.2   Interrupted upload resumes`
- `OK    P4.4   Audit immutable under tamper`
- `OK    P5.3   Consent evidence + revocation`
- `BLKD  P14.4  Pen test, high/critical remediated`
- `verified 29   local 3   partial 5   open 1   blocked 9   (of 47)`
- `NOT LAUNCHABLE.`
- `The blockers are legal and infrastructural, not code.`

Composition-authored (not from the repo, kept minimal and factual):
- `RTL from day one` — small caption, scene 2
- `29 of 47 gates verified. 8 legal questions open.` — small caption, scene 6
  (both are restatements of verified facts, not new claims)

## Creative Direction

- **Tone preset:** `polished`, with a deadpan spine on the final turn.
- **Creative direction:** a quiet clinical product film that ends by refusing to launch.
- **Interpretation:** Restraint is the register. Light font weights, generous
  negative space, slow crossfades (0.6s), no zoom-punches, no exclamation marks,
  no kinetic-type showboating. The product is a medical instrument and the video
  should feel like one. Exactly one hard cut in the video (into scene 5) and
  exactly one loud moment (`NOT LAUNCHABLE`), and that moment lands *by
  subtraction* — the music stops rather than swells.
- **Angle:** The engineering is finished; it still refuses to launch. Most launch
  videos end with a CTA — this one ends with a gate report. The video shows the
  promise, the upload surviving a severed connection, and consent closing access
  on a click, then turns and shows the thing the team built to tell themselves
  *no*: 47 gates, 29 verified, 8 unanswered legal questions, and a refusal to
  touch a real patient until they are answered. The brag is the discipline, and
  the last line is the proof that the first fifteen seconds are honest.
- **Hook (0–2.5s):** The headline `Their scan arrives before they do.` revealed
  word by word on the white clinical ground, with the synthetic phantom slice
  sequence scrubbing on a dark tile beside it. No logo card first, no
  "introducing."
- **Outro / punchline:** `The blockers are legal and infrastructural, not code.` on white, MIR's
  reticle mark beneath, in silence.
- **Avoid:**
  - Generic SaaS language ("streamline", "empower", "seamless")
  - Abstract filler visuals — no generic particle fields, gradient washes, or
    motion-graphic shapes that could belong to any video
  - Unrelated visual redesign — do not invent a new brand; the tokens below are
    the product's own
  - Dark-mode defaults (see Visual Identity)
  - Any implication the product is live, diagnostic, or accepting patients

## Visual Identity

Exact values from `apps/web/app/corridor.css` `:root`:

- **Background (ground):** `#ffffff`
- **Panel:** `#eff4f2` · **Panel deep:** `#e5f1ed`
- **Text (ink):** `#000000` · subtle `rgb(0 0 0 / 0.62)` · muted `rgb(0 0 0 / 0.45)`
- **Hairline:** `rgb(0 0 0 / 0.1)`
- **Accent:** `#246f65` · **Accent deep:** `#054038` · **On accent:** `#ffffff`
- **Lime:** `#f8ffb4` · **Lime edge:** `#e5ed9b`
- **Alert:** `#b3261e` — reserved, used exactly once, on `NOT LAUNCHABLE`
- **Radii:** section 48px · card 24px · chip 37px · tile 8px
- **Eases (the site's own):** `--e-out: cubic-bezier(0.16, 1, 0.3, 1)`,
  `--e-in-out: cubic-bezier(0.65, 0, 0.35, 1)`, `--ease-entrance: cubic-bezier(0.2, 0, 0, 1)`

**Light ground is non-negotiable.** MIR is deliberately not a dark-mode tech
product. The only dark surfaces are the scan tile and the scene-5 terminal.

### Fonts

Real font files exist in the repo — use them, don't substitute:

- **Latin display + body:** `apps/web/app/fonts/GoogleSansFlex-latin.woff2` (variable, 300–500; use 300)
- **Data / readouts:** `apps/web/app/fonts/IBMPlexMono-Regular-latin.woff2` (400)
- **Arabic display:** `apps/web/app/fonts/IBMPlexSansArabic-Light.woff2` (300)

Copy these into `composition/assets/fonts/` and `@font-face` them locally. Do not
fetch from Google Fonts — the render must be deterministic and offline.

Arabic sets at `--script-scale: 1.08` with `--leading-display: 1.25` per the site's
own RTL tokens; match that so the Arabic line doesn't sit tight.

### Visual references from the project

- **Phantom slice sequence:** `apps/web/public/seq/hero/b/0001.avif … 0024.avif`
  (800×450, opaque). Scrub through them for the scan. These are the 3D
  Shepp-Logan phantom, computed from ten ellipsoids — provably synthetic, no
  patient data, which is precisely why they are safe to show.
- **Particle double helix:** `apps/web/public/helix/poster-ltr.avif` (1140×900,
  **has an alpha layer** — ffmpeg flattens it to black, `sharp` reads it
  correctly). Smoky green particles; sits over white. Use at low opacity as
  atmosphere in scenes 1 and 6 only.
- **MIR reticle mark:** from `MirMark.tsx` — viewBox `0 0 24 24`, `<circle cx=12
  cy=12 r=5.5>` plus four ticks `M12 2.5v4 M12 17.5v4 M2.5 12h4 M17.5 12h4`,
  stroked in `currentColor`. A ring and four ticks, **never a full crosshair**.
  Lime `#f8ffb4` on an accent `#246f65` tile.

Convert AVIF assets to PNG/WebP during preparation if the renderer prefers it;
preserve the helix's alpha channel when you do.

## Storyboard

Use the storyboard in `brag-output-2026-09-23-220020/brag-plan.md` as the creative contract. Scene
summary:

1. **The promise** — 3.9s — eyebrow + `Their scan arrives before they do.` revealed
   word by word (headline holds settled ~2.2s); phantom slices scrubbing on a dark
   tile; helix faint behind.
2. **Mirrored** — 2.4s — layout flips RTL, headline becomes `الصورة تصل قبل المريض.`,
   locale chips `ar · fr · en` arrive one by one, caption `RTL from day one`.
3. **Try to break it** — 6.9s — **centerpiece.** Upload card, `Files 0 / 312`,
   bar climbing; cursor presses `Cut the connection`; bar **freezes**, rate → `—`,
   `Retrying in 3s` counts down; bar resumes **from the identical position**;
   `Resumed exactly where it stopped. Nothing re-sent.` holds 1.5s; completes to
   312 / 312 with the checksum line.
4. **Consent is a record** — 4.0s — headline holds 1.8s; `Granted to` metadata and
   three phantom thumbnails; cursor presses `Revoke`; thumbnails lock in a 0.12s
   left-to-right stagger; `Consent revoked. The study is no longer reachable.`
5. **The turn** — 4.5s — full-bleed dark terminal, all mono. `$ pnpm verify:gates`
   types; four gate lines print ~0.22s apart (`OK` lime/teal, `BLKD` alert red);
   summary `verified 29   local 3   partial 5   open 1   blocked 9   (of 47)`; a held half-beat of nothing; then
   `NOT LAUNCHABLE.` in `#b3261e`, holding 1.4s in silence.
6. **The close** — 2.9s — white, near-empty. `The blockers are legal and infrastructural, not code.`
   holds 1.8s; MIR mark + wordmark; muted caption
   `29 of 47 gates verified. 8 legal questions open.` Silence.

**Transitions:** soft crossfade 0.6s between 1→2, 2→3, 3→4; **hard cut 0.15s**
4→5 (the only one); slow crossfade 0.8s 5→6; fade out.

**Readability floors (do not compress these):** scene 1 headline ≥2.2s settled ·
scene 3 resume line ≥1.5s · scene 4 headline ≥1.8s · scene 5 verdict ≥1.4s ·
scene 6 close line ≥1.8s. The four gate lines in scene 5 are scannable mono
accents, not sentences, so 0.22s apart is correct there.

## Audio

- **Audio role:** Sparse professional accents over a heavily treated bed, resolving
  into intentional silence.
- **Audio arc:** A low, darkened bed carries scenes 1–3, dips when the connection
  is cut and recovers on the resume, steps down on the consent revoke and does not
  recover, then **cuts to silence** exactly as `NOT LAUNCHABLE` lands — so the last
  ~4 seconds are the only ones with nothing playing, and the closing claim is
  delivered in silence.
- **Music:** `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` (109.96 BPM,
  117.36s) — the calmest of the five bundled tracks.
- **Music treatment:** **Must be treated, not used raw.** The bundled library is
  bright corporate pop; this is a medical product. Apply low gain plus a low-pass
  / darkening chain so it reads as warm room tone under the scenes. Fade in ~0.8s
  from 0s. Hard duck to silence at the verdict; it does not return. Use the
  `hyperframes-audio` skill's EQ / filter / gain-automation support for this —
  a raw un-EQ'd pop bed would wreck the tone.
- **Music cue guidance:** Bundled preset at
  `~/.claude/skills/brag/assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json`
  (`.md` beside it). Tempo 109.96 BPM. Suggested locks — **use 2–3 at most**:
  - **8.74s** (strength 0.99) — the `Cut the connection` press
  - **10.93s** (0.97) — the upload resuming
  - **13.11s** (0.98) — the `Revoke` press
  Beat grid near those: 6.00, 6.56, 7.09, 7.64, 8.19, 8.74, 9.29, 9.83, 10.37,
  10.93, 11.46, 12.02, 12.55, 13.11, 13.64. These are polish, not requirements —
  **story timing wins any conflict**, and because the bed is ducked and filtered
  the sync should be felt rather than heard. **No beat-synced text.**
- **Audio-reactive treatment:** **subtle, scenes 1 and 6 only** — let the helix's
  glow/opacity and the scan tile's presence breathe with music RMS. **Nothing
  reactive in scenes 3, 4, 5**: a progress bar or gate line that pulses with music
  would undercut the claim that it is showing real behaviour. No waveform,
  equalizer, musical-note or generic particle visuals anywhere.
- **Audio-coupled moments:**
  - scene 2, locale chips — three soft interface ticks, one per chip, decreasing in level
  - scene 3, `Cut the connection` press — one dry click (simulated interaction)
  - scene 3, connection drops — one low **subtractive** thud; the bed dips with it
  - scene 3, checksum matched — one soft confirm tone
  - scene 4, `Revoke` press — one dry click, then a muted low lock tone under the thumbnail stagger
  - scene 5, `$ pnpm verify:gates` — light randomized keypresses from `sfx/keyboard/`, quiet, under the typed command only
  - scene 5, `NOT LAUNCHABLE` — **no SFX.** The music cutting out is the event.
  - scene 6 — silence; at most one soft low resolving tone as the mark appears
- **SFX selection guidance:** Sparse and strictly motion-matched — roughly six cues
  in the whole video, each corresponding to something actually moving on screen.
  Prefer dry, low, un-sparkly files; this is a clinical product, not a game UI.
  Choose exact files after the animation exists.
- **SFX analysis guidance:** `~/.claude/skills/brag/assets/sfx/sfx-analysis.md`
  (and `.json`). **Prefer low high-frequency-risk files throughout** — every cue
  here is a polished moment, and there are no chaotic beats to hide brightness in.
- **Exact SFX choice:** Hyperframes chooses filenames, timestamps, density, and
  volume based on the implemented animation.
- **Restraint rule:** No swells, no risers, no impact-boom on `NOT LAUNCHABLE` —
  the silence is the hit, and a stinger would turn a serious statement into a
  trailer beat. The track's bright top end must never be audible over the consent
  or gate scenes. Nothing may make this product sound triumphant about being
  unfinished.
- **Voiceover:** **none.** `--voice` was not passed. Do not write, generate, or
  wire any narration.
- **Audio files:** copy the chosen music and any selected SFX into
  `brag-output-2026-09-23-220020/composition/assets/`. Paths in the composition HTML must be
  relative to `composition/` (e.g. `assets/music/…`), never absolute.

## Hyperframes Instructions

Load the composition-building Hyperframes domain skills — `hyperframes-core`
(composition contract + `data-*` timing), `hyperframes-animation` (motion),
`hyperframes-creative` (design spec, beats, audio-reactive), `hyperframes-keyframes`
(seek-safe keyframes), `hyperframes-cli` (lint/check/render), and `hyperframes-audio`
(the music treatment above needs its EQ/filter/automation support). /brag is its
own workflow: do not enter the `hyperframes` entry-point intent interview and do
not route into its generic promo / launch-video workflow. Prefer native Hyperframes
conventions over anything in `/brag`.

Requirements:

- Show at least one real UI, copy, or visual element from the source project.
  (This composition shows several — the upload card, the consent card, the gate
  output, the phantom slices, the helix, and the mark.)
- Keep all text readable in the final render; honour the readability floors above.
- Keep the video within 15–25 seconds.
- Include the planned music/SFX layer.
- Treat `/brag` audio notes as guidance, not a fixed cue sheet. Choose SFX after
  the visual animation exists.
- Treat music cue metadata as optional timing hints; ignore cues that hurt
  readability, pacing, or the product story.
- Major reveals may move toward nearby strong cues within ~0.15s; smaller
  entrances may align to nearby beats within ~0.10s. Use only 2–3 strong-cue locks
  in this video.
- Honour the music treatment: the fade-in, the dip on the cut, the step-down on
  revoke, and above all the **hard duck to silence at the verdict**.
- Use the audio-reactive workflow for the scene 1 and 6 treatment only. If
  extraction is unavailable (no helper, or ffmpeg missing), document it and skip
  it — do not block the render.
- Use local assets for audio, fonts, images, and any runtime dependencies. The
  render must not require network access.
- Run `hyperframes check` before render — it is brag's single gate.

## Factual guardrails

Every on-screen claim is verified against the tree as of 2026-09-23. Do not add
any that are not:

- `verified 29   local 3   partial 5   open 1   blocked 9   (of 47)` and `NOT LAUNCHABLE.` — exact live output of
  `node scripts/verify-gates.mjs`.
- `312` files — `TOTAL_FILES` in `S04UploadDemo.tsx`.
- Gate ids P7.2, P4.4, P5.3, P14.4 and their statuses — exact from the same output.
- All English and Arabic copy — verbatim from `apps/web/lib/site/copy.ts`.
- The imagery is the Shepp-Logan phantom, provably synthetic per
  `apps/web/public/seq/hero/SOURCE.md` — no patient data.

**Must not appear:** any suggestion that MIR is live, accepting patients, or
diagnostic; the in-app viewer is reference-only by design and the product is
pre-launch by choice. No invented metrics, no fake testimonials, no "trusted by",
no logos of organisations.
