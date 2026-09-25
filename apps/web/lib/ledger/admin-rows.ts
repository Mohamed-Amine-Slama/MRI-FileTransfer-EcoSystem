import type { LedgerEntry, Provider } from '@mir/contracts';

/**
 * One row per organisation ops can see, with its entries — `[]` when it has
 * none, so a new clinic still appears with zero totals rather than vanishing.
 */
export function adminLedgerRows(
  providers: Provider[],
  grouped: { organisationId: string; entries: LedgerEntry[] }[],
): { providerId: string; provider: Provider; entries: LedgerEntry[] }[] {
  const byOrg = new Map(grouped.map((g) => [g.organisationId, g.entries]));
  return providers.map((provider) => ({
    providerId: provider.id,
    provider,
    entries: byOrg.get(provider.id) ?? [],
  }));
}
