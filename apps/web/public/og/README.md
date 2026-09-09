# Open Graph cards

Generated — do not edit by hand:

    node apps/web/scripts/render-og.mjs

One card per locale, rendered in Chromium so Arabic is SHAPED correctly.
Satori (which `next/og` uses) has no complex-text shaping and renders Arabic
as isolated letterforms; §10 of the landing page specification calls that
"a first impression you do not recover from", and it is the reason this
pipeline exists.

The background is the same synthetic phantom frame as the hero — see
`public/seq/hero/SOURCE.md`. No patient data of any kind.

⚠ §10 also asks for these to be checked in WhatsApp specifically, which is how
this product actually spreads. That check is a person with a phone, and it is
recorded as open in `docs/landing-page-status.md`.
