# Brag Plan: MIR

## What is this app?

A cross-border medical imaging transfer platform that moves a patient's MRI/CT
study from a referring clinic in Libya to a receiving specialist in Tunisia —
original DICOM bytes, named-doctor consent, appointment booked before the
patient travels. What makes it remarkable is not the feature list: it is that
the repository ships a script that prints **NOT LAUNCHABLE** and a README that
leads with the warning.

## The angle

**The engineering is finished. It still refuses to launch.**

Most launch videos end with a CTA. This one ends with a gate report. The video
plays the product completely straight for fifteen seconds — the promise, the
upload surviving a severed connection, consent closing access on a click — and
then turns and shows the thing the team built to tell them *no*: 47 gates, 29
verified, 8 unanswered legal questions, and a refusal to touch a real patient
until they are answered.

The brag is the discipline. The last line is the proof that the first fifteen
seconds are honest.

This is specific to MIR and could not be reused: the gate output, the 312-file
upload, the "Cut the connection" button and the Arabic/RTL mirror are all real
artifacts of this repository.

## Hook (first 2-3 seconds)

The site's own headline, set light and large on the clinical white ground, with
the synthetic phantom slice sequence scrubbing beside it:

> **Their scan arrives before they do.**

No logo card first, no "introducing." The sentence is the hook — it states the
entire product in six words, and the scan moving next to it says what kind of
product it is before a single feature appears.

## Key moments (the middle)

- **The headline mirrors into Arabic and the whole layout flips RTL.** Not a
  language toggle graphic — the actual mirror, with the locale chips `ar · fr · en`.
- **The upload demo, which the codebase itself calls "THE ARGUMENT."** 312 files
  climbing, a cursor presses **Cut the connection**, the bar *freezes* mid-fill,
  a retry counter ticks, and the fill resumes from the exact same pixel:
  "Resumed exactly where it stopped. Nothing re-sent."
- **Consent revoked in one click.** The cursor presses Revoke and the study
  thumbnails go locked and grey in the same frame.
- **The turn:** a terminal, `pnpm verify:gates`, gate lines scrolling OK / OK /
  OK / **BLKD**, and then `NOT LAUNCHABLE.` in the alert red — with the music
  gone.

## Outro / punchline

The gate script's own closing line, which is also the bragging right:

> **The blockers are legal and infrastructural, not code.**

MIR's reticle mark beneath it on white. Silence.

## User flow worth showing

Three beats, all from the working product, all recreated from real source:

1. **Entry** — a study uploads from the referring clinic (`S04UploadDemo.tsx`,
   312 files, 3 files per 120ms tick).
2. **Key action** — the connection is deliberately severed mid-upload and the
   transfer survives it (the `uploadCut` / `uploadResumedLine` states).
3. **Result** — transfer completes, checksum matches; then consent is revoked
   and access closes immediately (`S05Consent.tsx`).

The centerpiece scenes (3 and 4) are this flow. The hook and the close frame it.

## Tone

- **Preset:** `polished`, with a deadpan spine on the final turn.
- **Creative direction:** a quiet clinical product film that ends by refusing to launch.
- **Interpretation:** Restraint is the whole register. Light weights, generous
  space, slow crossfades, no zoom-punches, no exclamation. The product is a
  medical instrument and the video should feel like one. The single permitted
  hard moment is `NOT LAUNCHABLE`, and it lands *by subtraction* — the music
  stops rather than swells. Nothing is played for a laugh; the surprise comes
  from a serious product saying something no launch video says.

## Format: landscape — 1920x1080
## Duration: 24.0s target

## Visual identity (from the project)

Pulled from `apps/web/app/corridor.css` `:root`:

- **Background (ground):** `#ffffff`
- **Panel:** `#eff4f2` · **Panel deep:** `#e5f1ed`
- **Accent:** `#246f65` (deep teal) · **Accent deep:** `#054038`
- **Lime highlight:** `#f8ffb4` · **Lime edge:** `#e5ed9b`
- **Text:** `#000000` · subtle `rgb(0 0 0 / 0.62)` · muted `rgb(0 0 0 / 0.45)`
- **Alert:** `#b3261e` (reserved — used exactly once, on `NOT LAUNCHABLE`)
- **Hairline:** `rgb(0 0 0 / 0.1)`
- **Display font:** Google Sans Flex, weight 300 (Latin) / IBM Plex Sans Arabic Light 300 (Arabic)
- **Body font:** Google Sans Flex 300
- **Data font:** IBM Plex Mono 400 — all readouts, gate lines, file counts
- **Radii:** cards 24px, sections 48px, chips 37px, tiles 8px
- **Strongest visual elements:**
  1. The synthetic Shepp-Logan phantom slice sequence (`public/seq/hero/b/0001-0024.avif`) — provably synthetic, no patient data.
  2. The particle double helix (`public/helix/poster-ltr.avif`, smoky green on white, has an alpha layer).
  3. The MIR reticle mark — a ring with four ticks, never a full crosshair, lime on teal.

**Light ground is non-negotiable.** This platform is deliberately not a dark-mode
tech product, and defaulting the video to dark would erase its identity.

## Share copy (draft)

> Built a cross-border medical imaging platform: uploads that survive a severed
> connection, consent that revokes in one click, authorization enforced twice.
> Then built the script that tells me it's still NOT LAUNCHABLE — 8 legal
> questions open. The blockers are legal and infrastructural, not code.

## Audio direction

- **Role:** Sparse professional bed with motion-matched accents, then deliberate silence.
- **Music:** `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` — the calmest
  of the five bundled tracks (109.96 BPM, 117s). **It must be treated, not used
  raw:** the bundled library is bright corporate pop and this is a medical
  product. Low gain, low-pass/darkened so it reads as warm room tone under the
  scenes rather than as a pop bed.
- **Music treatment:** in from 0s under a slow fade (~0.8s), held low through the
  hook, a barely-perceptible lift entering the upload scene, then a **hard duck
  to silence** on the `NOT LAUNCHABLE` frame. It does not come back. The close
  plays on silence with at most one soft resolving low tone.
- **Music cue guidance:** preset read from
  `assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.md`.
  Tempo 109.96 BPM. Beat grid in-window: 6.00, 6.56, 7.09, 7.64, 8.19, 8.74,
  9.29, 9.83, 10.37, 10.93, 11.46, 12.02, 12.55, 13.11, 13.64. Strong cues to
  target: **8.74s** (0.99) for the *Cut the connection* press, **10.93s** (0.97)
  for the resume, **13.11s** (0.98) for the Revoke press. These are polish, not
  requirements — story timing wins any conflict, and because the bed is ducked
  and filtered the sync should be felt rather than heard. No beat-synced text.
- **Audio-reactive treatment:** subtle, and only in scenes 1 and 6 — let the
  helix glow and the scan tile's presence breathe with music RMS. Nothing
  reactive in the clinical scenes (3, 4, 5); a progress bar that pulses with
  music would undercut the claim that it is showing real behaviour. No waveform
  or equalizer graphics anywhere.
- **SFX posture:** sparse and strictly motion-matched. Roughly six cues in the
  whole video. Every one corresponds to something actually moving on screen.
- **Audio-coupled moments:**
  - locale chips `ar · fr · en` arriving one by one (scene 2)
  - the cursor pressing **Cut the connection** (scene 3) — one dry click
  - the connection dropping (scene 3) — a low *subtractive* thud, nothing explosive
  - checksum matched (scene 3) — one soft confirm tone
  - the cursor pressing **Revoke** (scene 4) — one dry click, then a muted lock
  - `$ pnpm verify:gates` typing (scene 5) — light randomized keypresses, quiet
- **Restraint rule:** No swells, no risers, no impact-boom on `NOT LAUNCHABLE` —
  the silence is the hit, and adding a stinger would turn a serious statement
  into a trailer beat. The bright top end of the bundled track must never be
  audible over the consent or gate scenes. Nothing may make this product sound
  triumphant about being unfinished.

## Storyboard

### Scene 1 — The promise — 4.0s

White ground. MIR reticle mark small in the corner on its teal tile. Left: eyebrow
`Cross-border medical imaging transfer` in Plex Mono teal, small; beneath it the
headline **Their scan arrives before they do.** in Google Sans Flex 300 at display
scale, revealed word by word with the site's own blur-in feel. Right: a rounded
dark tile holding the phantom slice sequence, scrubbing through the 24 frames so
the scan reads as volume, not a still. Helix drifts faintly behind at low opacity.

Headline settles by ~1.6s and **holds fully visible ~2.2s** (6 words).

Sequential/interaction: yes — headline reveals word by word (~0.12s apart, all six
landed within 0.8s, then the full line holds); slice sequence scrubs continuously.
Audio intent: calm arrival. A room being entered, not a product being launched.
Audio-coupled idea: none needed; music fades in under it. Optional single soft tick on the eyebrow.
Music: treated bed, low, from 0s.
Transition mood: soft crossfade (0.6s) → Scene 2

### Scene 2 — The same sentence, mirrored — 2.5s

The layout **mirrors**: the scan tile slides to the left, the text block to the
right, and the headline becomes **الصورة تصل قبل المريض.** set in IBM Plex Sans
Arabic Light. Direction flips to RTL for real — this is the product's actual
behaviour, not an effect. Locale chips `ar · fr · en` arrive beneath, `ar` marked
active. Small mono caption, muted: `RTL from day one`.

Arabic line holds ~1.4s.

Sequential/interaction: yes — three locale chips arrive one by one, ~0.18s apart,
then the set holds together for the rest of the scene.
Audio intent: a quiet click of recognition — the same thought in another script.
Audio-coupled idea: one very soft interface tick per chip arrival, decreasing in level.
Music: same bed, unchanged.
Transition mood: soft crossfade (0.6s) → Scene 3

### Scene 3 — Try to break it — 6.0s  ← centerpiece

A single DemoCard, centred, on the pale panel. Title line: **Try to break it.**
Inside: `Files 0 / 312`, a rate readout in mono, and a progress bar in accent teal
on a lime-edged track. The bar climbs.

A cursor enters and presses the button labelled **Cut the connection**. The state
chip flips from `Uploading` to `Connection cut`, the bar **freezes mid-fill** — it
must visibly stop, not reset — the rate drops to `—`, and `Retrying in 3s` counts
down in mono. Then the fill resumes *from the identical position* and the line
lands:

> **Resumed exactly where it stopped. Nothing re-sent.**

Bar completes to 312 / 312, chip goes `Complete`, and a final muted mono line:
`Transfer complete. The study's checksum matched.`

Beat budget: card in 0.5s · "Try to break it." holds 0.9s · press at ~2.2s ·
frozen + counting 1.1s · resume line lands ~4.0s and **holds 1.5s** · complete
+ checksum line 0.9s.

Sequential/interaction: yes — simulate the cursor moving to and pressing
"Cut the connection". The freeze-and-resume of the bar is the single most
important piece of motion in the video; the bar must not restart.
Audio intent: confidence under pressure. The cut should feel like something being
taken away, and the resume like it was never in doubt.
Audio-coupled idea: dry click on the press; low subtractive thud as the connection
drops (and the bed dips with it); soft confirm tone on checksum matched.
Music: bed lifts almost imperceptibly on entry, dips on the cut, recovers on the resume.
Transition mood: soft crossfade (0.6s) → Scene 4

### Scene 4 — Consent is a record — 4.0s

Consent card on the deeper panel. Headline **Consent is a record, not a checkbox.**
holds ~1.8s. Below it, mono metadata in the site's own register: `Granted to —
Receiving doctor`, a timestamp, and a row of three study thumbnails (phantom
slices) tinted live. A small Revoke control sits at the edge.

Cursor presses **Revoke**. In the same frame the thumbnails desaturate and take a
locked state, and one quiet line replaces the metadata:

> `Consent revoked. The study is no longer reachable.`

Sequential/interaction: yes — simulate the cursor pressing Revoke; the three
thumbnails lock in a fast 0.12s stagger, left to right.
Audio intent: finality without drama. A door closing quietly, at the patient's choosing.
Audio-coupled idea: dry click on Revoke, then one muted low lock tone under the stagger.
Music: bed steps down a level here and does not recover.
Transition mood: hard cut (0.15s) → Scene 5 — the only hard cut in the video

### Scene 5 — The turn — 4.5s

Full-bleed deep panel (`#054038`-family, the darkest surface the site owns).
Everything in IBM Plex Mono. A prompt types:

```
$ pnpm verify:gates
```

Gate lines print rapidly — these are scannable accents, not sentences, so ~0.22s
apart is correct:

```
OK    P7.2   Interrupted upload resumes
OK    P4.4   Audit immutable under tamper
OK    P5.3   Consent evidence + revocation
BLKD  P14.4  Pen test, high/critical remediated
```

`OK` in lime/teal, `BLKD` in alert red. Then the summary line:

```
verified 29   local 3   partial 5   open 1   blocked 9   (of 47)
```

and, after a held half-beat of nothing, **`NOT LAUNCHABLE.`** in `#b3261e`,
holding **1.4s** with the music already gone.

Sequential/interaction: yes — the command types character by character; the four
gate lines print one by one; the verdict lands alone after a deliberate pause.
Audio intent: the sound of a machine telling its authors no. Then nothing.
Audio-coupled idea: quiet randomized keypresses under the typed command only.
The gate lines get at most a faint tick each. **`NOT LAUNCHABLE` gets no SFX** —
the music cutting out is the event.
Music: hard duck to silence exactly as the verdict lands. Does not return.
Transition mood: slow crossfade (0.8s) → Scene 6

### Scene 6 — The close — 3.0s

Back to white. Enormous empty space. Helix drifting faintly at the edge, barely
present. One line, centred, Google Sans Flex 300:

> **The blockers are legal and infrastructural, not code.**

Holds ~2.4s (8 words). Beneath it, small: the MIR reticle mark and the wordmark, and in
muted mono, one line: `29 of 47 gates verified. 8 legal questions open.`

Sequential/interaction: none — stillness is the point.
Audio intent: silence, honoured. At most one soft low resolving tone as the mark appears.
Audio-coupled idea: none.
Music: none. Silence through to black.
Transition mood: fade to white/out

---

**Scene durations:** 4.2 + 2.5 + 6.0 + 4.0 + 4.5 + 2.5 = **24.0s** ✓ (within 15–25)

**Music mood for this video:** restrained/clinical — a bright corporate bed
deliberately darkened and ducked, ending in silence.

**Audio summary:** A low treated bed carries the promise and the proof, dips when
the connection is cut and steps down when consent is revoked, then cuts out
completely for the verdict — so the last four seconds of the video are the only
ones with nothing playing, and the final claim is delivered in silence.

## Factual guardrails (checked against the repo, 2026-09-23)

Every claim on screen is verified. Do not add any that are not:

- `verified 29   local 3   partial 5   open 1   blocked 9   (of 47)` and `NOT LAUNCHABLE` — exact output of
  `node scripts/verify-gates.mjs` on this tree.
- `312` files — `TOTAL_FILES` in `S04UploadDemo.tsx`.
- Gate ids P7.2, P4.4, P5.3, P14.4 and their statuses — exact from the same output.
- All English copy lines — verbatim from `apps/web/lib/site/copy.ts`.
- The Arabic headline `الصورة تصل قبل المريض.` — verbatim `ar.heroHeadline`.
- The imagery is the Shepp-Logan phantom, provably synthetic
  (`public/seq/hero/SOURCE.md`) — no patient data, which is why it is safe to show.

**Must not appear:** any suggestion that MIR is live, accepting patients, or
diagnostic. The viewer is reference-only by design, and the product is
pre-launch by choice. No invented metrics, no fake testimonials, no "trusted by."
