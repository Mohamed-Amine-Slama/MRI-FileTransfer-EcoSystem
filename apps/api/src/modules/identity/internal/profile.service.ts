import { Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_PREFERENCES,
  type UpdateProfileInput,
  type UserPreferences,
} from '@mir/contracts';
import { requireContext } from '../../../shared/context/request-context';
import { DatabaseService } from '../../../shared/db/database.service';

/**
 * The signed-in user's own record — brief §5.1 (profile) and §5.6 (preferences).
 *
 * Everything here is scoped by row-level security rather than by a WHERE clause
 * this service writes: `users_self` and `preferences_own_*` (migration 0009)
 * already restrict every statement to the caller's own row, so there is no
 * ownership filtering in the SQL below to get subtly wrong. The `id = $1` in
 * the UPDATE is for precision, not for authorisation.
 *
 * WHAT THE UPDATE CANNOT DO. Role, status, keycloak_sub, and email are refused
 * by a database trigger, not by the column list below. That distinction
 * matters: the column list is a statement of intent, and the trigger is what
 * makes it true even if this file is later edited carelessly (ADR-6 — an
 * application bug must not be sufficient).
 */

export interface ProfileRow {
  id: string;
  email: string | null;
  fullName: string;
  phoneE164: string;
  jobTitle: string | null;
  role: string;
  status: string;
  createdAt: string;
  /**
   * Whether this doctor is taking work. `null` for everyone who has no doctor
   * profile — a lab, an admin, an applicant — rather than `false`, which would
   * read as "switched off" for accounts the switch does not apply to.
   */
  acceptingCases: boolean | null;
}

@Injectable()
export class ProfileService {
  constructor(private readonly db: DatabaseService) {}

  async get(): Promise<ProfileRow> {
    const ctx = requireContext();
    return this.db.tx(async (tx) => {
      const res = await tx.query<{
        id: string;
        email: string | null;
        full_name: string;
        phone_e164: string;
        job_title: string | null;
        role: string;
        status: string;
        created_at: Date;
        accepting_cases: boolean | null;
      }>(
        // LEFT JOIN, and it reads the caller's OWN profile row — which
        // `doctor_profiles_self` (0002) is exactly the policy for. Nobody
        // else's availability is reachable from here.
        `SELECT u.id, u.email, u.full_name, u.phone_e164, u.job_title, u.role,
                u.status, u.created_at, dp.accepting_cases
           FROM identity_users u
           LEFT JOIN identity_doctor_profiles dp ON dp.user_id = u.id
          WHERE u.id = $1`,
        [ctx.userId],
      );
      const row = res.rows[0];
      if (row === undefined) throw new NotFoundException('User record not found');

      return {
        id: row.id,
        email: row.email,
        fullName: row.full_name,
        phoneE164: row.phone_e164,
        jobTitle: row.job_title,
        role: row.role,
        status: row.status,
        createdAt: row.created_at.toISOString(),
        acceptingCases: row.accepting_cases,
      };
    });
  }

  async update(input: UpdateProfileInput): Promise<ProfileRow> {
    const ctx = requireContext();
    await this.db.tx(async (tx) => {
      // COALESCE so an absent field leaves the stored value alone. A PATCH that
      // sent every column would let a screen rendering a stale profile
      // overwrite a change made from another device between load and save.
      await tx.query(
        `UPDATE identity_users
         SET full_name  = COALESCE($2, full_name),
             job_title  = COALESCE($3, job_title),
             phone_e164 = COALESCE($4, phone_e164)
         WHERE id = $1`,
        [ctx.userId, input.fullName ?? null, input.jobTitle ?? null, input.phoneE164 ?? null],
      );
    });
    return this.get();
  }

  async preferences(): Promise<UserPreferences> {
    const ctx = requireContext();
    return this.db.tx(async (tx) => {
      const res = await tx.query<{
        theme: string;
        locale: string;
        timezone: string;
        notify_email: boolean;
        notify_sms: boolean;
      }>(
        `SELECT theme, locale, timezone, notify_email, notify_sms
         FROM identity_user_preferences WHERE user_id = $1`,
        [ctx.userId],
      );
      const row = res.rows[0];
      // Accounts provisioned before migration 0009 have no preferences row.
      // The contract's defaults are returned rather than a 404: the absence of
      // a stored choice is not an error, and a settings screen that cannot load
      // is a worse answer than one showing the defaults it is about to write.
      if (row === undefined) return DEFAULT_PREFERENCES;

      return {
        theme: row.theme as UserPreferences['theme'],
        locale: row.locale as UserPreferences['locale'],
        timezone: row.timezone,
        notify: { email: row.notify_email, sms: row.notify_sms },
      };
    });
  }

  async setPreferences(next: UserPreferences): Promise<UserPreferences> {
    const ctx = requireContext();
    await this.db.tx(async (tx) => {
      // Upsert, because of the pre-0009 accounts above: the first save from a
      // settings screen is an INSERT for them and an UPDATE for everyone else,
      // and the screen should not have to know which.
      await tx.query(
        `INSERT INTO identity_user_preferences
           (user_id, theme, locale, timezone, notify_email, notify_sms, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (user_id) DO UPDATE
         SET theme = EXCLUDED.theme,
             locale = EXCLUDED.locale,
             timezone = EXCLUDED.timezone,
             notify_email = EXCLUDED.notify_email,
             notify_sms = EXCLUDED.notify_sms,
             updated_at = now()`,
        [
          ctx.userId,
          next.theme,
          next.locale,
          next.timezone,
          next.notify.email,
          next.notify.sms,
        ],
      );
    });
    return this.preferences();
  }
}
