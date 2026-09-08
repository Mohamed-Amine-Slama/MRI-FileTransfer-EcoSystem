import { Injectable } from '@nestjs/common';
import {
  caseRefSchema,
  currencySchema,
  paymentStatusSchema,
  type EndpointSide,
  type LedgerEntry,
} from '@mir/contracts';
import { DatabaseService } from '../../../shared/db/database.service';

/**
 * The provider ledger — brief §5.7.
 *
 * NOTHING HERE TAKES MONEY. Blocking item L7 is unresolved: whether a Libyan
 * payer can lawfully pay a Tunisian-facing platform, and where the receiving
 * entity must be incorporated. An entry records what is OWED; there is no rail,
 * no provider id, and no card.
 *
 * NOTHING HERE PRODUCES A TOTAL. §5.7 P0 forbids merging coordination fees with
 * subscription charges into one ambiguous "amount owed". This service returns
 * entries; `summariseLedger` in the contract totals them per kind and per
 * currency, and there is deliberately no method here that sums across `kind`.
 * Adding one would be the single change that reintroduces the ambiguity the
 * union was shaped to prevent.
 */

interface DbEntry {
  id: string;
  kind: string;
  amount_minor: string;
  currency: string;
  status: string;
  occurred_at: Date;
  case_ref: string | null;
}

@Injectable()
export class LedgerService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Accrue one side's coordination fee for a referral.
   *
   * Returns the new entry's id, or `null` when nothing was accrued — either the
   * corridor has no active rate for that side, or the caller's role is not
   * allowed to write the ledger. A missing rate must not invent a charge and
   * must not block a referral: a clinical hand-off does not wait on a billing
   * configuration.
   *
   * `ON CONFLICT DO NOTHING` leans on the partial unique index rather than
   * reading first: a read-then-write would still race, and billing a clinic
   * twice for one referral has to be impossible rather than unlikely.
   */
  async accrueCoordinationFee(caseId: string, side: EndpointSide): Promise<string | null> {
    return this.db.tx(async (tx) => {
      // Which organisation owes: the referring doctor's on the source side, the
      // receiving doctor's on the destination side.
      //
      // Read through a definer function because accrual runs as the system
      // role, which cannot see patients — there is no admin policy on
      // patients_patients and there must not be one, so this join is invisible
      // to the context that has to bill for it. Doing it inline returned no
      // rows and made every referral free, silently.
      const org = await tx.query<{ organisation_id: string; corridor_id: string }>(
        'SELECT organisation_id, corridor_id FROM billing_owing_organisation($1, $2)',
        [caseId, side],
      );
      const organisation = org.rows[0];
      if (organisation === undefined) return null;

      const rate = await tx.query<{ amount_minor: string; currency: string }>(
        `SELECT amount_minor, currency FROM billing_fee_schedule
          WHERE corridor_id = $1 AND side = $2 AND active`,
        [organisation.corridor_id, side],
      );
      const row = rate.rows[0];
      if (row === undefined) return null;

      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO billing_ledger_entries
           (organisation_id, kind, case_id, amount_minor, currency)
         VALUES ($1, 'coordination_fee', $2, $3, $4)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [organisation.organisation_id, caseId, row.amount_minor, row.currency],
      );
      return inserted.rows[0]?.id ?? null;
    });
  }

  /**
   * The organisation's entries, newest first.
   *
   * RLS decides what comes back, so another organisation's id returns an empty
   * list rather than an authorisation error — the same answer as "there is
   * nothing there", which leaks no existence.
   */
  async listForOrganisation(organisationId: string): Promise<LedgerEntry[]> {
    return this.db.tx(async (tx) => {
      // The case reference belongs to the referral (migration 0024), so it is
      // joined rather than stored twice: both sides' fees for one case must
      // quote the same number.
      const res = await tx.query<DbEntry>(
        `SELECT e.id, e.kind, e.amount_minor, e.currency, e.status, e.occurred_at,
                a.case_ref
           FROM billing_ledger_entries e
           LEFT JOIN cases_cases a ON a.id = e.case_id
          WHERE e.organisation_id = $1
          ORDER BY e.occurred_at DESC`,
        [organisationId],
      );

      return res.rows.flatMap((r) => toEntry(r) ?? []);
    });
  }
}

/**
 * A row the contract cannot describe is DROPPED, not coerced.
 *
 * The alternative is casting past the union, which would let a coordination fee
 * with no case reference reach a screen that promises one — and §5.7 P1 exists
 * because a charge nobody can trace back to a referral is a charge nobody can
 * dispute.
 */
function toEntry(r: DbEntry): LedgerEntry | null {
  const currency = currencySchema.safeParse(r.currency);
  const status = paymentStatusSchema.safeParse(r.status);
  if (!currency.success || !status.success) return null;

  const base = {
    id: r.id,
    occurredAt: r.occurred_at.toISOString(),
    // bigint arrives as a string from pg; Number is exact well past any
    // plausible fee in minor units.
    amount: { amountMinor: Number(r.amount_minor), currency: currency.data },
    status: status.data,
  };

  if (r.kind === 'coordination_fee') {
    const caseRef = caseRefSchema.safeParse(r.case_ref);
    if (!caseRef.success) return null;
    return { ...base, kind: 'coordination_fee', caseRef: caseRef.data };
  }

  // Subscription charges are not written by anything yet — changing a plan
  // records intent and takes no money (L7). The branch exists so that when they
  // are, the period is read from the row rather than guessed here.
  return null;
}
