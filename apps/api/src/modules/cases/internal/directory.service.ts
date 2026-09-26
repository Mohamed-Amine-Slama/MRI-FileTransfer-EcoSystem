import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../../shared/db/database.service';

export interface DirectoryEntry {
  id: string;
  displayName: string;
  specialty: string;
  city: string | null;
  tierCode: string;
  /**
   * What a consult costs in this corridor. INDICATIVE: the binding number is
   * the one `CasesService.quote` locks against the case.
   */
  indicativeAmountMinor: number | null;
  indicativeCurrency: string | null;
}

/**
 * Who can take this case — the directory a lab browses.
 *
 * SEPARATE FROM `CasesService` because it answers a different question. The
 * lifecycle service is about where one case is; this is about which doctors
 * exist to send it to, and it reads none of the case tables at all.
 *
 * EVERY READ HERE GOES THROUGH A DEFINER FUNCTION (migration 0027). The lab
 * matches no SELECT policy on `identity_doctor_profiles`, so the obvious join
 * returns zero rows rather than an error — the failure mode is an empty
 * directory that looks like "no doctors are available today". The functions
 * publish an explicit column list instead, so widening the directory is a
 * migration and not an edit to a SELECT list.
 */
@Injectable()
export class DirectoryService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Doctors currently accepting work, optionally narrowed to one specialty.
   *
   * THE CORRIDOR IS RESOLVED FROM THE CALLER, never taken from the request. It
   * decides which country's doctors come back, so a parameter would let a lab
   * browse — and then refer into — a corridor it is not party to. The plan had
   * it as an argument; it is not one.
   *
   * Ordered by name, not by price. Ordering a medical directory cheapest-first
   * invites the lab to shop on price alone, and the tier that sets the price is
   * a proxy for experience.
   */
  async listAcceptingDoctors(specialty?: string): Promise<DirectoryEntry[]> {
    return this.db.tx(async (tx) => {
      const org = await tx.query<{ corridor_id: string }>(
        `SELECT o.corridor_id
           FROM identity_memberships m
           JOIN identity_organisations o ON o.id = m.organisation_id
          WHERE m.user_id = app_current_user_id() AND o.side = 'source'
          LIMIT 1`,
      );
      const corridorId = org.rows[0]?.corridor_id;
      if (corridorId === undefined) {
        throw new ConflictException('Your account is not seated in a referring organisation');
      }

      const res = await tx.query<{
        id: string;
        display_name: string;
        specialty: string;
        clinic_name: string | null;
        tier_code: string;
        multiplier_bp: number;
      }>(`SELECT * FROM cases_doctor_directory($1, $2)`, [corridorId, specialty ?? null]);

      // One flat consult price per corridor (migration 0032): every doctor in
      // the directory costs the same, whatever the specialty or tier.
      const price = await tx.query<{ amount_minor: string; currency: string }>(
        `SELECT amount_minor, currency FROM pricing_consult_price WHERE corridor_id = $1`,
        [corridorId],
      );
      const p = price.rows[0];

      return res.rows.map((row) => ({
        id: row.id,
        displayName: row.display_name,
        specialty: row.specialty,
        city: row.clinic_name,
        tierCode: row.tier_code,
        // An unpriced corridor shows no price rather than a zero, which would
        // render as "free" on the directory card.
        indicativeAmountMinor: p === undefined ? null : Number(p.amount_minor),
        indicativeCurrency: p === undefined ? null : p.currency,
      }));
    });
  }

  /**
   * The doctor's own on/off switch.
   *
   * Takes no user id — `cases_set_accepting` reads the caller from the session
   * context, so there is no parameter with which to switch a colleague off.
   */
  async setAccepting(accepting: boolean): Promise<void> {
    const ok = await this.db.tx(async (tx) => {
      const res = await tx.query<{ ok: boolean }>(`SELECT cases_set_accepting($1) AS ok`, [
        accepting,
      ]);
      return res.rows[0]?.ok === true;
    });
    // No profile row: the account was granted the role but never completed
    // onboarding. 404 rather than 500 — there is nothing to switch.
    if (!ok) throw new NotFoundException('No doctor profile for this account');
  }
}
