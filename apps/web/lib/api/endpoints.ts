import type {
  EndpointSide,
  InviteMemberInput,
  Membership,
  ProviderKind,
  PlanCode,
  PlanTier,
  PlanUsage,
  RegistrationInput,
  Role,
  Subscription,
  UpdateProfileInput,
  UserPreferences,
} from '@mir/contracts';
import { apiFetch, newIdempotencyKey } from './client';

/**
 * Typed view of the API surface.
 *
 * One declaration per route, so a change to the API surface is a change to one
 * file rather than a hunt through components. The shapes here mirror the
 * controllers exactly; where they disagreed, the controller won — notably
 * consent, which requires the named recipient and the exact rendered text.
 */

export interface SessionUser {
  userId: string;
  role: Role;
  displayName: string;
  /** Patients only: set once the account is linked to a medical record (P5.2). */
  patientId?: string;
  mfaEnrolled: boolean;
}

/**
 * A user's own record. Distinct from `SessionUser`, which is the minimum the
 * chrome needs on every page; this is what the profile screen loads.
 */
export interface UserProfile {
  id: string;
  email: string | null;
  fullName: string;
  phoneE164: string;
  jobTitle: string | null;
  role: Role;
  status: 'pending_verification' | 'active' | 'suspended';
  createdAt: string;
}

/** The organisation the signed-in user acts for — the durable form of `Provider`. */
/** A clinician an appointment can be assigned to. */
export interface Clinician {
  userId: string;
  displayName: string;
  role: Role;
  /** Null until the organisation states one, or the doctor sets it. */
  specialty: string | null;
}

export interface Organisation {
  id: string;
  /**
   * From the contract, not restated. The literal union that used to be written
   * here silently fell behind when `hospital` was added — the shared package is
   * the one place these are defined, and a second copy is a second thing to
   * forget.
   */
  kind: ProviderKind;
  legalName: string;
  corridorId: string;
  side: EndpointSide;
  verification: {
    status: 'pending' | 'approved' | 'rejected';
    submittedAt: string;
    decidedAt?: string;
    reasonKey?: string;
  };
  seatCount: number;
}

export interface Patient {
  id: string;
  fullName: string;
  phoneE164: string;
  dateOfBirth: string;
  sex: 'M' | 'F' | 'O';
  nationalId?: string;
}

/**
 * DISCRIMINATED ON `kind`, matching the API.
 *
 * This was declared with a `status` field and optional members, which the API
 * has never sent — it returns `{ kind: 'created' | 'confirmation_required' }`.
 * Nothing failed loudly: `result.status` was simply always `undefined`, so the
 * near-duplicate confirmation branch could not fire and a possible duplicate
 * was created silently. Merging two patients is the worst failure this system
 * can produce, and that guard was the screen that existed to prevent it.
 *
 * A union rather than optional fields, so `patientId` is only reachable on the
 * branch that actually carries one.
 */
export type CreatePatientResult =
  | { kind: 'created'; patientId: string }
  | { kind: 'confirmation_required'; candidates: Patient[] };

export interface Study {
  id: string;
  studyInstanceUid: string;
  description: string | null;
  studyDate: string | null;
  modality: string;
  instanceCount: number;
}

export interface Doctor {
  id: string;
  displayName: string;
  specialty: string | null;
  city: string | null;
}

export interface Slot {
  startsAt: string;
  endsAt: string;
}

export type AppointmentKind = 'consultation' | 'follow_up' | 'imaging' | 'other';

export interface Appointment {
  id: string;
  patientId: string;
  patientName?: string;
  /** Only ever sent to an assistant, whose job is to ring the patient. */
  patientPhone?: string;
  doctorId: string;
  doctorName?: string;
  startsAt: string;
  endsAt: string;
  status: 'pending_payment' | 'authorised' | 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  kind: AppointmentKind;
  reason: string | null;
  notes: string | null;
  studyIds: string[];
}

/** A weekly opening-hours rule, in the clinic's own wall-clock time. */
export interface AvailabilityRule {
  id: string;
  doctorId: string;
  /** ISO-8601: 1 = Monday .. 7 = Sunday. */
  weekday: number;
  startTime: string;
  endTime: string;
  timezone: string;
  slotMinutes: number;
  validFrom: string;
  validUntil: string | null;
}

export interface AvailabilityWindow {
  id: string;
  doctorId: string;
  startsAt: string;
  endsAt: string;
  slotMinutes: number;
}

export interface ConsentTerms {
  version: string;
  locale: string;
  scope: string;
  body: string;
  contentHash: string;
}

export interface AuditEvent {
  id: string;
  occurredAt: string;
  actorUserId: string | null;
  action: string;
  outcome: 'allowed' | 'denied';
  resourceType: string | null;
}

// ---------------------------------------------------------------------------

export const api = {
  session: {
    me: () => apiFetch<SessionUser>('/auth/me'),
  },

  patients: {
    list: () => apiFetch<{ patients: Patient[] }>('/patients'),
    searchByPhone: (phone: string) =>
      apiFetch<{ candidates: Patient[] }>(`/patients/search?phone=${encodeURIComponent(phone)}`),
    getById: (id: string) => apiFetch<Patient>(`/patients/${id}`),
    create: (input: {
      phoneE164: string;
      fullName: string;
      dateOfBirth: string;
      sex: 'M' | 'F' | 'O';
      nationalId?: string;
      confirmedDistinctFrom?: string[];
    }) => apiFetch<CreatePatientResult>('/patients', { method: 'POST', body: input }),
    issueClaimToken: (id: string) =>
      apiFetch<{ status: 'sent'; expiresAt: string }>(`/patients/${id}/claim-token`, {
        method: 'POST',
      }),
    claim: (token: string) =>
      apiFetch<{ patientId: string }>('/patients/claim', { method: 'POST', body: { token } }),
  },

  imaging: {
    studiesForPatient: (patientId: string) =>
      apiFetch<{ studies: Study[] }>(`/studies?patientId=${encodeURIComponent(patientId)}`),
    studiesForAppointment: (appointmentId: string) =>
      apiFetch<{ studies: Study[] }>(
        `/studies?appointmentId=${encodeURIComponent(appointmentId)}`,
      ),
  },

  consent: {
    currentTerms: (locale: string) =>
      apiFetch<ConsentTerms>(`/consent/terms?locale=${encodeURIComponent(locale)}`),
    /**
     * Consent names the receiving doctor and echoes the exact text displayed.
     *
     * `grantedTo` is required by the API because consent is never open-ended —
     * a patient agrees to a NAMED doctor, which is what makes revocation
     * meaningful. `renderedText` is hashed server-side and compared against the
     * published wording, so a stale tab showing superseded terms is rejected
     * rather than filed as agreement to text the patient never saw.
     */
    grant: (input: {
      patientId: string;
      grantedTo: string;
      version: string;
      locale: string;
      renderedText: string;
    }) =>
      apiFetch<{ consentId: string; evidenceHash: string }>('/consent', {
        method: 'POST',
        body: input,
        idempotencyKey: newIdempotencyKey(),
      }),
    revoke: (consentId: string) =>
      apiFetch<void>(`/consent/${consentId}`, { method: 'DELETE' }),
    forPatient: (patientId: string) =>
      apiFetch<{ consents: { consentId: string; grantedTo: string; grantedAt: string }[] }>(
        `/consent?patientId=${encodeURIComponent(patientId)}`,
      ),
  },

  scheduling: {
    doctors: () => apiFetch<{ doctors: Doctor[] }>('/doctors'),
    openSlots: (doctorId: string, from: string, to: string) =>
      apiFetch<{ slots: Slot[] }>(
        `/doctors/${doctorId}/slots?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
    /**
     * `from`/`to` bound what comes back. The calendar asks for the week it is
     * showing rather than the whole history, which is also what keeps a busy
     * practice's agenda from growing without limit.
     */
    listAppointments: (range?: { from?: string; to?: string }) => {
      const q = new URLSearchParams();
      if (range?.from !== undefined) q.set('from', range.from);
      if (range?.to !== undefined) q.set('to', range.to);
      const suffix = q.toString() === '' ? '' : `?${q.toString()}`;
      return apiFetch<{ appointments: Appointment[] }>(`/appointments${suffix}`);
    },
    getAppointment: (id: string) => apiFetch<Appointment>(`/appointments/${id}`),
    book: (input: {
      patientId: string;
      doctorId: string;
      startsAt: string;
      endsAt: string;
      studyIds: string[];
      kind?: AppointmentKind;
      reason?: string;
      notes?: string;
    }) =>
      apiFetch<Appointment>('/appointments', {
        method: 'POST',
        body: input,
        // Double-tap on a bad link must not produce two appointments.
        idempotencyKey: newIdempotencyKey(),
      }),
    cancel: (id: string) => apiFetch<void>(`/appointments/${id}`, { method: 'DELETE' }),
    /** Accepting CAPTURES the held payment (D2) — see the billing controller. */
    accept: (id: string) =>
      apiFetch<{ status: string }>(`/appointments/${id}/accept`, {
        method: 'POST',
        idempotencyKey: newIdempotencyKey(),
      }),
    decline: (id: string) =>
      apiFetch<{ status: 'declined' }>(`/appointments/${id}/decline`, { method: 'POST' }),
    addAvailability: (input: {
      startsAt: string;
      endsAt: string;
      slotMinutes: number;
      doctorId?: string;
    }) => apiFetch<{ id: string }>('/availability', { method: 'POST', body: input }),
    listAvailability: (doctorId?: string) =>
      apiFetch<{ windows: AvailabilityWindow[] }>(
        doctorId === undefined ? '/availability' : `/availability?doctorId=${doctorId}`,
      ),

    // --- running the diary -------------------------------------------------

    /** Move an appointment. A taken slot answers 409, never a 500. */
    reschedule: (id: string, startsAt: string, endsAt: string) =>
      apiFetch<Appointment>(`/appointments/${id}/time`, {
        method: 'PATCH',
        body: { startsAt, endsAt },
      }),
    /** Scheduling detail only — never the time; that is `reschedule`. */
    updateAppointment: (
      id: string,
      patch: { kind?: AppointmentKind; reason?: string | null; notes?: string | null },
    ) => apiFetch<Appointment>(`/appointments/${id}`, { method: 'PATCH', body: patch }),
    complete: (id: string) =>
      apiFetch<{ status: string }>(`/appointments/${id}/complete`, { method: 'POST' }),
    noShow: (id: string) =>
      apiFetch<{ status: string }>(`/appointments/${id}/no-show`, { method: 'POST' }),
    /**
     * The practice cancelling, which is not `cancel` — that is the patient
     * withdrawing. The reason reaches the patient, so they can tell a clinic
     * closure from their own booking lapsing.
     */
    cancelAsDoctor: (id: string, reason?: string) =>
      apiFetch<{ status: string }>(`/appointments/${id}/cancel`, {
        method: 'POST',
        body: { ...(reason === undefined ? {} : { reason }) },
      }),

    // --- availability upkeep -----------------------------------------------

    withdrawAvailability: (id: string) =>
      apiFetch<void>(`/availability/${id}`, { method: 'DELETE' }),
    listRules: (doctorId?: string) =>
      apiFetch<{ rules: AvailabilityRule[] }>(
        doctorId === undefined ? '/availability/rules' : `/availability/rules?doctorId=${doctorId}`,
      ),
    addRule: (input: {
      weekday: number;
      startTime: string;
      endTime: string;
      timezone: string;
      slotMinutes?: number;
      doctorId?: string;
    }) =>
      apiFetch<{ id: string; generated: number }>('/availability/rules', {
        method: 'POST',
        body: input,
      }),
    withdrawRule: (id: string) =>
      apiFetch<void>(`/availability/rules/${id}`, { method: 'DELETE' }),
  },

  billing: {
    /**
     * Authorise, never capture. DECISION D2: the money is held when the
     * patient books and taken only when the doctor accepts, so a referral
     * nobody answers costs the patient nothing.
     */
    authorise: (appointmentId: string) =>
      apiFetch<{ status: string; clientSecret?: string }>(
        `/appointments/${appointmentId}/payment`,
        { method: 'POST', idempotencyKey: newIdempotencyKey() },
      ),
    status: (appointmentId: string) =>
      apiFetch<{ status: string; amountMinor: number | null; currency: string | null }>(
        `/appointments/${appointmentId}/payment`,
      ),
  },

  audit: {
    recent: (limit = 100) => apiFetch<{ events: AuditEvent[] }>(`/audit?limit=${limit}`),
  },

  /**
   * Sign-up and account self-service — brief §5.1.
   *
   * The three registration calls are UNAUTHENTICATED and every one of them
   * resolves with no body, whatever happened. That is not laziness: registered,
   * already-registered, and unknown must be indistinguishable, or the form
   * becomes an oracle for which clinicians have accounts here. A screen calling
   * these can only ever say "check your email".
   */
  account: {
    register: (input: RegistrationInput) =>
      apiFetch<void>('/auth/register', { method: 'POST', body: input }),
    verifyEmail: (email: string, code: string) =>
      apiFetch<void>('/auth/verify-email', { method: 'POST', body: { email, code } }),
    resendCode: (email: string, locale: string) =>
      apiFetch<void>('/auth/resend-code', { method: 'POST', body: { email, locale } }),

    profile: () => apiFetch<UserProfile>('/auth/profile'),
    updateProfile: (input: UpdateProfileInput) =>
      apiFetch<UserProfile>('/auth/profile', { method: 'PATCH', body: input }),

    preferences: () => apiFetch<UserPreferences>('/auth/preferences'),
    /** PUT, not PATCH: the settings screen owns the whole object. */
    savePreferences: (next: UserPreferences) =>
      apiFetch<UserPreferences>('/auth/preferences', { method: 'PUT', body: next }),
  },

  /** Organisations and seats — brief §3, §5.5. */
  organisations: {
    /** `organisation: null` is a normal state for an applicant who has not applied. */
    mine: () => apiFetch<{ organisation: Organisation | null }>('/organisations/mine'),
    create: (input: {
      kind: Organisation['kind'];
      legalName: string;
      corridorId: string;
      side: Organisation['side'];
      credentials: Record<string, unknown>;
      seatCount: number;
    }) => apiFetch<Organisation>('/organisations', { method: 'POST', body: input }),
    members: (id: string) =>
      apiFetch<{ members: Membership[] }>(`/organisations/${id}/members`),
    /**
     * The organisation's clinicians and their specialties — who an appointment
     * can be routed TO. Distinct from `members`, which lists seats.
     */
    clinicians: (id: string) =>
      apiFetch<{ clinicians: Clinician[] }>(`/organisations/${id}/clinicians`),
    invite: (id: string, input: InviteMemberInput) =>
      apiFetch<void>(`/organisations/${id}/invitations`, { method: 'POST', body: input }),
    acceptInvitation: (token: string) =>
      apiFetch<Organisation>('/invitations/accept', { method: 'POST', body: { token } }),

    // --- ops (§5.8) --------------------------------------------------------
    queue: () => apiFetch<{ organisations: Organisation[] }>('/admin/organisations'),
    /**
     * Ops decides WHETHER to approve, never what approving grants — the role
     * is derived server-side from the organisation's own corridor and side.
     * There is deliberately no role field here to pass.
     */
    decide: (id: string, approve: boolean, reasonKey?: string) =>
      apiFetch<void>(`/admin/organisations/${id}/decision`, {
        method: 'POST',
        body: { approve, reasonKey },
      }),
  },

  /** Plans — brief §2, §5.7. */
  plans: {
    /** Public: the pricing page is served to visitors with no session. */
    catalogue: () => apiFetch<{ plans: PlanTier[] }>('/plans'),
    mine: () =>
      apiFetch<{ subscription: Subscription | null; usage: PlanUsage }>('/subscriptions/mine'),
    /**
     * Records an INTENT to be on a tier. It takes no money — no payment rail is
     * wired while blocking item L7 is open — and the screen says so.
     */
    change: (planCode: PlanCode) =>
      apiFetch<void>('/subscriptions', { method: 'POST', body: { planCode } }),
  },
};
