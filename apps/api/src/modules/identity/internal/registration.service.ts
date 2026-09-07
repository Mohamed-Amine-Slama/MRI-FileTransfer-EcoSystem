import { randomInt, randomUUID, createHash } from 'node:crypto';
import { Inject, Injectable, Logger, NotImplementedException } from '@nestjs/common';
import {
  VERIFICATION_CODE_TTL_MINUTES,
  type RegistrationInput,
} from '@mir/contracts';
import type { RequestContext } from '../../../shared/context/request-context';
import { DatabaseService } from '../../../shared/db/database.service';
import { MAIL_SENDER, type MailSender } from '../../../shared/mail';
import { KeycloakAdminClient, KeycloakAdminUnauthorizedError } from './keycloak-admin.client';

/**
 * Self-service registration — brief §5.1.
 *
 * THE ORDER OF OPERATIONS IS THE DESIGN.
 *
 *   1. Keycloak user, created DISABLED. Credentials never touch this service.
 *   2. `identity_register_account`, which can only ever produce an `applicant`.
 *   3. A six-digit code, hashed into the database and sent in plaintext to the
 *      address — and to nowhere else.
 *
 * Step 3 failing does NOT roll back steps 1 and 2. An account whose code did
 * not arrive is recoverable by resending; an account rolled back after its
 * Keycloak user was created leaves an orphan that blocks the address forever.
 *
 * EVERY ANSWER IS THE SAME. Registered, already-registered, and unknown all
 * produce the identical response, because a form that says "that address is
 * taken" is an enumeration oracle for which clinicians have accounts here —
 * the same reasoning that shapes /reset-password and the patient claim screen.
 */

/**
 * The RLS identity for an unauthenticated caller.
 *
 * `applicant` is chosen precisely because it is granted NOTHING: no policy in
 * this schema names it, so every table this transaction touches returns zero
 * rows and every write is refused. Only the explicitly-granted SECURITY DEFINER
 * functions do anything, and each of those enforces its own rule.
 *
 * The alternative — the `admin` context the billing webhook uses — would give a
 * public, unauthenticated endpoint the run of the identity tables to accomplish
 * a job that needs three functions.
 */
function anonymousContext(): RequestContext {
  return {
    // A nil-ish sentinel, matching the shape billing's systemContext uses.
    // NULLIF makes app_current_user_id() resolve it normally; nothing keys on it.
    userId: '00000000-0000-7000-8000-000000000000',
    role: 'applicant',
    ipAddress: undefined,
    userAgent: 'self-registration',
    requestId: randomUUID(),
  };
}

/** SHA-256, the same digest the claim-token flow uses. */
function hash(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/**
 * Six digits from a CSPRNG.
 *
 * `randomInt` and not `Math.random()`: this is the second factor on an account
 * that will hold access to patient imaging, and a predictable code is not a
 * second factor at all. The range is inclusive-exclusive, so 1_000_000 yields
 * 000000..999999 — leading zeros included, which `padStart` preserves.
 */
function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

@Injectable()
export class RegistrationService {
  private readonly logger = new Logger('Registration');

  constructor(
    private readonly db: DatabaseService,
    private readonly keycloak: KeycloakAdminClient,
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
  ) {}

  async register(input: RegistrationInput): Promise<void> {
    if (!this.keycloak.isConfigured()) {
      // 501, not 500: the deployment has not been given the credential this
      // needs. Answering "internal error" would send someone hunting for a bug.
      throw new NotImplementedException('self_registration_not_configured');
    }

    const email = input.email.trim().toLowerCase();

    let sub: string | null;
    try {
      sub = await this.keycloak.createUser({
        email,
        fullName: input.fullName,
        password: input.password,
      });
    } catch (err) {
      if (err instanceof KeycloakAdminUnauthorizedError) {
        // Credential present but refused — indistinguishable, from the person
        // signing up, from it never having been configured. Same 501, and the
        // client's own log line records which it was.
        this.logger.error(err.message);
        throw new NotImplementedException('self_registration_not_configured');
      }
      throw err;
    }
    // Address already taken upstream. Silence is the answer; see the note above.
    if (sub === null) return;

    /*
     * THE ROLE IS PART OF CREATING THE ACCOUNT, NOT OF APPROVING IT.
     *
     * The auth guard reads the role from the TOKEN, and Keycloak only puts one
     * there if the user holds it as a realm role. Without this the account
     * authenticates successfully and resolves to no role at all — every request
     * 401s, /verification included, which is the one screen an applicant is
     * supposed to be able to reach. The 'applicant' in the database row is a
     * different fact and does not reach the token.
     *
     * `applicant` is not a grant of anything: no RLS policy in this schema
     * names it. The clinical role still arrives only from the verification
     * decision, which is the other caller of assignRealmRole.
     *
     * Before the row is written, so the existing rollback covers a failure
     * here. Left alone, it would leave an account that can never sign in.
     */
    try {
      await this.keycloak.assignRealmRole(sub, 'applicant');
    } catch (err) {
      await this.keycloak.deleteUserQuietly(sub);
      throw err;
    }

    let userId: string | null;
    try {
      userId = await this.db.txAs(anonymousContext(), async (tx) => {
        const created = await tx.query<{ identity_register_account: string | null }>(
          'SELECT identity_register_account($1, $2, $3, $4, $5)',
          [sub, email, input.fullName, input.phoneE164, input.locale],
        );
        return created.rows[0]?.identity_register_account ?? null;
      });
    } catch (err) {
      // The Keycloak user exists but ours does not, so the address would be
      // permanently unusable. Remove it and let the caller retry.
      await this.keycloak.deleteUserQuietly(sub);
      throw err;
    }

    if (userId === null) {
      // Taken on our side (the phone number, most likely — the address was
      // free upstream). Same silence, and the orphan is cleaned up.
      await this.keycloak.deleteUserQuietly(sub);
      return;
    }

    await this.issueCode(email, input.locale);
  }

  /**
   * Issue and send a code. Used by registration and by resend.
   *
   * A send failure is logged, not raised: the row is already written, the user
   * can ask again, and turning a mail outage into a 500 on the registration
   * endpoint would make the whole flow look broken when only its last step is.
   */
  async issueCode(email: string, locale: string): Promise<void> {
    const code = generateCode();

    const issued = await this.db.txAs(anonymousContext(), async (tx) => {
      const res = await tx.query<{ identity_issue_email_code: boolean }>(
        'SELECT identity_issue_email_code($1, $2, $3)',
        [email.toLowerCase(), hash(code), VERIFICATION_CODE_TTL_MINUTES],
      );
      return res.rows[0]?.identity_issue_email_code === true;
    });

    // No live pending account for that address. The endpoint still answers
    // exactly as it would have — this is the branch that keeps resend from
    // becoming a way to test whether an address is registered.
    if (!issued) return;

    try {
      await this.mail.send({
        kind: 'email_verification',
        to: email,
        code,
        expiresInMinutes: VERIFICATION_CODE_TTL_MINUTES,
        locale,
      });
    } catch (err) {
      this.logger.error(`verification mail failed for a pending account: ${String(err)}`);
    }
  }

  /**
   * Redeem a code.
   *
   * Returns whether it worked, and nothing else. Wrong, expired, already used,
   * and too-many-attempts are indistinguishable to the caller by construction —
   * `identity_verify_email` returns NULL for all four.
   */
  async verify(email: string, code: string): Promise<boolean> {
    // Returns the subject alongside the id, because a follow-up lookup here
    // would run under the anonymous context and match no row (`users_self`
    // keys on app_current_user_id()). See the note on the function.
    const row = await this.db.txAs(anonymousContext(), async (tx) => {
      const res = await tx.query<{ user_id: string; keycloak_sub: string }>(
        'SELECT user_id, keycloak_sub FROM identity_verify_email($1, $2)',
        [email.trim().toLowerCase(), hash(code)],
      );
      return res.rows[0] ?? null;
    });

    if (row === null) return false;

    // The database has activated its row; Keycloak must now let the account
    // sign in. A failure here leaves the user verified on one side and
    // disabled on the other, so it is RAISED rather than logged — a support
    // case that announces itself beats one discovered by the user.
    if (this.keycloak.isConfigured()) {
      await this.keycloak.activate(row.keycloak_sub);
    }
    return true;
  }
}
