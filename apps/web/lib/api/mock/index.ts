import type { CasesApi } from '../cases';
import { isMockMode } from '../cases';
import { liveCasesApi } from '../live/live-cases';
import { mockCasesApi } from './mock-cases';

/**
 * The case layer the screens import.
 *
 * LIVE BY DEFAULT (spec 2026-09-21 §9). `isMockMode()` is true only when
 * NEXT_PUBLIC_MIR_API_MODE=mock, so a missing or misspelled variable can never
 * serve fixtures to a clinic. The fixture store stays for vitest and for
 * reviewing screens without a backend; the screens import `casesApi` and do
 * not know which one they got.
 */
export const casesApi: CasesApi = isMockMode() ? mockCasesApi : liveCasesApi;
