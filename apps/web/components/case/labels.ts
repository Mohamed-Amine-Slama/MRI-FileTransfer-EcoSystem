import {
  isTerminalStatus,
  toMajorUnits,
  type CaseSide,
  type CaseStatus,
  type FileAccessAction,
  type FileRejectionKey,
  type Money,
  type PaymentStatus,
  type ProviderKind,
  type Role,
  type VerificationStatus,
} from '@mir/contracts';
import { sideForRole } from '../../lib/corridor/registry';
import type { Dictionary } from '../../lib/i18n/dictionary';

/**
 * Enum-to-label maps, in one place.
 *
 * §5.3 requires status labels be shown "consistently across provider and admin
 * views". These are exhaustive `Record`s rather than switch statements or
 * lookups with a fallback, so adding a status to the contract is a compile
 * error here rather than a screen that quietly renders a raw enum value like
 * `under_review` to a clinic receptionist.
 */

export function caseStatusLabel(t: Dictionary, status: CaseStatus): string {
  const labels: Record<CaseStatus, string> = {
    submitted: t.caseStatusSubmitted,
    under_review: t.caseStatusUnderReview,
    matched: t.caseStatusMatched,
    in_progress: t.caseStatusInProgress,
    completed: t.caseStatusCompleted,
    rejected: t.caseStatusRejected,
    cancelled: t.caseStatusCancelled,
  };
  return labels[status];
}

/**
 * Mirrors the (unexported) Tone union in components/ui. `undefined` is the
 * neutral default Badge and Alert already render, so a neutral state is
 * expressed by having no tone rather than by inventing one.
 */
export type Tone = 'info' | 'warning' | 'danger' | 'success';

export function caseStatusTone(status: CaseStatus): Tone | undefined {
  const tones: Record<CaseStatus, Tone | undefined> = {
    submitted: undefined,
    under_review: 'info',
    matched: 'info',
    in_progress: 'warning',
    completed: 'success',
    rejected: 'danger',
    cancelled: undefined,
  };
  return tones[status];
}

export function sideLabel(t: Dictionary, side: CaseSide): string {
  const labels: Record<CaseSide, string> = {
    source: t.sideSource,
    destination: t.sideDestination,
    ops: t.sideOps,
  };
  return labels[side];
}

/**
 * What to call the signed-in user's role.
 *
 * NAMED BY CORRIDOR SIDE, NOT BY ROLE (§4.3). The obvious implementation is an
 * exhaustive `Record<Role, string>` mapping each country-specific role to a
 * label naming its country, and that is what this replaced. It read better and
 * it was wrong the moment a second corridor existed: a referrer in a newly
 * configured corridor would have been greeted by the first corridor's country
 * name, and the fix would have been a sweep rather than a config entry.
 *
 * Two roles play no corridor side and are named directly. `patient` is not a
 * party to a referral at all (see `resolveSide`), and `applicant` has not been
 * granted a side yet — that is the whole meaning of the role.
 */
export function roleLabel(t: Dictionary, role: Role): string {
  const direct: Partial<Record<Role, string>> = {
    applicant: t.roleApplicant,
  };
  const named = direct[role];
  if (named !== undefined) return named;

  const side = sideForRole(role);
  // Only reachable for a role no configured corridor plays, which is a
  // configuration error rather than a state to invent a label for.
  return side === null ? t.none : sideLabel(t, side);
}

export function verificationLabel(t: Dictionary, status: VerificationStatus): string {
  const labels: Record<VerificationStatus, string> = {
    pending: t.verificationPending,
    approved: t.verificationApproved,
    rejected: t.verificationRejected,
  };
  return labels[status];
}

export function verificationTone(status: VerificationStatus): Tone {
  const tones: Record<VerificationStatus, Tone> = {
    pending: 'warning',
    approved: 'success',
    rejected: 'danger',
  };
  return tones[status];
}

export function providerKindLabel(t: Dictionary, kind: ProviderKind): string {
  const labels: Record<ProviderKind, string> = {
    clinic: t.signUpKindClinic,
    hospital: t.signUpKindHospital,
    laboratory: t.signUpKindLaboratory,
    doctor: t.signUpKindDoctor,
  };
  return labels[kind];
}

export function paymentStatusLabel(t: Dictionary, status: PaymentStatus): string {
  const labels: Record<PaymentStatus, string> = {
    paid: t.payStatusPaid,
    pending: t.payStatusPending,
    overdue: t.payStatusOverdue,
  };
  return labels[status];
}

export function paymentStatusTone(status: PaymentStatus): Tone {
  const tones: Record<PaymentStatus, Tone> = {
    paid: 'success',
    pending: 'warning',
    overdue: 'danger',
  };
  return tones[status];
}

/**
 * What the viewer is expected to do next — brief §5.3 P1.
 *
 * Keyed by status AND by which side is asking, because the same case demands
 * different things of the two parties: while the referring clinic is uploading
 * imaging, the receiving clinic is waiting, and telling both "upload the
 * imaging" would be worse than saying nothing.
 *
 * WHY A KEY AND NOT A STRING. The workspace (§5.5) has to decide which cases
 * are waiting on the viewer. Deriving that by comparing a rendered label
 * against the rendered word for "nothing" would make a clinic's task list
 * depend on translated copy — a French string that happened to match, or a
 * reworded Arabic entry, would silently change which cases appear as work.
 * The decision is made on this enum instead, and the label is a projection of
 * it. `isAwaitingSide` and `nextActionLabel` therefore cannot disagree.
 */
export type NextActionKey =
  | 'uploadFiles'
  | 'awaitReview'
  | 'awaitMatch'
  | 'schedule'
  | 'none';

export function nextActionKey(status: CaseStatus, side: CaseSide): NextActionKey {
  if (side === 'ops') {
    // Ops is not a party to the case. The one thing waiting on them is a
    // newly submitted case nobody has triaged.
    return status === 'submitted' ? 'awaitReview' : 'none';
  }
  if (side === 'source') {
    const bySource: Record<CaseStatus, NextActionKey> = {
      submitted: 'uploadFiles',
      under_review: 'awaitReview',
      matched: 'awaitMatch',
      in_progress: 'none',
      completed: 'none',
      rejected: 'none',
      cancelled: 'none',
    };
    return bySource[status];
  }
  const byDestination: Record<CaseStatus, NextActionKey> = {
    submitted: 'none',
    under_review: 'none',
    matched: 'schedule',
    in_progress: 'schedule',
    completed: 'none',
    rejected: 'none',
    cancelled: 'none',
  };
  return byDestination[status];
}

export function nextActionLabel(t: Dictionary, status: CaseStatus, side: CaseSide): string {
  const labels: Record<NextActionKey, string> = {
    uploadFiles: t.nextActionUploadFiles,
    awaitReview: t.nextActionAwaitReview,
    awaitMatch: t.nextActionAwaitMatch,
    schedule: t.nextActionSchedule,
    none: t.nextActionNone,
  };
  return labels[nextActionKey(status, side)];
}

/**
 * Whether this case is waiting on the given side — the §5.5 task rule.
 *
 * A terminal case is never a task even if a table above still names an action,
 * so a cancelled case cannot linger on a clinic's to-do list.
 */
export function isAwaitingSide(status: CaseStatus, side: CaseSide): boolean {
  if (isTerminalStatus(status)) return false;
  return nextActionKey(status, side) !== 'none';
}

/**
 * Minor units to a localised amount. Never floats until the final format.
 *
 * Takes a `Money` rather than a loose number-and-string pair so the exponent
 * cannot be applied by hand at a call site: TND and LYD are three-decimal
 * currencies, and `amountMinor / 100` is wrong for both.
 */
export function formatMoney(locale: string, money: Money): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: money.currency }).format(
    toMajorUnits(money),
  );
}

/**
 * The dictionary keys a verification may be rejected with — brief §5.1.
 *
 * A rejection reason travels as a KEY and never as prose, so an Arabic-speaking
 * applicant is not shown an English sentence typed by an ops reviewer. This
 * list is the set an admin may choose from, and `verificationReasonLabel`
 * resolves one for display.
 */
export const REJECTION_REASON_KEYS = [
  'verificationReasonLicenceExpired',
  'verificationReasonDocumentsUnclear',
  'verificationReasonNotRecognised',
] as const;
export type RejectionReasonKey = (typeof REJECTION_REASON_KEYS)[number];

export function isRejectionReasonKey(key: string): key is RejectionReasonKey {
  return (REJECTION_REASON_KEYS as readonly string[]).includes(key);
}

/**
 * Returns null for an unrecognised key rather than echoing it. A raw key like
 * `verificationReasonFoo` on screen would tell an applicant nothing; the caller
 * renders the generic rejection copy instead.
 */
export function verificationReasonLabel(t: Dictionary, key: string | undefined): string | null {
  if (key === undefined || !isRejectionReasonKey(key)) return null;
  const labels: Record<RejectionReasonKey, string> = {
    verificationReasonLicenceExpired: t.verificationReasonLicenceExpired,
    verificationReasonDocumentsUnclear: t.verificationReasonDocumentsUnclear,
    verificationReasonNotRecognised: t.verificationReasonNotRecognised,
  };
  return labels[key];
}

export function fileAccessActionLabel(t: Dictionary, action: FileAccessAction): string {
  const labels: Record<FileAccessAction, string> = {
    uploaded: t.accessUploaded,
    viewed: t.accessViewed,
    downloaded: t.accessDownloaded,
    replaced: t.accessReplaced,
  };
  return labels[action];
}

/**
 * The §4.4 line: "last accessed by Dr. X on [date]".
 *
 * Assembled here rather than in JSX so the ORDER of the three parts is a
 * translation concern and not a layout one — Arabic and French put the actor
 * and the verb in different places, and a template built out of JSX fragments
 * cannot be reordered by a translator.
 */
export function fileRejectionLabel(t: Dictionary, key: FileRejectionKey): string {
  const labels: Record<FileRejectionKey, string> = {
    fileTypeNotAllowed: t.fileTypeNotAllowed,
    fileTooLarge: t.fileTooLarge,
    fileEmpty: t.fileEmpty,
  };
  return labels[key];
}
