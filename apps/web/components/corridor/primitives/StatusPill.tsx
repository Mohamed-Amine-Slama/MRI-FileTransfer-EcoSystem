import { ENTITY } from '../../../lib/site/entity';

/**
 * The live status pill — Landing-Page-Specs §Scene 01.
 *
 * "Status pill bottom-inline-start: a live accent dot and 'System
 * operational', linked to your real status page. Doctors check this. It is
 * trust, not decoration."
 *
 * Which is why it is not a decoration here either. When
 * `NEXT_PUBLIC_SITE_STATUS_URL` is unset the pill renders as plain text rather
 * than as a link to nowhere, and it says "System status" rather than "System
 * operational" — because an uptime claim with nothing behind it is exactly the
 * kind of thing §1.4 exists to stop, and a doctor who clicks a status link and
 * gets a 404 has learned something worse than nothing.
 *
 * The dot's pulse is a CSS keyframe, so it stops under `prefers-reduced-motion`
 * with everything else and costs no JavaScript at all.
 */
export function StatusPill({
  operationalLabel,
  unknownLabel,
}: {
  operationalLabel: string;
  unknownLabel: string;
}): React.JSX.Element {
  const href = ENTITY.statusUrl;

  const inner = (
    <>
      <span className="pill-dot" aria-hidden="true" />
      {href === null ? unknownLabel : operationalLabel}
    </>
  );

  if (href === null) {
    return <span className="pill">{inner}</span>;
  }

  return (
    <a
      className="pill"
      href={href}
      /*
       * The status page is a different property with a different failure mode
       * — it is deliberately hosted away from the app so it stays up when the
       * app does not. `noreferrer` because §11 forbids leaking anything about
       * who is reading this page to a third party.
       */
      target="_blank"
      rel="noreferrer"
    >
      {inner}
    </a>
  );
}
