import type { Case, CaseEvent, CaseStatus, Provider } from '@mir/contracts';
import type { CaseRecord, Organisation } from '../endpoints';

/**
 * The real API speaks `CaseRecord` (one row of `cases_cases`); the case screens
 * were built against the contract `Case`. These adapters are the whole
 * translation, and they are pure so they can be tested without a network.
 *
 * `intake` carries only the clinical request. The patient's name is never
 * copied into it: a screen that renders `intake` generically would otherwise
 * print it to a doctor (requirements §7).
 */
export function toCase(r: CaseRecord, corridorId: string): Case {
  return {
    ref: r.caseRef,
    corridorId,
    status: r.status,
    submittedByProviderId: r.organisationId,
    ...(r.doctorId === null ? {} : { matchedProviderId: r.doctorId }),
    patientId: r.patientId,
    patientAgeYears: r.patientAgeYears ?? null,
    patientSex: toSex(r.patientSex),
    studyIds: r.studyIds,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    intake: {
      specialty: r.specialty,
      ...(r.reason === null ? {} : { referralReason: r.reason }),
      ...(r.notes === null ? {} : { notes: r.notes }),
    },
  };
}

function toSex(value: string | null | undefined): Case['patientSex'] {
  return value === 'M' || value === 'F' || value === 'O' ? value : null;
}

/**
 * An organisation as the provider contract describes it. Credentials are not
 * part of the organisation read — they are ops-only evidence — so the contract
 * field is an empty record here rather than a guess.
 */
export function toProvider(o: Organisation): Provider {
  return {
    id: o.id,
    kind: o.kind,
    legalName: o.legalName,
    corridorId: o.corridorId,
    side: o.side,
    seatCount: o.seatCount,
    verification: {
      status: o.verification.status,
      submittedAt: o.verification.submittedAt,
      ...(o.verification.decidedAt === undefined ? {} : { decidedAt: o.verification.decidedAt }),
      ...(o.verification.reasonKey === undefined ? {} : { reasonKey: o.verification.reasonKey }),
      credentials: {},
    },
  };
}

/**
 * A timeline derived from the case's own instants. The real API has no event
 * table; these are the transitions the row timestamps, in order.
 */
export function timelineFor(r: CaseRecord): CaseEvent[] {
  const steps: { to: CaseStatus; at: string | null }[] = [
    { to: 'submitted', at: r.createdAt },
    { to: 'quoted', at: r.quotedAt },
    { to: 'accepted', at: r.acceptedAt },
    { to: 'answered', at: r.answeredAt },
  ];
  let from: CaseStatus | null = null;
  const events: CaseEvent[] = [];
  for (const step of steps) {
    if (step.at === null) continue;
    const bySide = step.to === 'accepted' || step.to === 'answered' ? 'destination' : 'source';
    events.push({
      id: `${r.id}:${step.to}`,
      caseRef: r.caseRef,
      occurredAt: step.at,
      actorDisplayName: bySide === 'destination' ? (r.doctorName ?? '—') : '—',
      actorSide: bySide,
      from,
      to: step.to,
    });
    from = step.to;
  }
  return events;
}
