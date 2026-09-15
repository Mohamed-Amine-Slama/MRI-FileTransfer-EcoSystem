/**
 * MIR's mark — the reticle this page has always carried: a ring and four
 * ticks, never a full crosshair. Drawn in currentColor, so it sits lime on
 * teal inside `.logo-tile`.
 */
export function MirMark({ className = '' }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={`mir-mark ${className}`.trim()} aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="5.5" />
      <path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" />
    </svg>
  );
}
