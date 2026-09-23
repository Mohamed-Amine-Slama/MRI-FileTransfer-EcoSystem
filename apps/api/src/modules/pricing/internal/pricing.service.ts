import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { CurrencyCode } from '@mir/contracts';
import { DatabaseService } from '../../../shared/db/database.service';

/**
 * What a consult costs — spec 2026-09-21 §3.
 *
 * ONE PRICE PER CORRIDOR. Every consult on `ly-tn` is $100: the Libyan clinic
 * keeps $30 of what it collects, remits $70, and the platform pays the
 * Tunisian doctor $20 and keeps $50. The price and both shares come from
 * `pricing_consult_price` (migration 0032), so changing them is an UPDATE and
 * not a deploy.
 *
 * WHAT THIS REPLACED was specialty base × the doctor's seniority tier × a
 * scarcity surge (migration 0026). Those tables are still in the schema; this
 * service no longer reads them.
 *
 * The quote is LOCKED onto the case by `CasesService.quote` — amount and both
 * shares — and never recomputed; payment and payout read the case.
 */

export interface QuoteInput {
  corridorId: string;
  specialty: string;
  doctorId: string;
}

export interface Quote {
  amountMinor: number;
  currency: CurrencyCode;
  clinicShareMinor: number;
  doctorShareMinor: number;
}

export class SpecialtyClosedError extends ConflictException {
  constructor(specialty: string) {
    super(`No doctor is currently accepting ${specialty} cases`);
  }
}

@Injectable()
export class PricingService {
  constructor(private readonly db: DatabaseService) {}

  async quoteFor(input: QuoteInput): Promise<Quote> {
    return this.db.tx(async (tx) => {
      // Closed is still closed: nobody accepting means there is no consult to
      // price, and the lab is told so rather than quoted a price nobody can
      // answer. The headcount comes through a definer function — the lab
      // cannot see doctor profiles — and it returns a number, never a row.
      const counted = await tx.query<{ n: number }>(
        `SELECT pricing_accepting_count($1, $2) AS n`,
        [input.corridorId, input.specialty],
      );
      if ((counted.rows[0]?.n ?? 0) < 1) throw new SpecialtyClosedError(input.specialty);

      const price = await tx.query<{
        amount_minor: string;
        currency: CurrencyCode;
        clinic_share_minor: string;
        doctor_share_minor: string;
      }>(
        `SELECT amount_minor, currency, clinic_share_minor, doctor_share_minor
           FROM pricing_consult_price
          WHERE corridor_id = $1`,
        [input.corridorId],
      );
      const row = price.rows[0];
      if (row === undefined) {
        throw new NotFoundException(`No consult price for corridor ${input.corridorId}`);
      }

      // bigint arrives as a string from pg; Number is exact far beyond any
      // plausible consult price in minor units.
      return {
        amountMinor: Number(row.amount_minor),
        currency: row.currency,
        clinicShareMinor: Number(row.clinic_share_minor),
        doctorShareMinor: Number(row.doctor_share_minor),
      };
    });
  }
}
