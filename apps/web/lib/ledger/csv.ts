import { CURRENCY_MINOR_UNITS, toMajorUnits, type LedgerEntry, type Money } from '@mir/contracts';

/**
 * Ledger CSV export — brief §5.7 ("export/download of billing history").
 *
 * TWO FUNCTIONS, NOT ONE WITH A FLAG. §5.7 P0 forbids merging coordination
 * fees with subscription charges into one ambiguous figure. The two kinds
 * genuinely have different columns — a fee carries a case reference, a
 * subscription carries a billing period — so they cannot be written into one
 * table without inventing blank cells, and the blank cells are what would
 * invite a reader to sum the column. Splitting the export is the same
 * structural argument the discriminated union makes in the contract.
 *
 * There is deliberately no total row. A file with no total cannot be quoted
 * back to us as an "amount owed" that mixes currencies.
 */

/** RFC 4180 line ending: Excel on Windows is the tool that actually opens this. */
const EOL = '\r\n';

const FORMULA_START = /^[=+@\t\r]/;

/**
 * Escapes one field.
 *
 * Two separate jobs. The quoting is RFC 4180. The leading apostrophe is
 * spreadsheet formula-injection defence: a cell beginning `=`, `+`, `@` or a
 * control character is executed on open by Excel and Sheets. A leading `-` is
 * left alone when the field parses as a number, because a credit note is a
 * real negative amount and must not arrive as text.
 */
export function csvField(value: string): string {
  const dangerous =
    FORMULA_START.test(value) || (value.startsWith('-') && !Number.isFinite(Number(value)));
  const guarded = dangerous ? `'${value}` : value;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** ISO date only. The instant is not the useful part of a billing record. */
function isoDate(timestamp: string): string {
  return timestamp.slice(0, 10);
}

/**
 * A machine-readable amount: fixed to the currency's own exponent, never
 * localised. A CSV consumed by an accounting package must not carry Arabic
 * digits or a French decimal comma.
 */
function amountCell(money: Money): string {
  return toMajorUnits(money).toFixed(CURRENCY_MINOR_UNITS[money.currency]);
}

function toCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return [header, ...rows].map((row) => row.map(csvField).join(',')).join(EOL);
}

export function coordinationFeeCsv(entries: readonly LedgerEntry[]): string {
  const rows = entries
    .filter((entry) => entry.kind === 'coordination_fee')
    .map((entry) => [
      entry.id,
      isoDate(entry.occurredAt),
      entry.caseRef,
      amountCell(entry.amount),
      entry.amount.currency,
      entry.status,
    ]);
  return toCsv(['id', 'date', 'case_ref', 'amount', 'currency', 'payment_status'], rows);
}

/** What the platform owes a receiving doctor, one row per answered case. */
export function doctorPayoutCsv(entries: readonly LedgerEntry[]): string {
  const rows = entries
    .filter((entry) => entry.kind === 'doctor_payout')
    .map((entry) => [
      entry.id,
      isoDate(entry.occurredAt),
      entry.caseRef,
      amountCell(entry.amount),
      entry.amount.currency,
      entry.status,
    ]);
  return toCsv(['id', 'date', 'case_ref', 'amount', 'currency', 'payment_status'], rows);
}

export function subscriptionCsv(entries: readonly LedgerEntry[]): string {
  const rows = entries
    .filter((entry) => entry.kind === 'saas_subscription')
    .map((entry) => [
      entry.id,
      isoDate(entry.occurredAt),
      isoDate(entry.periodStart),
      isoDate(entry.periodEnd),
      amountCell(entry.amount),
      entry.amount.currency,
      entry.status,
    ]);
  return toCsv(
    ['id', 'date', 'period_start', 'period_end', 'amount', 'currency', 'payment_status'],
    rows,
  );
}

/**
 * Hands the browser a file.
 *
 * The object URL is revoked on the next tick rather than immediately: Safari
 * cancels a download whose URL is revoked in the same frame as the click.
 */
export function downloadCsv(filename: string, csv: string): void {
  // A BOM, so Excel reads the file as UTF-8 and Arabic provider names survive.
  // Written as an escape, not a literal BOM: a raw U+FEFF in source is
  // invisible and lint rightly refuses it.
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
