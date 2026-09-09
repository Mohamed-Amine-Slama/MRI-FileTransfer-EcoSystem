/**
 * Typed public environment variables.
 *
 * WHY THIS FILE EXISTS.
 * `noPropertyAccessFromIndexSignature` rejects `process.env.FOO`, and the rest
 * of this app therefore uses `process.env['FOO']`. That is correct for
 * server-only variables, but NOT for NEXT_PUBLIC_ ones: Next inlines those into
 * the client bundle by textually substituting `process.env.NEXT_PUBLIC_X`, and
 * a bracket access is not substituted — the value would simply be undefined in
 * the browser, silently.
 *
 * Declaring the variable here makes it a real property rather than an index
 * signature hit, so dot access typechecks and the inlining still happens.
 */
declare namespace NodeJS {
  interface ProcessEnv {
    /** 'mock' serves fixtures. Anything else, including unset, means live. */
    readonly NEXT_PUBLIC_MIR_API_MODE?: 'mock' | 'live';

    /*
     * The landing page's legal and canonical facts — Landing-Page-Specs
     * §Scene 11 and §14, read in `lib/site/entity.ts`.
     *
     * All optional, and all UNSET by default on purpose. §1.4 forbids inventing
     * a registered name or address, so the footer omits what it does not have
     * and `launchBlockers()` reports it. A plausible placeholder here is a lie
     * that ships because it looked finished in review.
     */
    /** Registered company name, exactly as filed. */
    readonly NEXT_PUBLIC_SITE_ENTITY_NAME?: string;
    /** Registered address, one line. */
    readonly NEXT_PUBLIC_SITE_ENTITY_ADDRESS?: string;
    /** Data protection contact — a mailto: or an https: URL. */
    readonly NEXT_PUBLIC_SITE_DP_CONTACT?: string;
    /** The real status page the hero pill links to. */
    readonly NEXT_PUBLIC_SITE_STATUS_URL?: string;
    readonly NEXT_PUBLIC_SITE_TERMS_URL?: string;
    readonly NEXT_PUBLIC_SITE_PRIVACY_URL?: string;
    readonly NEXT_PUBLIC_SITE_CONSENT_URL?: string;
    /** Canonical origin, for hreflang alternates and OG URLs (§10). */
    readonly NEXT_PUBLIC_SITE_ORIGIN?: string;
  }
}
