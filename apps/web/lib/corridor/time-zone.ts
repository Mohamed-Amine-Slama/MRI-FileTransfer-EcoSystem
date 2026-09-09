/**
 * A representative IANA time zone for a country, from its ISO-3166 code.
 *
 * §Scene 07 wants two clocks — the referring side's and the receiving side's —
 * "because that detail proves you have thought about the actual problem". It
 * is a real problem: the two ends of this corridor are an hour apart for part
 * of the year, and an appointment time sent in a message without a zone is how
 * a patient arrives on the wrong side of lunch after crossing a border.
 *
 * WHY THIS LIVES BESIDE `country-name.ts` AND NOT IN THE DICTIONARY. Same
 * reason: §4.3 forbids UI copy that assumes a corridor, and the ratcheting
 * test in this directory enforces it over `app/` and `components/`. The
 * corridor registry supplies the code, this supplies the zone, and a scene
 * renders two clocks without knowing which countries it is showing.
 *
 * `Intl.DisplayNames` already knows every country's NAME, but there is no
 * equivalent standard mapping from country to zone in the platform — the CLDR
 * data exists but browsers do not expose it — so this table is unavoidable. It
 * is a table of ZONES, not of copy: adding a corridor adds one line here and
 * changes no user-visible string.
 *
 * Countries that span several zones are represented by the zone of the
 * populated region a corridor would actually run to. Where that is ambiguous
 * for a future corridor, the honest fix is to move the zone into the corridor
 * registry entry rather than to guess here.
 */

const ZONES: Record<string, string> = {
  DZ: 'Africa/Algiers',
  EG: 'Africa/Cairo',
  FR: 'Europe/Paris',
  IT: 'Europe/Rome',
  LY: 'Africa/Tripoli',
  MA: 'Africa/Casablanca',
  MT: 'Europe/Malta',
  TN: 'Africa/Tunis',
  TR: 'Europe/Istanbul',
};

/**
 * Falls back to UTC, which is wrong but honest — a clock labelled with a zone
 * the reader can check beats a clock silently showing the wrong hour.
 */
export function countryTimeZone(code: string): string {
  return ZONES[code.toUpperCase()] ?? 'UTC';
}

/** The current time in a country, formatted for the reader's locale. */
export function timeInCountry(code: string, locale: string, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: countryTimeZone(code),
    }).format(at);
  } catch {
    return '--:--';
  }
}
