/**
 * The three artefacts of §Scene 02, drawn rather than photographed.
 *
 * §Scene 02 asks for "one artefact, photographed or rendered as an object on
 * void": a CD-R in a paper sleeve with a handwritten name, a phone showing a
 * WhatsApp thread of photographed films, and a calendar page.
 *
 * These are rendered, and the reasons stack up:
 *
 *   - §7.3 bans stock photography outright, and a photograph of a disc with a
 *     handwritten name on it is a photograph that has to be STAGED, or it is a
 *     photograph of a real patient's disc. There is no third option, and the
 *     second one is unthinkable.
 *   - §7.2 budgets 55 KB each in AVIF. These are ~600 bytes of inline SVG with
 *     no request of their own.
 *   - They are drawn in `--c-line` hairlines, which is the same vocabulary as
 *     the plates that hold them, so the scene reads as one drawing rather than
 *     as three photographs pasted onto a design.
 *
 * All three are `aria-hidden`: the sentence beside each one carries the
 * meaning, and "an icon of a compact disc" is not information.
 */

const COMMON = {
  viewBox: '0 0 120 120',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.25,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
  className: 'artefact',
};

/** A disc, half out of a paper sleeve, with a hand-written line on the sleeve. */
export function ArtefactDisc(): React.JSX.Element {
  return (
    <svg {...COMMON}>
      {/* the sleeve */}
      <path d="M16 34h74v70H16z" />
      <path d="M16 34l37 26 37-26" opacity="0.5" />
      {/* the handwritten name, as an illegible scrawl — no name, real or invented */}
      <path
        d="M26 92c3-5 5 3 8-1s4 2 7-2 5 3 9-1"
        opacity="0.65"
        className="artefact-ink"
      />
      {/* the disc, emerging */}
      <circle cx="78" cy="46" r="28" />
      <circle cx="78" cy="46" r="9" />
      <circle cx="78" cy="46" r="2.5" />
      {/* the scratch that is the whole point of the sentence beside it */}
      <path d="M60 30l30 30" className="artefact-flaw" strokeWidth={1.75} />
    </svg>
  );
}

/** A phone showing a message thread whose attachments are photographs of film. */
export function ArtefactPhone(): React.JSX.Element {
  return (
    <svg {...COMMON}>
      <rect x="30" y="10" width="60" height="100" rx="8" />
      <path d="M52 17h16" opacity="0.6" />
      {/* two incoming bubbles, each holding a crooked rectangle: a photo of a film */}
      <rect x="37" y="30" width="30" height="22" rx="3" opacity="0.7" />
      <path d="M42 36l19 3-2 9-19-3z" className="artefact-flaw" />
      <rect x="53" y="58" width="30" height="22" rx="3" opacity="0.7" />
      <path d="M58 65l19-2 1 9-19 2z" className="artefact-flaw" />
      <path d="M37 90h34M37 97h22" opacity="0.45" />
    </svg>
  );
}

/** A month, with six weeks crossed out before the appointment. */
export function ArtefactCalendar(): React.JSX.Element {
  const rows = [0, 1, 2, 3, 4, 5];
  return (
    <svg {...COMMON}>
      <rect x="16" y="22" width="88" height="84" rx="4" />
      <path d="M16 40h88" />
      <path d="M38 14v14M82 14v14" />
      {rows.map((row) => (
        <path
          key={row}
          d={`M${24 + 0} ${50 + row * 10}h72`}
          opacity={row < 5 ? 0.28 : 0}
        />
      ))}
      {/* six weeks struck through, and the seventh line left clean */}
      {rows.slice(0, 5).map((row) => (
        <path
          key={`x${row}`}
          d={`M26 ${50 + row * 10}l68 0`}
          className="artefact-flaw"
          opacity="0.55"
        />
      ))}
      <circle cx="86" cy="100" r="4" className="artefact-mark" />
    </svg>
  );
}
