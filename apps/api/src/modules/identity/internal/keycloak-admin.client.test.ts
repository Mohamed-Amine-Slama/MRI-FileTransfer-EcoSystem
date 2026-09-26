import { afterEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../../shared/config/config.schema';
import { KeycloakAdminClient } from './keycloak-admin.client';

/**
 * The admin API is reached over a DIFFERENT address than the issuer.
 *
 * `KEYCLOAK_ISSUER_URL` is not a location, it is the string `iss` must equal —
 * in compose it says `localhost:8081`, the address a browser uses, which from
 * inside the API container resolves to the API container. Pointing the admin
 * calls at it makes every registration fail with a connection error. This is
 * the same split `KEYCLOAK_JWKS_URL` already exists to express.
 */
function config(overrides: Partial<AppConfig>): AppConfig {
  return {
    KEYCLOAK_ISSUER_URL: 'http://localhost:8081/realms/mir',
    KEYCLOAK_ADMIN_CLIENT_ID: 'mir-api-admin',
    KEYCLOAK_ADMIN_CLIENT_SECRET: 'secret',
    ...overrides,
  } as unknown as AppConfig;
}

/** Records every URL fetched, answering each call the client expects. */
function captureFetch(): { urls: string[]; restore: () => void } {
  const urls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string) => {
    urls.push(String(url));
    if (String(url).includes('/protocol/openid-connect/token')) {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: 'stub-token', expires_in: 300 }), {
          status: 200,
        }),
      );
    }
    return Promise.resolve(
      new Response(null, { status: 201, headers: { location: '/users/new-sub-id' } }),
    );
  }) as typeof fetch;
  return { urls, restore: () => { globalThis.fetch = original; } };
}

describe('KeycloakAdminClient host selection', () => {
  let restore: (() => void) | null = null;
  afterEach(() => {
    restore?.();
    restore = null;
  });

  it('uses KEYCLOAK_ADMIN_URL for both the token and the admin call when set', async () => {
    const cap = captureFetch();
    restore = cap.restore;

    const client = new KeycloakAdminClient(
      config({ KEYCLOAK_ADMIN_URL: 'http://keycloak:8080' } as Partial<AppConfig>),
    );
    await client.createUser({ email: 'a@example.test', fullName: 'A B', password: 'pw' });

    expect(cap.urls).toEqual([
      'http://keycloak:8080/realms/mir/protocol/openid-connect/token',
      'http://keycloak:8080/admin/realms/mir/users',
    ]);
  });

  it('falls back to the issuer host when KEYCLOAK_ADMIN_URL is unset', async () => {
    const cap = captureFetch();
    restore = cap.restore;

    const client = new KeycloakAdminClient(config({}));
    await client.createUser({ email: 'a@example.test', fullName: 'A B', password: 'pw' });

    expect(cap.urls).toEqual([
      'http://localhost:8081/realms/mir/protocol/openid-connect/token',
      'http://localhost:8081/admin/realms/mir/users',
    ]);
  });
});

/**
 * Promotion out of `applicant` — the token verifier requires EXACTLY one
 * application role, so a user who gains a clinical role while keeping
 * `applicant` is refused on every request (401) the moment they sign in.
 * Found by the plan-4 admin journey: every approved doctor was locked out.
 */
describe('KeycloakAdminClient.promote', () => {
  let restore: (() => void) | null = null;
  afterEach(() => {
    restore?.();
    restore = null;
  });

  it('attaches the new role and removes applicant', async () => {
    const calls: { method: string; url: string; body: unknown }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ method: init?.method ?? 'GET', url: u, body: u.includes('/role-mappings/') ? JSON.parse(String(init?.body)) : null });
      if (u.includes('/protocol/openid-connect/token')) {
        return Promise.resolve(new Response(JSON.stringify({ access_token: 't', expires_in: 300 }), { status: 200 }));
      }
      const name = decodeURIComponent(u.split('/roles/')[1] ?? '');
      if (name !== '') {
        return Promise.resolve(new Response(JSON.stringify({ id: `id-${name}`, name }), { status: 200 }));
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as typeof fetch;
    restore = () => {
      globalThis.fetch = original;
    };

    await new KeycloakAdminClient(config({})).promote('sub-1', 'tunisia_doctor');

    const mappings = calls.filter((c) => c.url.endsWith('/users/sub-1/role-mappings/realm'));
    expect(mappings).toEqual([
      expect.objectContaining({ method: 'POST', body: [{ id: 'id-tunisia_doctor', name: 'tunisia_doctor' }] }),
      expect.objectContaining({ method: 'DELETE', body: [{ id: 'id-applicant', name: 'applicant' }] }),
    ]);
  });
});
