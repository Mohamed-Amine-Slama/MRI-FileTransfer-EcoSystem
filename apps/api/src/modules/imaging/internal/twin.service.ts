/**
 * The de-identified twin — spec 2026-09-08, decision S2.
 *
 * A second copy of every study with the patient stripped out of it. The
 * receiving doctor reads ONLY the twin; the original is never on a path they
 * can reach.
 *
 * WHY A TWIN RATHER THAN FILTERING AT READ TIME. Filtering is cheaper — no
 * duplicate storage, no UID remapping, and a policy change applies instantly.
 * It was rejected because it puts the identifiers one proxy bug away from a
 * doctor, and §8 of the requirements calls this a zero-tolerance surface. With
 * a twin, the bytes reachable from the doctor's routes simply do not contain a
 * name, so a mistake in the proxy is a broken image rather than a disclosure.
 *
 * WHY ORTHANC DOES THE WORK. ADR-3: do not hand-roll DICOM manipulation. A tag
 * rewriter over a stream is exactly that, and it is the kind of code whose bugs
 * are silent. `POST /studies/{id}/anonymize` implements the PS3.15 Annex E
 * basic profile, allocates fresh UIDs, and persists the result as its own
 * resource — verified against Orthanc 24.10.1, which returns the new study's
 * Orthanc id and reports FailedInstancesCount.
 *
 * ADR-4 IS NOT VIOLATED. The original bytes are untouched; the twin is a
 * derived artifact, which is exactly the category ADR-4 permits.
 */

/** Ages above 89 identify individuals in a small population (Safe Harbor). */
const MAX_AGE_YEARS = 90;

/**
 * DICOM's Age String (VR "AS") is exactly four characters: three digits and a
 * unit. '45Y' is malformed and some viewers drop it silently.
 */
export function dicomAge(years: number): string {
  const bounded = Math.min(MAX_AGE_YEARS, Math.max(0, Math.trunc(years)));
  return `${String(bounded).padStart(3, '0')}Y`;
}

export interface AnonymisationRequest {
  Keep: string[];
  Replace: Record<string, string>;
  KeepPrivateTags: boolean;
}

/**
 * The tag policy. PS3.15 Annex E basic profile, with three deliberate
 * deviations — all recorded in the spec so they are reviewable rather than
 * discovered:
 *
 *  1. PatientAge is SET, not stripped. It is the only way the doctor learns the
 *     age at all, and an age is a clinical fact where a birth date is an
 *     identifier.
 *  2. PatientSex is kept. It changes how imaging is read.
 *  3. StudyDate is kept, which the basic profile strips. How recent a scan is
 *     changes how it is read, and the patient is already pseudonymous behind a
 *     fresh UID. This one is flagged for counsel alongside L9.
 *
 * NOT kept, deliberately: StudyDescription and SeriesDescription. They are
 * operator-typed free text and routinely contain the patient's name. The
 * clinical context the doctor needs arrives as the case's `reason`, which is
 * authored inside the platform.
 */
export function anonymisationRequest(brief: {
  ageYears: number;
  sex: string;
}): AnonymisationRequest {
  return {
    Keep: ['StudyDate', 'PatientSex', 'Modality', 'BodyPartExamined'],
    Replace: { PatientAge: dicomAge(brief.ageYears) },
    KeepPrivateTags: false,
  };
}
