import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BP_ONE, quoteAmountMinor, surgeMultiplierBp, type CurrencyCode } from '@mir/contracts';
import { DatabaseService } from '../../../shared/db/database.service';

export interface QuoteInput {
  corridorId: string;
  specialty: string;
  doctorId: string;
}

export interface Quote {
  amountMinor: number;
  currency: CurrencyCode;
  tierBp: number;
  surgeBp: number;
  acceptingCount: number;
}

/**
 * Nobody in this specialty is accepting work. A 409 rather than a 404: the
 * specialty exists and is priced, it is simply closed right now, and the lab's
 * correct move is to come back or choose another specialty.
 */
export class SpecialtyClosedError extends ConflictException {
  constructor(specialty: string) {
    super(`No doctor is currently accepting ${specialty} cases`);
  }
}

/**
 * What a consult costs — consult-model spec Part 2.
 *
 * The arithmetic lives in `@mir/contracts` so the web app quotes the same
 * indicative price the API charges; this service only supplies the three
 * inputs. Two of them come through SECURITY DEFINER functions (migration 0026)
 * because the lab asking for a price has no policy granting it sight of the
 * doctors it is being priced against.
 */
@Injectable()
export class PricingService {
  constructor(private readonly db: DatabaseService) {}

  async quoteFor(input: QuoteInput): Promise<Quote> {
    return this.db.tx(async (tx) => {
      const rate = await tx.query<{ amount_minor: string; currency: CurrencyCode }>(
        `SELECT amount_minor, currency
           FROM pricing_specialty_rates
          WHERE corridor_id = $1 AND specialty = $2 AND active`,
        [input.corridorId, input.specialty],
      );
      const row = rate.rows[0];
      if (row === undefined) {
        throw new NotFoundException(
          `No active rate for ${input.specialty} on corridor ${input.corridorId}`,
        );
      }

      const counted = await tx.query<{ n: number }>(
        `SELECT pricing_accepting_count($1, $2) AS n`,
        [input.corridorId, input.specialty],
      );
      const acceptingCount = counted.rows[0]?.n ?? 0;

      const surgeBp = surgeMultiplierBp(acceptingCount);
      if (surgeBp === null) throw new SpecialtyClosedError(input.specialty);

      const tiered = await tx.query<{ bp: number }>(`SELECT pricing_tier_bp($1) AS bp`, [
        input.doctorId,
      ]);
      // A doctor with no profile row cannot be quoted against; fall back to the
      // base tier rather than to a free consult.
      const tierBp = tiered.rows[0]?.bp ?? BP_ONE;

      return {
        amountMinor: quoteAmountMinor(Number(row.amount_minor), tierBp, surgeBp),
        currency: row.currency,
        tierBp,
        surgeBp,
        acceptingCount,
      };
    });
  }
}
