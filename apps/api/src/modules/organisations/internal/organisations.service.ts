import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  INVITATION_TTL_DAYS,
  corridorRoleFor,
  hasSeatAvailable,
  type EndpointSide,
  type SeatRole,
} from '@mir/contracts';
import { requireContext } from '../../../shared/context/request-context';
import { DatabaseService } from '../../../shared/db/database.service';
import { MAIL_SENDER, type MailSender } from '../../../shared/mail';
import { APP_CONFIG } from '../../../shared/config/config.module';
import type { AppConfig } from '../../../shared/config/config.schema';
import { KeycloakAdminClient } from '../../identity';

/**
 * Organisations, seats, and the verification decision — brief §3, §5.1, §5.5.
 *
 * WHERE THE AUTHORISATION ACTUALLY LIVES. Almost nothing in this file checks
 * who the caller is. Reads are scoped by the policies in migration 0010
 * (`app_member_of`, `app_owns_org`), and the two operations that cross a trust
 * boundary — creating an organisation and deciding a verification — are
 * SECURITY DEFINER functions that enforce their own rule. A guard written here
 * would be a third copy of a decision already made twice.
 *
 * THE ONE THING THIS SERVICE OWNS is the corridor mapping: which role an
 * approval grants. That is derived from the organisation's own corridor and
 * side via `corridorRoleFor`, never from the request, so ops approving an
 * application cannot choose what it grants.
 */

export interface OrganisationRow {
  id: string;
  kind: string;
  legalName: string;
  corridorId: string;
  side: EndpointSide;
  verification: {
    status: string;
    submittedAt: string;
    decidedAt?: string;
    reasonKey?: string;
  };
  seatCount: number;
}

/** A clinician an appointment can be routed to. */
export interface ClinicianRow {
  userId: string;
  displayName: string;
  role: string;
  /** Null until a hospital states one, or the doctor sets it on their profile. */
  specialty: string | null;
}

export interface MemberRow {
  userId: string;
  displayName: string;
  email: string | null;
  seatRole: SeatRole;
  acceptedAt: string;
}

interface DbOrganisation {
  id: string;
  kind: string;
  legal_name: string;
  corridor_id: string;
  side: EndpointSide;
  verification_status: string;
  submitted_at: Date;
  decided_at: Date | null;
  reason_key: string | null;
  seat_count: number;
}

function toOrganisation(row: DbOrganisation): OrganisationRow {
  return {
    id: row.id,
    kind: row.kind,
    legalName: row.legal_name,
    corridorId: row.corridor_id,
    side: row.side,
    verification: {
      status: row.verification_status,
      submittedAt: row.submitted_at.toISOString(),
      ...(row.decided_at === null ? {} : { decidedAt: row.decided_at.toISOString() }),
      ...(row.reason_key === null ? {} : { reasonKey: row.reason_key }),
    },
    seatCount: row.seat_count,
  };
}

const SELECT_ORG =
  `SELECT id, kind, legal_name, corridor_id, side, verification_status,
          submitted_at, decided_at, reason_key, seat_count
   FROM identity_organisations`;

@Injectable()
export class OrganisationsService {
  private readonly logger = new Logger('Organisations');

  constructor(
    private readonly db: DatabaseService,
    private readonly keycloak: KeycloakAdminClient,
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(input: {
    kind: string;
    legalName: string;
    corridorId: string;
    side: EndpointSide;
    credentials: Record<string, unknown>;
    seatCount: number;
  }): Promise<OrganisationRow> {
    // Refuse a corridor nobody is configured to serve before writing anything.
    // Without this the row is created and then cannot ever be approved, because
    // there is no role to grant — a dead application nobody can explain.
    if (corridorRoleFor(input.corridorId, input.side) === null) {
      throw new BadRequestException('unknown_corridor');
    }

    const id = await this.db.tx(async (tx) => {
      const res = await tx.query<{ identity_create_organisation: string }>(
        'SELECT identity_create_organisation($1, $2, $3, $4, $5, $6)',
        [
          input.kind,
          input.legalName,
          input.corridorId,
          input.side,
          JSON.stringify(input.credentials),
          input.seatCount,
        ],
      );
      return res.rows[0]?.identity_create_organisation;
    });

    if (id === undefined) throw new ConflictException('organisation_not_created');
    const found = await this.byId(id);
    if (found === null) throw new NotFoundException('organisation_not_found');
    return found;
  }

  /** The caller's own organisation. Null when they belong to none. */
  async mine(): Promise<OrganisationRow | null> {
    return this.db.tx(async (tx) => {
      // No WHERE on membership: `organisations_member` already restricts this
      // to organisations the caller is seated at.
      const res = await tx.query<DbOrganisation>(`${SELECT_ORG} LIMIT 1`);
      const row = res.rows[0];
      return row === undefined ? null : toOrganisation(row);
    });
  }

  async byId(id: string): Promise<OrganisationRow | null> {
    return this.db.tx(async (tx) => {
      const res = await tx.query<DbOrganisation>(`${SELECT_ORG} WHERE id = $1`, [id]);
      const row = res.rows[0];
      return row === undefined ? null : toOrganisation(row);
    });
  }

  async members(organisationId: string): Promise<MemberRow[]> {
    return this.db.tx(async (tx) => {
      const res = await tx.query<{
        user_id: string;
        full_name: string;
        email: string | null;
        seat_role: SeatRole;
        accepted_at: Date;
      }>(
        `SELECT m.user_id, u.full_name, u.email, m.seat_role, m.accepted_at
         FROM identity_memberships m
         JOIN identity_users u ON u.id = m.user_id
         WHERE m.organisation_id = $1
         ORDER BY m.accepted_at`,
        [organisationId],
      );
      return res.rows.map((r) => ({
        userId: r.user_id,
        displayName: r.full_name,
        email: r.email,
        seatRole: r.seat_role,
        acceptedAt: r.accepted_at.toISOString(),
      }));
    });
  }

  /**
   * Invite someone to a seat.
   *
   * The seat check counts ACCEPTED members plus OUTSTANDING invitations, which
   * is what `hasSeatAvailable` exists to get right: counting members alone lets
   * an owner send eleven invitations against ten seats and have the person who
   * accepts last be the one refused — blaming the invitee for the inviter's
   * mistake. The database re-checks on acceptance regardless, because seats can
   * be lowered after invitations go out.
   */
  async invite(
    organisationId: string,
    email: string,
    seatRole: SeatRole,
    details: { specialty?: string; fullName?: string } = {},
  ): Promise<void> {
    const organisation = await this.byId(organisationId);
    if (organisation === null) throw new NotFoundException('organisation_not_found');

    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');

    await this.db.tx(async (tx) => {
      const counts = await tx.query<{ members: string; invitations: string }>(
        `SELECT
           (SELECT count(*) FROM identity_memberships WHERE organisation_id = $1) AS members,
           (SELECT count(*) FROM identity_invitations
             WHERE organisation_id = $1 AND consumed_at IS NULL AND expires_at > now())
             AS invitations`,
        [organisationId],
      );
      const row = counts.rows[0];
      const members = Number(row?.members ?? 0);
      const invitations = Number(row?.invitations ?? 0);

      if (!hasSeatAvailable(organisation.seatCount, members, invitations)) {
        throw new ConflictException('no_seat_available');
      }

      const ctx = requireContext();
      // WHO MAY INSERT IS DECIDED BY POLICY, NOT HERE. `invitations_owner_insert`
      // admits an owner for any seat; `invitations_clinician_assistant_insert`
      // (0018) admits a seated clinician for an ASSISTANT seat only. A doctor
      // trying to invite another doctor therefore fails at the database, which
      // is the line between "can hire a receptionist" and "can mint a clinician"
      // — and it is one line, in one place, rather than a role check here that a
      // later refactor can drop.
      try {
        await tx.query(
          `INSERT INTO identity_invitations
             (organisation_id, email, token_hash, seat_role, invited_by, expires_at,
              specialty, full_name)
           VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6), $7, $8)`,
          [
            organisationId,
            email.toLowerCase(),
            tokenHash,
            seatRole,
            ctx.userId,
            INVITATION_TTL_DAYS,
            details.specialty ?? null,
            details.fullName ?? null,
          ],
        );
      } catch (err) {
        if ((err as { code?: string }).code === '42501') {
          // 403, NOT 404 — and the difference is deliberate.
          //
          // Elsewhere an RLS refusal becomes 404 because revealing that a row
          // exists is itself a disclosure (§6). Not here: the caller is a member
          // of this organisation and already knows it exists. What they are
          // being refused is an ACTION — issuing a seat that becomes a clinical
          // role — and answering "not found" for an organisation they can see
          // on screen would be a lie that helps nobody debug it.
          throw new ForbiddenException('seat_role_not_permitted');
        }
        throw err;
      }
    });

    // Built from configuration, never from the request's Host header — a link
    // assembled from an attacker-controlled header is a redirect to wherever
    // they asked, sent from our domain.
    const base = this.config.APP_PUBLIC_URL ?? 'http://localhost:3001';
    try {
      await this.mail.send({
        kind: 'seat_invitation',
        to: email,
        organisationName: organisation.legalName,
        acceptUrl: `${base.replace(/\/$/, '')}/invite/${token}`,
        locale: 'ar',
      });
    } catch (err) {
      // The invitation exists and can be resent. Failing the request would
      // suggest to the owner that nothing was created, and they would try again
      // — burning a second seat against the limit.
      this.logger.error(`invitation mail failed: ${String(err)}`);
    }
  }

  /**
   * Redeem an invitation.
   *
   * Two steps, deliberately: the function seats the invitee, and this then
   * grants the corridor role separately. The mapping stays in the application
   * (§4.3) rather than being embedded in SQL, and the grant is a no-op for an
   * organisation that has not been approved yet — so joining early leaves the
   * invitee an applicant until the decision lands, which is correct.
   */
  async acceptInvitation(token: string): Promise<OrganisationRow | null> {
    const ctx = requireContext();
    const tokenHash = createHash('sha256').update(token).digest('hex');

    // Read the invitation's details BEFORE redeeming it: acceptance consumes
    // the row, and the invitee matches no SELECT policy on it afterwards (or
    // before). Losing a race with a concurrent redemption is harmless — the
    // acceptance below then returns null and nothing further happens.
    const details = await this.db.tx(async (tx) => {
      const res = await tx.query<{ seat_role: SeatRole; specialty: string | null }>(
        'SELECT seat_role, specialty FROM identity_invitation_details($1)',
        [tokenHash],
      );
      return res.rows[0] ?? null;
    });

    const organisationId = await this.db.tx(async (tx) => {
      const res = await tx.query<{ identity_accept_invitation: string | null }>(
        'SELECT identity_accept_invitation($1)',
        [tokenHash],
      );
      return res.rows[0]?.identity_accept_invitation ?? null;
    });

    if (organisationId === null) return null;

    const organisation = await this.byId(organisationId);
    if (organisation === null) return null;

    if (organisation.verification.status === 'approved') {
      // WHICH ROLE DEPENDS ON THE SEAT, and the seat is read back from the
      // membership the function just created rather than from the invitation —
      // the invitation is consumed by then, and the membership is the record
      // that will still be there tomorrow.
      const seatRole = await this.db.tx(async (tx) => {
        const res = await tx.query<{ seat_role: SeatRole }>(
          `SELECT seat_role FROM identity_memberships
           WHERE organisation_id = $1 AND user_id = $2`,
          [organisationId, ctx.userId],
        );
        return res.rows[0]?.seat_role ?? null;
      });

      if (seatRole === 'assistant') {
        // Deliberately NOT the corridor role. An assistant seat must never
        // resolve to a clinical account, and `identity_grant_membership_role`
        // would refuse 'assistant' anyway — the two grants are separate
        // functions so that neither can be talked into doing the other's job.
        await this.db.tx(async (tx) => {
          await tx.query('SELECT identity_grant_assistant_role($1, $2)', [
            organisationId,
            ctx.userId,
          ]);
        });
        await this.grantRealmRole(ctx.userId, 'assistant');
      } else {
        const role = corridorRoleFor(organisation.corridorId, organisation.side);
        if (role !== null) {
          await this.db.tx(async (tx) => {
            await tx.query('SELECT identity_grant_membership_role($1, $2, $3)', [
              organisationId,
              ctx.userId,
              role,
            ]);
          });
          await this.grantRealmRole(ctx.userId, role);

          // Record the specialty the inviter stated, on the MEMBERSHIP.
          //
          // Not on `identity_doctor_profiles`: that is a licensure record whose
          // licence number is NOT NULL and whose `verified_at` is an ops
          // decision. A hospital naming a department is an employment fact, and
          // writing it into the licensure table would mean either relaxing that
          // constraint or inventing a licence number.
          if (details?.specialty !== undefined && details.specialty !== null) {
            await this.db.tx(async (tx) => {
              await tx.query('SELECT identity_set_membership_specialty($1, $2, $3)', [
                organisationId,
                ctx.userId,
                details.specialty,
              ]);
            });
          }
        }
      }
    }

    return organisation;
  }

  /**
   * The organisation's clinicians, with the specialty an appointment is routed
   * on.
   *
   * Goes through a SECURITY DEFINER function because `identity_doctor_profiles`
   * is self-or-admin: a hospital could not otherwise see which of its own
   * doctors is a radiologist. The function returns a name, a role and a
   * specialty — not the licence number or the verification decision, neither of
   * which is a colleague's business.
   */
  async clinicians(organisationId: string): Promise<ClinicianRow[]> {
    return this.db.tx(async (tx) => {
      const res = await tx.query<{
        user_id: string;
        full_name: string;
        role: string;
        specialty: string | null;
      }>('SELECT user_id, full_name, role, specialty FROM identity_organisation_clinicians($1)', [
        organisationId,
      ]);
      return res.rows.map((r) => ({
        userId: r.user_id,
        displayName: r.full_name,
        role: r.role,
        specialty: r.specialty,
      }));
    });
  }

  /** Applications awaiting an ops decision — brief §5.8. */
  async pendingQueue(): Promise<OrganisationRow[]> {
    return this.db.tx(async (tx) => {
      const res = await tx.query<DbOrganisation>(
        `${SELECT_ORG} WHERE verification_status = 'pending' ORDER BY submitted_at`,
      );
      return res.rows.map(toOrganisation);
    });
  }

  async all(): Promise<OrganisationRow[]> {
    return this.db.tx(async (tx) => {
      const res = await tx.query<DbOrganisation>(`${SELECT_ORG} ORDER BY submitted_at DESC`);
      return res.rows.map(toOrganisation);
    });
  }

  /**
   * The verification decision — the only path from `applicant` to a clinical
   * role.
   *
   * The granted role is DERIVED from the organisation's corridor and side. Ops
   * chooses whether to approve, never what approving grants; there is no field
   * in the request that reaches `p_granted_role`.
   */
  async decide(organisationId: string, approve: boolean, reasonKey?: string): Promise<void> {
    const organisation = await this.byId(organisationId);
    if (organisation === null) throw new NotFoundException('organisation_not_found');

    let role: string | null = null;
    if (approve) {
      role = corridorRoleFor(organisation.corridorId, organisation.side);
      if (role === null) {
        // The corridor has been retired from configuration since the
        // application was submitted. Approving would grant nothing and leave
        // an "approved" organisation whose members cannot sign in.
        throw new BadRequestException('unknown_corridor');
      }
    }

    const seated = await this.members(organisationId);

    await this.db.tx(async (tx) => {
      await tx.query('SELECT identity_decide_verification($1, $2, $3, $4)', [
        organisationId,
        approve,
        reasonKey ?? null,
        role,
      ]);
    });

    if (approve && role !== null) {
      // The application database now says these people are clinicians; their
      // TOKENS must say so too, or the auth guard refuses them at the door.
      for (const member of seated) {
        await this.grantRealmRole(member.userId, role);
      }
    }
  }

  /**
   * Mirror an application role onto the identity provider.
   *
   * Failures are logged rather than raised, and that is a real trade: the
   * decision is already committed, and rolling it back would mean re-deciding
   * an organisation the function refuses to re-decide. What is left is an
   * approved provider who cannot sign in until the realm role is attached —
   * visible in the log, fixable by hand, and not a state that grants anyone
   * access they should not have.
   */
  private async grantRealmRole(userId: string, role: string): Promise<void> {
    if (!this.keycloak.isConfigured()) return;

    const sub = await this.db.tx(async (tx) => {
      const res = await tx.query<{ keycloak_sub: string }>(
        'SELECT keycloak_sub FROM identity_users WHERE id = $1',
        [userId],
      );
      return res.rows[0]?.keycloak_sub;
    });

    if (sub === undefined) return;
    try {
      await this.keycloak.assignRealmRole(sub, role);
    } catch (err) {
      this.logger.error(`realm role ${role} not attached after approval: ${String(err)}`);
    }
  }
}
