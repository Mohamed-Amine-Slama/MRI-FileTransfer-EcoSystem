import { describe, expect, it } from 'vitest';
import type { LedgerEntry, Provider } from '@mir/contracts';
import { adminLedgerRows } from './admin-rows';

const provider = (id: string) => ({ id, legalName: id }) as unknown as Provider;
const entry = { id: 'e1' } as unknown as LedgerEntry;

describe('adminLedgerRows', () => {
  it('lists every provider, with an empty ledger for one that has no entries', () => {
    const rows = adminLedgerRows([provider('a'), provider('b')], [{ organisationId: 'a', entries: [entry] }]);
    expect(rows.map((r) => [r.providerId, r.entries.length])).toEqual([
      ['a', 1],
      ['b', 0],
    ]);
    expect(rows[1]?.provider.legalName).toBe('b');
  });
});
