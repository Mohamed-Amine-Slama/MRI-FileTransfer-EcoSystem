/**
 * Burned-in identifier gate — spec 2026-09-08, decision S3.
 *
 * Identifiers are not only in the header. A scanned film, an ultrasound
 * capture or a screenshot can carry the patient's name in the PIXELS, where
 * tag stripping does nothing at all. The de-identified twin strips the header
 * perfectly and still ships the name if it was drawn into the image.
 *
 * WHY THE TAG AND NOT OCR. OCR on ingest was considered and rejected: it costs
 * real money and latency on studies already measured in hundreds of megabytes
 * over a constrained link, adds an ML dependency to a zero-tolerance path, and
 * false-positives on anatomical labels and scanner overlays — which would
 * refuse legitimate clinical work. This gate is deterministic and testable
 * instead, and it fails CLOSED on the modalities where burned-in text actually
 * happens.
 *
 * WHAT IT ACCEPTS. A mislabelled CT slips through. That is the known cost of
 * S3 and it is small: CT and MR come off a scanner that effectively never
 * burns text into the image. The risk lives in secondary capture, which is
 * exactly what RISKY_MODALITIES names.
 */

/**
 * Where burned-in text actually occurs.
 *
 *   US — ultrasound, routinely annotated on the machine
 *   SC — secondary capture, i.e. a screenshot of something else
 *   XC — external camera capture, typically a photograph of a film
 *   OT — "other", which in practice means a scan of paper
 */
const RISKY_MODALITIES = new Set(['US', 'XC', 'OT', 'SC']);

export type ReleaseDecision = 'processing' | 'quarantined';

export function decideRelease(header: {
  modality: string;
  burnedInAnnotation: string | undefined;
}): ReleaseDecision {
  const declared = header.burnedInAnnotation?.trim().toUpperCase();

  if (declared === 'YES') return 'quarantined';
  if (declared === 'NO') return 'processing';

  // Absent, or a value outside the DICOM vocabulary. Both tell us nothing, and
  // "nothing" on this question must not read as "no". Trust the modality
  // instead: proceed on a scanner modality, refuse where the risk is real.
  return RISKY_MODALITIES.has(header.modality.trim().toUpperCase())
    ? 'quarantined'
    : 'processing';
}
