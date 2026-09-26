import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG } from '../../../shared/config/config.module';
import type { AppConfig } from '../../../shared/config/config.schema';

/**
 * The narrow slice of Keycloak's admin API that self-service sign-up needs.
 *
 * ADR-2 / P4.1: this application owns no credential. Creating the account is
 * therefore an operation ON KEYCLOAK, not a row we write — the password never
 * exists on this side of the boundary even momentarily, and everything about
 * policy, lockout, and brute-force protection stays where it already is.
 *
 * WHY IT CAN BE UNCONFIGURED. A client that can create users and assign realm
 * roles is the most valuable secret this service could hold, and most
 * deployments provision accounts out of band and want it nowhere near the API's
 * environment. `isConfigured()` is false then, and registration answers 501 —
 * the same refusal the web app's password-login route gives for an
 * unconfigured token endpoint. It must never fall back to a local account.
 *
 * The service-account token is cached until shortly before it expires. Fetching
 * one per request would triple the round trips on a flow that already makes
 * three.
 */

interface TokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
}

/**
 * Keycloak REFUSED the service-account credential.
 *
 * Distinguished from every other failure because it means the same thing to a
 * caller as having no credential at all: sign-up cannot work here. Callers map
 * it to the same 501 as `isConfigured() === false`.
 *
 * `isConfigured()` only proves the variables are PRESENT. This is what happens
 * when they are present and wrong — the client was deleted, the secret rotated,
 * or (the usual one in development) Keycloak was recreated, which resets the
 * realm to `sslRequired: all` and makes it 403 every HTTP token request. That
 * arrived as a 500 and a generic "the operation failed", which is exactly the
 * bug-hunt the 501 in RegistrationService exists to prevent.
 */
export class KeycloakAdminUnauthorizedError extends Error {
  constructor(readonly status: number) {
    super(`Keycloak rejected the admin service-account credential (${status})`);
    this.name = 'KeycloakAdminUnauthorizedError';
  }
}

@Injectable()
export class KeycloakAdminClient {
  private readonly logger = new Logger('KeycloakAdmin');
  private cached: { token: string; expiresAt: number } | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  isConfigured(): boolean {
    return (
      this.config.KEYCLOAK_ADMIN_CLIENT_ID !== undefined &&
      this.config.KEYCLOAK_ADMIN_CLIENT_SECRET !== undefined
    );
  }

  /**
   * The realm name, taken from config or parsed out of the issuer.
   *
   * A Keycloak issuer is `<base>/realms/<realm>`, so the realm is already in
   * the value the token verifier validates against — deriving it means one less
   * variable to get inconsistent with the one that decides which tokens are
   * accepted.
   */
  private realm(): string {
    if (this.config.KEYCLOAK_REALM !== undefined) return this.config.KEYCLOAK_REALM;
    const match = /\/realms\/([^/]+)\/?$/.exec(this.config.KEYCLOAK_ISSUER_URL);
    return match?.[1] ?? 'mir';
  }

  /**
   * The host to send admin requests to.
   *
   * KEYCLOAK_ADMIN_URL when set, because the issuer is a value to COMPARE `iss`
   * against and not necessarily a route to Keycloak — under compose it names
   * `localhost`, which from in here is this process. Falls back to the issuer's
   * host, which is correct wherever the two names are the same.
   */
  private baseUrl(): string {
    const explicit = this.config.KEYCLOAK_ADMIN_URL;
    if (explicit !== undefined) return explicit.replace(/\/+$/, '');
    return this.config.KEYCLOAK_ISSUER_URL.replace(/\/realms\/[^/]+\/?$/, '');
  }

  private async token(): Promise<string> {
    const now = Date.now();
    if (this.cached !== null && this.cached.expiresAt > now) return this.cached.token;

    const clientId = this.config.KEYCLOAK_ADMIN_CLIENT_ID;
    const clientSecret = this.config.KEYCLOAK_ADMIN_CLIENT_SECRET;
    if (clientId === undefined || clientSecret === undefined) {
      throw new Error('Keycloak admin client is not configured');
    }

    const res = await fetch(
      `${this.baseUrl()}/realms/${this.realm()}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        }),
        // A hung identity provider must fail the request, not hold a
        // connection from the pool until something else times out.
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (res.status === 401 || res.status === 403) {
      // Present but rejected. Same practical answer as unconfigured, and the
      // status is kept so the log says which.
      throw new KeycloakAdminUnauthorizedError(res.status);
    }
    if (!res.ok) throw new Error(`Keycloak admin token request failed: ${res.status}`);
    const body = (await res.json()) as TokenResponse;
    if (typeof body.access_token !== 'string') {
      throw new Error('Keycloak admin token response had no access_token');
    }

    const lifetime = typeof body.expires_in === 'number' ? body.expires_in : 60;
    // Renew 30s early, so a token does not expire in flight between the check
    // and the request that uses it.
    this.cached = { token: body.access_token, expiresAt: now + (lifetime - 30) * 1000 };
    return body.access_token;
  }

  private async admin(path: string, init: RequestInit): Promise<Response> {
    const token = await this.token();
    return fetch(`${this.baseUrl()}/admin/realms/${this.realm()}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    });
  }

  /**
   * Create a disabled, unverified user and set their password.
   *
   * DISABLED ON PURPOSE. The account cannot sign in until the emailed code is
   * redeemed, so a registration against someone else's address does not hand
   * the registrant a working login while the real owner ignores the mail.
   *
   * Returns the Keycloak subject id, or null when the address is already
   * taken — the caller answers identically either way, so a 409 here would
   * become an oracle for which clinicians have accounts.
   */
  async createUser(input: {
    email: string;
    fullName: string;
    password: string;
  }): Promise<string | null> {
    const [firstName, ...rest] = input.fullName.trim().split(/\s+/);
    const res = await this.admin('/users', {
      method: 'POST',
      body: JSON.stringify({
        username: input.email.toLowerCase(),
        email: input.email.toLowerCase(),
        firstName: firstName ?? input.fullName,
        lastName: rest.join(' '),
        enabled: false,
        emailVerified: false,
        credentials: [{ type: 'password', value: input.password, temporary: false }],
      }),
    });

    if (res.status === 409) return null;
    if (!res.ok) throw new Error(`Keycloak user creation failed: ${res.status}`);

    // Keycloak returns the new id in Location, not in a body.
    const location = res.headers.get('location');
    const sub = location?.split('/').pop();
    if (sub === undefined || sub === '') {
      throw new Error('Keycloak user creation returned no id');
    }
    return sub;
  }

  /** Called once the emailed code is redeemed: the account becomes usable. */
  async activate(sub: string): Promise<void> {
    const res = await this.admin(`/users/${encodeURIComponent(sub)}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: true, emailVerified: true }),
    });
    if (!res.ok) throw new Error(`Keycloak activation failed: ${res.status}`);
  }

  /**
   * Grant a realm role.
   *
   * Two callers, and they grant very different things. Registration attaches
   * `applicant`, which no RLS policy names and which exists so a new account
   * authenticates as SOMETHING rather than as nothing. The verification
   * decision attaches the clinical role, and that is the moment an applicant
   * becomes a clinician in the eyes of the whole system — the database side of
   * that same transition is `identity_decide_verification`.
   */
  async assignRealmRole(sub: string, role: string): Promise<void> {
    await this.mapRealmRole(sub, role, 'POST');
  }

  /**
   * Out of `applicant` into a clinical role. The token verifier accepts
   * exactly one application role, so attaching the new one without removing
   * `applicant` locks the user out (401 on every call) until an operator
   * edits Keycloak by hand.
   *
   * Two calls, no transaction. Grant first: if the removal then fails, the
   * token verifier accepts applicant + the granted role as the granted role.
   * The reverse order would leave a user with no role at all.
   */
  async promote(sub: string, role: string): Promise<void> {
    await this.mapRealmRole(sub, role, 'POST');
    await this.mapRealmRole(sub, 'applicant', 'DELETE');
  }

  private async mapRealmRole(sub: string, role: string, method: 'POST' | 'DELETE'): Promise<void> {
    const lookup = await this.admin(`/roles/${encodeURIComponent(role)}`, { method: 'GET' });
    if (!lookup.ok) throw new Error(`Keycloak role lookup failed: ${lookup.status}`);
    const definition = (await lookup.json()) as { id?: unknown; name?: unknown };
    if (typeof definition.id !== 'string' || typeof definition.name !== 'string') {
      throw new Error('Keycloak role lookup returned an unexpected shape');
    }

    const res = await this.admin(`/users/${encodeURIComponent(sub)}/role-mappings/realm`, {
      method,
      body: JSON.stringify([{ id: definition.id, name: definition.name }]),
    });
    if (!res.ok) throw new Error(`Keycloak role ${method === 'POST' ? 'assignment' : 'removal'} failed: ${res.status}`);
  }

  /**
   * Best-effort cleanup for a registration that failed after the Keycloak user
   * was created. Logged and swallowed: the caller is already handling an error,
   * and a failure to tidy up must not replace the real one. What is left behind
   * is a disabled account that cannot sign in.
   */
  async deleteUserQuietly(sub: string): Promise<void> {
    try {
      await this.admin(`/users/${encodeURIComponent(sub)}`, { method: 'DELETE' });
    } catch (err) {
      this.logger.warn(`could not roll back Keycloak user: ${String(err)}`);
    }
  }
}
