import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { quoteAmountMinor, surgeMultiplierBp } from '@mir/contracts';
import { DatabaseService } from '../../../shared/db/database.service';

export interface DirectoryEntry {
  id: string;
  displayName: string;
  specialty: string;
  city: string | null;
  tierCode: string;
  /**
   * What this doctor would cost right now. INDICATIVE: the surge term moves
   * with how many colleagues are switched on, so the binding number is the one
   * `CasesService.quote` locks against the case.
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

      // One rate lookup and one count per specialty present, not per doctor:
      // the surge term is a property of the specialty, and asking for it once
      // per row would make a twenty-doctor directory forty round trips.
      const rates = new Map<string, { amountMinor: number; currency: string } | null>();
      const surges = new Map<string, number | null>();

      for (const row of res.rows) {
        if (!rates.has(row.specialty)) {
          const rate = await tx.query<{ amount_minor: string; currency: string }>(
            `SELECT amount_minor, currency
               FROM pricing_specialty_rates
              WHERE corridor_id = $1 AND specialty = $2 AND active`,
            [corridorId, row.specialty],
          );
          const r = rate.rows[0];
          rates.set(
            row.specialty,
            r === undefined ? null : { amountMinor: Number(r.amount_minor), currency: r.currency },
          );
        }
        if (!surges.has(row.specialty)) {
          const counted = await tx.query<{ n: number }>(
            `SELECT pricing_accepting_count($1, $2) AS n`,
            [corridorId, row.specialty],
          );
          surges.set(row.specialty, surgeMultiplierBp(counted.rows[0]?.n ?? 0));
        }
      }

      return res.rows.map((row) => {
        const rate = rates.get(row.specialty) ?? null;
        const surgeBp = surges.get(row.specialty) ?? null;
        // An unpriced specialty shows no price rather than a zero. A zero here
        // would render as "free" on the directory card.
        const priced =
          rate !== null && surgeBp !== null
            ? quoteAmountMinor(rate.amountMinor, row.multiplier_bp, surgeBp)
            : null;
        return {
          id: row.id,
          displayName: row.display_name,
          specialty: row.specialty,
          city: row.clinic_name,
          tierCode: row.tier_code,
          indicativeAmountMinor: priced,
          indicativeCurrency: priced === null ? null : (rate?.currency ?? null),
        };
      });
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
