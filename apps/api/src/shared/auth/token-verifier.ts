import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { Inject, Injectable } from '@nestjs/common';
import { isClinicalRole, roleSchema, type Role } from '@mir/contracts';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config.schema';

/**
 * JWT validation — BUILD_SPEC P4.2.
 *
 * Verifies signature, issuer, audience and expiry. All four, every time.
 *
 * Audience in particular: a Keycloak realm typically issues tokens for several
 * clients. A token minted for the web app's public client is a perfectly valid
 * signature from a trusted issuer — accepting it here would let any token from
 * anywhere in the realm act on the API.
 */

export interface VerifiedIdentity {
  userId: string;
  role: Role;
  /** True when the token shows a second factor was used (P4.3). */
  mfaSatisfied: boolean;
}

export class TokenVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenVerificationError';
  }
}

/** Keycloak puts realm roles under `realm_access.roles`. */
interface KeycloakClaims extends JWTPayload {
  realm_access?: { roles?: string[] };
  acr?: string;
  amr?: string[];
}

@Injectable()
export class TokenVerifier {
  private readonly jwks: JWTVerifyGetKey;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    // Remote key set with built-in caching and rotation handling. Keys are
    // fetched on first use and refreshed when an unknown `kid` appears, so key
    // rotation does not require a redeploy.
    this.jwks = createRemoteJWKSet(new URL(config.KEYCLOAK_JWKS_URL), {
      cooldownDuration: 30_000,
      cacheMaxAge: 600_000,
    });
  }

  async verify(token: string): Promise<VerifiedIdentity> {
    let payload: KeycloakClaims;
    try {
      const result = await jwtVerify(token, this.jwks, {
        issuer: this.config.KEYCLOAK_ISSUER_URL,
        audience: this.config.KEYCLOAK_AUDIENCE,
        // Expiry is checked by default. Keep the tolerance tight: a wide
        // clock skew allowance extends the useful life of a stolen token.
        clockTolerance: 5,
      });
      payload = result.payload as KeycloakClaims;
    } catch (err) {
      // Never surface the library's reason to the caller — "signature invalid"
      // versus "expired" versus "wrong audience" is a probing oracle. It is
      // logged server-side instead.
      throw new TokenVerificationError(
        `token rejected: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }

    return this.identityFrom(payload);
  }

  /** Extracted so tests can exercise claim handling without a live JWKS. */
  identityFrom(payload: KeycloakClaims): VerifiedIdentity {
    const sub = payload.sub;
    if (sub === undefined || sub === '') {
      throw new TokenVerificationError('token has no subject');
    }

    const realmRoles = payload.realm_access?.roles ?? [];
    let appRoles = realmRoles.filter((r): r is Role => roleSchema.safeParse(r).success);

    // Promotion out of `applicant` is two Keycloak calls with no transaction
    // (KeycloakAdminClient.promote). If the removal fails after the grant, the
    // token carries both. The grant is what an operator decided (the
    // corridor's role for that side) — honour it instead of locking the new
    // clinician out until someone edits Keycloak by hand. Promotion never
    // grants admin, so applicant + admin is still refused below.
    if (appRoles.length === 2 && appRoles.includes('applicant') && !appRoles.includes('admin')) {
      appRoles = appRoles.filter((r) => r !== 'applicant');
    }

    if (appRoles.length === 0) {
      throw new TokenVerificationError('token carries no recognised application role');
    }
    if (appRoles.length > 1) {
      // One identity, one role. Two roles on one token makes every "which
      // policy applies" question ambiguous, and ambiguity in an access
      // decision resolves toward whichever branch is checked first.
      throw new TokenVerificationError(
        `token carries multiple application roles (${appRoles.join(', ')}); exactly one is required`,
      );
    }

    const role = appRoles[0] as Role;

    return {
      userId: sub,
      role,
      mfaSatisfied: hasSecondFactor(payload),
    };
  }
}

/**
 * Did the authentication that produced this token involve a second factor?
 *
 * Keycloak signals this two ways depending on configuration:
 *   - `acr` (authentication context class reference) is raised to a configured
 *     level-of-assurance value when a step-up flow ran.
 *   - `amr` (authentication methods references) lists the methods used.
 *
 * Both are checked because relying on only one silently accepts single-factor
 * logins whenever the realm is configured the other way.
 */
function hasSecondFactor(payload: KeycloakClaims): boolean {
  const amr = payload.amr ?? [];
  const MFA_METHODS = ['otp', 'mfa', 'totp', 'hwk', 'sms'];
  if (amr.some((m) => MFA_METHODS.includes(m.toLowerCase()))) return true;

  // Keycloak's default step-up mapping uses "1" for password and higher
  // values for stronger assurance.
  const acr = payload.acr;
  if (acr !== undefined && acr !== '' && acr !== '0' && acr !== '1') return true;

  return false;
}

export { isClinicalRole };
