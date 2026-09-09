/**
 * The legal entity behind the site, and the links that must exist beside it —
 * Landing-Page-Specs §Scene 11 and §14.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS CONFIGURATION AND NOT COPY, AND WHY IT IS EMPTY
 *
 * §Scene 11: "The address is not optional — a health platform with no
 * verifiable legal entity reads as a scam to exactly the careful users you
 * most want."
 *
 * §1.4: no claim that has not actually been obtained, and no invented
 * anything. Those two together mean the footer must carry a real registered
 * name and a real address, and that this file must NOT contain a plausible
 * placeholder. A convincing fake address is worse than a blank one: a blank is
 * a gate somebody has to open before launch, and a fake is a lie that ships
 * because it looked finished in review.
 *
 * So the values come from the environment, they are unset here, and
 * §12 L0's gate ("Entity name and address confirmed") is enforced by
 * `launchBlockers()` rather than by somebody remembering.
 * ---------------------------------------------------------------------------
 *
 * Set these at build time — they are inlined into the static HTML, so a change
 * means a rebuild, not a restart:
 *
 *   NEXT_PUBLIC_SITE_ENTITY_NAME      registered company name, exactly as filed
 *   NEXT_PUBLIC_SITE_ENTITY_ADDRESS   registered address, one line
 *   NEXT_PUBLIC_SITE_DP_CONTACT       data protection contact (mailto: or URL)
 *   NEXT_PUBLIC_SITE_STATUS_URL       the real status page the hero pill links to
 *   NEXT_PUBLIC_SITE_TERMS_URL        terms of service
 *   NEXT_PUBLIC_SITE_PRIVACY_URL      privacy policy
 *   NEXT_PUBLIC_SITE_CONSENT_URL      consent policy
 *   NEXT_PUBLIC_SITE_ORIGIN           canonical origin, for hreflang and OG
 */

/** Trim, and treat an empty or whitespace-only value as absent. */
function value(raw: string | undefined): string | null {
  const trimmed = raw?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

export interface SiteEntity {
  name: string | null;
  address: string | null;
  dataProtectionContact: string | null;
  statusUrl: string | null;
  termsUrl: string | null;
  privacyUrl: string | null;
  consentPolicyUrl: string | null;
}

/*
 * Read once, at module load, from literal `process.env.X` member expressions.
 *
 * Next replaces each of these at BUILD time by textual substitution, so they
 * have to be written out in full — `process.env[name]` in a loop would survive
 * into the bundle as a runtime lookup against an object that does not exist in
 * the browser, and every value would silently be undefined.
 */
export const ENTITY: SiteEntity = {
  name: value(process.env.NEXT_PUBLIC_SITE_ENTITY_NAME),
  address: value(process.env.NEXT_PUBLIC_SITE_ENTITY_ADDRESS),
  dataProtectionContact: value(process.env.NEXT_PUBLIC_SITE_DP_CONTACT),
  statusUrl: value(process.env.NEXT_PUBLIC_SITE_STATUS_URL),
  termsUrl: value(process.env.NEXT_PUBLIC_SITE_TERMS_URL),
  privacyUrl: value(process.env.NEXT_PUBLIC_SITE_PRIVACY_URL),
  consentPolicyUrl: value(process.env.NEXT_PUBLIC_SITE_CONSENT_URL),
};

/**
 * The canonical origin, for `hreflang` alternates, canonical links and OG
 * images (§10).
 *
 * Falls back to a localhost origin so a development build produces valid
 * absolute URLs rather than `undefined/ar`. A production deploy that forgets
 * to set it is caught by `launchBlockers()`.
 */
export const SITE_ORIGIN =
  value(process.env.NEXT_PUBLIC_SITE_ORIGIN) ?? 'http://localhost:3001';

/**
 * What §14 requires before this page may go live, listed as machine-readable
 * facts rather than as a checklist in a document.
 *
 * Returns the ones that are NOT satisfied. An empty array means the entity
 * half of the launch checklist is met — it says nothing about the halves that
 * only a person can sign off, which `docs/landing-page-status.md` records.
 */
export function launchBlockers(entity: SiteEntity = ENTITY): string[] {
  const missing: string[] = [];

  if (entity.name === null) missing.push('NEXT_PUBLIC_SITE_ENTITY_NAME');
  if (entity.address === null) missing.push('NEXT_PUBLIC_SITE_ENTITY_ADDRESS');
  if (entity.dataProtectionContact === null) missing.push('NEXT_PUBLIC_SITE_DP_CONTACT');
  if (entity.termsUrl === null) missing.push('NEXT_PUBLIC_SITE_TERMS_URL');
  if (entity.privacyUrl === null) missing.push('NEXT_PUBLIC_SITE_PRIVACY_URL');
  if (entity.consentPolicyUrl === null) missing.push('NEXT_PUBLIC_SITE_CONSENT_URL');

  /*
   * The status URL is deliberately NOT a blocker. §Scene 01 wants the hero
   * pill linked to a real status page and doctors do check it — but a pill
   * that links nowhere is a small loss, whereas an unfilled legal entity is a
   * site that reads as a scam. The pill renders without a link when this is
   * unset, rather than pointing at a page that does not exist.
   */

  return missing;
}
