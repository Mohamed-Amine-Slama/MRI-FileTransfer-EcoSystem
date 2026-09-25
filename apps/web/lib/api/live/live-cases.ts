import type { CasesApi } from '../cases';
import { api, type CaseRecord } from '../endpoints';
import { DEFAULT_CORRIDOR_ID } from '../../corridor/registry';
import { timelineFor, toCase, toProvider } from './adapt';

/**
 * The case layer over the REAL API — spec 2026-09-21 §9.
 *
 * `lib/api/mock/index.ts` always said this would come: "when the backend
 * lands, add the live client and select on isMockMode(); the screens import
 * casesApi and will not need to change." The backend landed (cases, ledger,
 * organisations) and the screens kept reading fixtures, so a real case opened
 * from the doctor's inbox was "not found" on the case page.
 *
 * WHAT IS NOT HERE, AND WHY. Messaging, the per-file access trail, in-app
 * notifications and an ops status override have no backend. They are declared
 * unsupported so screens hide them; a message thread that vanished on reload
 * would be worse than no thread.
 *
 * Scoping is the API's job (RLS). The `audience` arguments the contract passes
 * are not re-checked here — the server returns only what the caller may see,
 * and "not yours" arrives as the same 404 as "does not exist".
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Route params are a case id (the doctor's inbox links by id) or a reference
 * (the case list links by ref). Both resolve here; an unknown or invisible one
 * is null.
 */
export async function findCaseRecord(refOrId: string): Promise<CaseRecord | null> {
  if (UUID.test(refOrId)) {
    try {
      return await api.cases.get(refOrId);
    } catch {
      return null;
    }
  }
  const { cases } = await api.cases.list();
  const found = cases.find((c) => c.caseRef === refOrId);
  if (found === undefined) return null;
  // The list row has no study ids; the single read does.
  return api.cases.get(found.id);
}

export const liveCasesApi: CasesApi = {
  supports: { messaging: false, fileAccessTrail: false, notifications: false, statusOverride: false },

  async listCases(query) {
    const { cases } = await api.cases.list({
      ...(query.updatedFrom === undefined ? {} : { from: query.updatedFrom }),
      ...(query.updatedTo === undefined ? {} : { to: query.updatedTo }),
    });
    const search = query.search?.trim().toUpperCase() ?? '';
    return cases
      .filter((c) => query.status === undefined || c.status === query.status)
      .filter((c) => search === '' || c.caseRef.includes(search))
      .map((c) => toCase(c, DEFAULT_CORRIDOR_ID));
  },

  async getCase(refOrId) {
    const r = await findCaseRecord(refOrId);
    return r === null ? null : toCase(r, DEFAULT_CORRIDOR_ID);
  },

  async listCaseEvents(refOrId) {
    const r = await findCaseRecord(refOrId);
    return r === null ? [] : timelineFor(r);
  },

  async listFileAccess() {
    return [];
  },

  async submitCase() {
    // The live flow submits through api.cases.submit (specialty + studies),
    // which the new-case screen calls directly. This contract shape carries
    // neither, so it is not a path to a real case.
    throw new Error('submitCase is not supported by the live API; use api.cases.submit');
  },

  async changeCaseStatus() {
    throw new Error('Status override is not supported by the live API');
  },

  async listLedger(organisationId) {
    return (await api.ledger.forOrganisation(organisationId)).entries;
  },

  async listAllLedger() {
    const { organisations } = await api.ledger.all();
    return organisations.map((g) => ({ providerId: g.organisationId, entries: g.entries }));
  },

  async listMessages() {
    return [];
  },

  async sendMessage() {
    throw new Error('Messaging is not supported by the live API');
  },

  async listNotifications() {
    return [];
  },

  async markNotificationRead() {},

  async getProvider(id) {
    const { organisation } = await api.organisations.mine();
    return organisation !== null && organisation.id === id ? toProvider(organisation) : null;
  },

  async listProviders() {
    return (await api.organisations.queue()).organisations.map(toProvider);
  },

  async listVerificationQueue() {
    const { organisations } = await api.organisations.queue();
    return organisations.filter((o) => o.verification.status === 'pending').map(toProvider);
  },

  async registerProvider(input) {
    return toProvider(await api.organisations.create(input));
  },

  async decideVerification(id, approve, reasonKey) {
    await api.organisations.decide(id, approve, reasonKey);
    const found = (await api.organisations.queue()).organisations.find((o) => o.id === id);
    if (found === undefined) throw new Error('Organisation not found after decision');
    return toProvider(found);
  },

  async listAllCases(status) {
    const { cases } = await api.cases.list();
    return cases
      .filter((c) => status === undefined || c.status === status)
      .map((c) => toCase(c, DEFAULT_CORRIDOR_ID));
  },
};
