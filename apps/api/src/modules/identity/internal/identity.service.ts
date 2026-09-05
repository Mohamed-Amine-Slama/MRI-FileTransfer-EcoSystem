import { Injectable, NotFoundException } from '@nestjs/common';
import type { Role } from '@mir/contracts';
import { requireContext } from '../../../shared/context/request-context';
import { DatabaseService } from '../../../shared/db/database.service';

/**
 * Identity reads — BUILD_SPEC P4.
 *
 * This module does NOT authenticate anyone. Keycloak issues the token and the
 * AuthGuard verifies it (P4.1/P4.2); by the time anything here runs, the
 * caller's identity is already established and sitting in the request context.
 * What this provides is the application-side view of that caller: their
 * display name, and for a patient, whether their account has been linked to a
 * medical record yet.
 *
 * The role is taken from the VERIFIED TOKEN, not from the database row. The
 * token is what the guard and the RLS session context were built from, so
 * reporting anything else here would let the UI and the enforcement layers
 * disagree about who the user is.
 */

export interface CurrentUser {
  userId: string;
  role: Role;
  displayName: string;
  mfaEnrolled: boolean;
}

@Injectable()
export class IdentityService {
  constructor(private readonly db: DatabaseService) {}

  async currentUser(): Promise<CurrentUser> {
    const ctx = requireContext();

    return this.db.tx(async (tx) => {
      const users = await tx.query<{ id: string; full_name: string }>(
        `SELECT id, full_name FROM identity_users WHERE id = $1`,
        [ctx.userId],
      );
      const user = users.rows[0];
      if (user === undefined) {
        // A verified token for a user with no application row. This happens
        // when someone authenticates before being provisioned; it is not an
        // authentication failure, so it must not read as one.
        throw new NotFoundException('User record not found');
      }

      return {
        userId: user.id,
        role: ctx.role,
        displayName: user.full_name,
        // Every remaining role requires a second factor (SECOND_FACTOR_ROLES),
        // and the guard already refuses one whose token lacks the AMR claim
        // (P4.3) — so reaching this point means MFA was satisfied. Reported for
        // the UI's benefit, never relied on for access.
        //
        // This was `ctx.role !== 'patient'` while an unclaimed patient could
        // hold a session without one. There is no such role now, and a
        // conditional whose false branch is unreachable reads as a rule that
        // still has exceptions.
        mfaEnrolled: true,
      };
    });
  }
}
