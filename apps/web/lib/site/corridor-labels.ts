import type { UiLocale } from '@mir/contracts';
import { countryName } from '../corridor/country-name';
import { CORRIDORS, DEFAULT_CORRIDOR_ID, getCorridor } from '../corridor/registry';

/**
 * What the landing page needs to know about the corridor it is selling —
 * brief §4.3, Landing-Page-Specs §5.
 *
 * The scenes talk about "your clinic in X" and "a specialist in Y" and put two
 * clocks side by side. None of them may know which countries those are: §4.3
 * forbids UI copy, routing, or business logic that assumes this corridor
 * specifically, and `lib/corridor/no-hardcoded-corridor.test.ts` enforces it by
 * scanning every file under `app/` and `components/`.
 *
 * So the registry answers the question once, here, and the scenes render
 * labels. Configuring a second corridor re-labels the whole page — hero
 * subhead, map, consent recipient, both clocks — with no copy change at all.
 */

export interface CorridorLabels {
  id: string;
  /** ISO-3166 alpha-2, for the timezone and the map. */
  sourceCountry: string;
  destinationCountry: string;
  /** The country's name in the reader's language, from `Intl.DisplayNames`. */
  source: string;
  destination: string;
}

/**
 * The corridor this marketing site sells.
 *
 * There is exactly one configured today. If a second is ever added, the
 * landing page's honest options are to sell the default explicitly or to route
 * per corridor — both of which are decisions, so this reads the FIRST entry
 * rather than silently picking one and pretending it was general.
 */
export function corridorLabels(locale: UiLocale): CorridorLabels {
  const corridor = getCorridor(DEFAULT_CORRIDOR_ID) ?? CORRIDORS[0];

  if (corridor === undefined) {
    // No corridor configured at all. The page must still render — a blank
    // landing page is a worse failure than an unlabelled one — so the
    // templates receive empty strings and the sentences degrade to "your
    // clinic in " rather than to a crash.
    return { id: '', sourceCountry: '', destinationCountry: '', source: '', destination: '' };
  }

  return {
    id: corridor.id,
    sourceCountry: corridor.source.country,
    destinationCountry: corridor.destination.country,
    source: countryName(corridor.source.country, locale),
    destination: countryName(corridor.destination.country, locale),
  };
}
