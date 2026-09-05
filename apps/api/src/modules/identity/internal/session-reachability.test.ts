import { describe, expect, it } from 'vitest';
import { ROLES, type Role } from '@mir/contracts';
import { REQUIRES_ROLE_KEY } from '../../../shared/authz/access-metadata';
import { IdentityController } from './identity.controller';
import { ProfileController } from './profile.controller';

/**
 * EVERY ROLE THAT CAN AUTHENTICATE MUST BE ABLE TO RESOLVE ITS SESSION.
 *
 * `/auth/me` is what the web client calls on load to decide whether anyone is
 * signed in. A role missing from its `@RequiresRole` list gets a 403, which the
 * client reads as "nobody is signed in" — so the account obtains a valid token
 * and is shown the signed-out screen. It looks exactly like a broken password.
 *
 * This has now happened twice: once with `applicant` (recorded in that
 * controller's own comment) and once with `assistant`. Both times the role was
 * added to `ROLES`, the guard accepted its token, and the one endpoint that
 * turns a token into a session was overlooked. The boot-time route audit does
 * not catch it — the route HAS a declaration, it is just missing a role.
 *
 * So the invariant is asserted here instead: adding a role to `ROLES` fails
 * this test until the session endpoint admits it.
 */

const declaredRoles = (target: object, method: string): Role[] => {
  const handler = (target as Record<string, unknown>)[method] as object;
  return (Reflect.getMetadata(REQUIRES_ROLE_KEY, handler) as Role[] | undefined) ?? [];
};

describe('session reachability', () => {
  it('lets every role reach /auth/me', () => {
    const allowed = declaredRoles(IdentityController.prototype, 'me');
    const missing = ROLES.filter((r) => !allowed.includes(r));

    // If this fails, the fix is to add the role — not to shorten the list.
    // Reaching this endpoint grants no data: the response is the caller's own
    // row, which row-level security already restricts to themselves.
    expect(missing).toEqual([]);
  });

  /**
   * Same argument, one step further in. Theme, language and notification
   * preferences are settings every signed-in person has, and a role that cannot
   * read them lands on a settings screen full of failed requests.
   */
  it('lets every role read and write its own profile and preferences', () => {
    for (const method of ['get', 'update', 'preferences', 'setPreferences']) {
      const allowed = declaredRoles(ProfileController.prototype, method);
      // Named explicitly rather than discovered, so a renamed handler fails
      // loudly here instead of quietly checking nothing.
      expect({ method, declared: allowed.length > 0 }).toEqual({ method, declared: true });
      expect({ method, missing: ROLES.filter((r) => !allowed.includes(r)) }).toEqual({
        method,
        missing: [],
      });
    }
  });
});
