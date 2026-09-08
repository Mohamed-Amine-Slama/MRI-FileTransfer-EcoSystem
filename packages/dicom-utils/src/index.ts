import { createHash } from 'node:crypto';
import dicomParser from 'dicom-parser';

/**
 * DICOM validation and header parsing — BUILD_SPEC P6.1.
 *
 * TWO RULES THAT SHAPE EVERYTHING HERE:
 *
 * 1. Never trust PatientName/PatientID from the file for record linkage.
 *    The doctor's chosen patient record is authoritative. File tags are
 *    metadata, and they are frequently wrong: CD exports carry the previous
 *    patient's demographics, scanner worklists get mistyped, and anonymisers
 *    overwrite fields inconsistently. Linking on them merges two people.
 *
 * 2. Never re-encode pixel data (ADR-4, ADR-5). Nothing in this module writes
 *    or transforms an image. It reads tags and computes hashes.
 */

// ---------------------------------------------------------------------------
// Transfer syntaxes
// ---------------------------------------------------------------------------

/**
 * Lossy transfer syntaxes. Flag on ingest, warn in the UI, do NOT reject
 * (P6.1) — the file is what the clinic has, and refusing it strands the
 * referral. But the receiving doctor must know the pixel data has already lost
 * information before they rely on it.
 */
const LOSSY_TRANSFER_SYNTAXES = new Set([
  '1.2.840.10008.1.2.4.50', // JPEG Baseline (Process 1)
  '1.2.840.10008.1.2.4.51', // JPEG Extended (Process 2 & 4)
  '1.2.840.10008.1.2.4.53', // JPEG Full Progression, non-hierarchical
  '1.2.840.10008.1.2.4.55', // JPEG Full Progression, hierarchical
  '1.2.840.10008.1.2.4.81', // JPEG-LS Lossy (Near-Lossless)
  '1.2.840.10008.1.2.4.91', // JPEG 2000 (lossy-capable)
  '1.2.840.10008.1.2.4.93', // JPEG 2000 Part 2 Multi-component (lossy-capable)
  '1.2.840.10008.1.2.4.100', // MPEG2 Main Profile / Main Level
  '1.2.840.10008.1.2.4.101', // MPEG2 Main Profile / High Level
  '1.2.840.10008.1.2.4.102', // MPEG-4 AVC/H.264 High Profile
  '1.2.840.10008.1.2.4.103', // MPEG-4 AVC/H.264 BD-compatible
  '1.2.840.10008.1.2.4.104', // MPEG-4 AVC/H.264 2D video
  '1.2.840.10008.1.2.4.105', // MPEG-4 AVC/H.264 3D video
  '1.2.840.10008.1.2.4.106', // MPEG-4 AVC/H.264 stereo
  '1.2.840.10008.1.2.4.107', // HEVC/H.265 Main Profile
  '1.2.840.10008.1.2.4.108', // HEVC/H.265 Main 10 Profile
]);

export function isLossyTransferSyntax(uid: string | undefined): boolean {
  if (uid === undefined) return false;
  return LOSSY_TRANSFER_SYNTAXES.has(uid.trim());
}

// ---------------------------------------------------------------------------
// Rejection reasons
// ---------------------------------------------------------------------------

/**
 * Why a file was rejected. These are NOT interchangeable, and the distinction
 * is the point (P6.1):
 *
 *   `not_dicom`            — failed the magic-byte check. Wrong file entirely;
 *                            someone dragged in a PDF or a photo.
 *   `no_preamble`          — a real DICOM dataset with no 128-byte preamble.
 *                            Some legacy scanners emit these. Logged
 *                            separately so we can measure whether real Libyan
 *                            clinics actually hit it before deciding whether
 *                            to loosen the rule. Loosening it blind would
 *                            weaken the only cheap format check we have.
 *   `malformed`            — passed the magic-byte check, failed to parse.
 *                            Truncated or corrupt transfer.
 *   `missing_required_tag` — parsed, but lacks a UID we cannot proceed without.
 */
export type RejectionReason =
  | 'not_dicom'
  | 'no_preamble'
  | 'malformed'
  | 'missing_required_tag';

export class DicomValidationError extends Error {
  constructor(
    public readonly reason: RejectionReason,
    message: string,
  ) {
    super(message);
    this.name = 'DicomValidationError';
  }
}

// ---------------------------------------------------------------------------
// Magic bytes
// ---------------------------------------------------------------------------

const PREAMBLE_LENGTH = 128;
const MAGIC = 'DICM';

/**
 * True when the buffer carries the 128-byte preamble followed by 'DICM'.
 *
 * This is a cheap structural check, not a validity guarantee: a file can pass
 * this and still be unparseable (fixture 04). It exists to reject the wrong
 * *kind* of file quickly, before spending parse time on it.
 */
export function isDicom(buffer: Uint8Array): boolean {
  if (buffer.length < PREAMBLE_LENGTH + MAGIC.length) return false;
  return (
    buffer[128] === 0x44 && // D
    buffer[129] === 0x49 && // I
    buffer[130] === 0x43 && // C
    buffer[131] === 0x4d //   M
  );
}

/**
 * Distinguishes "not DICOM at all" from "DICOM without a preamble".
 *
 * A dataset with no preamble typically starts with the file-meta group tag
 * (0002,0000) or, for raw datasets, a low group number. Detecting this is
 * heuristic by nature — which is exactly why such files are still rejected,
 * just with a reason that can be counted.
 */
function looksLikeHeaderlessDicom(buffer: Uint8Array): boolean {
  if (buffer.length < 8) return false;
  const group = (buffer[1] ?? 0xff) << 8 | (buffer[0] ?? 0xff);
  // Group 0x0002 (file meta) or 0x0008 (identifying) at offset 0.
  return group === 0x0002 || group === 0x0008;
}

// ---------------------------------------------------------------------------
// Header parsing
// ---------------------------------------------------------------------------

export interface DicomHeader {
  studyInstanceUID: string;
  seriesInstanceUID: string;
  sopInstanceUID: string;
  modality: string;
  studyDate: string | undefined;
  /**
   * PatientID as written in the FILE. Metadata only — never use this to decide
   * which patient record a study belongs to (P6.1). Retained so a mismatch
   * against the chosen record can be surfaced for human review.
   */
  patientIdInFile: string | undefined;
  /**
   * BurnedInAnnotation (0028,0301) — 'YES', 'NO', or absent.
   *
   * Whether the patient's identity is drawn into the PIXELS, where no amount
   * of tag stripping reaches it. Absent is common and is NOT the same as 'NO':
   * see the burned-in gate in the imaging module for how the two differ.
   */
  burnedInAnnotation: string | undefined;
  transferSyntaxUID: string | undefined;
  isLossy: boolean;
}

/** DICOM tag keys as dicom-parser expects them. */
const TAG = {
  transferSyntax: 'x00020010',
  sopInstanceUID: 'x00080018',
  studyDate: 'x00080020',
  modality: 'x00080060',
  patientId: 'x00100020',
  burnedInAnnotation: 'x00280301',
  studyInstanceUID: 'x0020000d',
  seriesInstanceUID: 'x0020000e',
} as const;

/**
 * Parse the header of a DICOM file.
 *
 * Reads tags only — pixel data is never decoded, and the buffer is never
 * modified (ADR-4).
 *
 * @throws {DicomValidationError} with a specific reason. Callers must treat
 *   the reason as meaningful: `no_preamble` is a metric to watch, `malformed`
 *   is a failed transfer to retry, `not_dicom` is user error.
 */
export function readHeader(buffer: Uint8Array): DicomHeader {
  if (!isDicom(buffer)) {
    if (looksLikeHeaderlessDicom(buffer)) {
      throw new DicomValidationError(
        'no_preamble',
        'File appears to be DICOM but has no 128-byte preamble or DICM magic. ' +
          'Rejected; recorded as rejected_no_preamble.',
      );
    }
    throw new DicomValidationError(
      'not_dicom',
      'File does not begin with a 128-byte preamble followed by DICM.',
    );
  }

  let dataSet: dicomParser.DataSet;
  try {
    dataSet = dicomParser.parseDicom(buffer);
  } catch (err) {
    throw new DicomValidationError(
      'malformed',
      `File has valid DICM magic but could not be parsed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const studyInstanceUID = dataSet.string(TAG.studyInstanceUID);
  const seriesInstanceUID = dataSet.string(TAG.seriesInstanceUID);
  const sopInstanceUID = dataSet.string(TAG.sopInstanceUID);
  const modality = dataSet.string(TAG.modality);

  // These four identify the image within the study hierarchy. Without them the
  // file cannot be filed, deduplicated, or retrieved — there is no sensible
  // default, so this is a rejection rather than a guess.
  const missing: string[] = [];
  if (isBlank(studyInstanceUID)) missing.push('StudyInstanceUID (0020,000D)');
  if (isBlank(seriesInstanceUID)) missing.push('SeriesInstanceUID (0020,000E)');
  if (isBlank(sopInstanceUID)) missing.push('SOPInstanceUID (0008,0018)');
  if (isBlank(modality)) missing.push('Modality (0008,0060)');

  if (missing.length > 0) {
    throw new DicomValidationError(
      'missing_required_tag',
      `File is missing required tag(s): ${missing.join(', ')}`,
    );
  }

  const transferSyntaxUID = emptyToUndefined(dataSet.string(TAG.transferSyntax));

  return {
    // Non-null assertions are safe here only because isBlank() was checked above.
    studyInstanceUID: (studyInstanceUID as string).trim(),
    seriesInstanceUID: (seriesInstanceUID as string).trim(),
    sopInstanceUID: (sopInstanceUID as string).trim(),
    modality: (modality as string).trim(),
    studyDate: emptyToUndefined(dataSet.string(TAG.studyDate)),
    patientIdInFile: emptyToUndefined(dataSet.string(TAG.patientId)),
    burnedInAnnotation: emptyToUndefined(dataSet.string(TAG.burnedInAnnotation)),
    transferSyntaxUID,
    isLossy: isLossyTransferSyntax(transferSyntaxUID),
  };
}

function isBlank(v: string | undefined): boolean {
  return v === undefined || v.trim() === '';
}

function emptyToUndefined(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

// ---------------------------------------------------------------------------
// Integrity
// ---------------------------------------------------------------------------

/**
 * Content hash used for end-to-end upload integrity (P7.2) and stored on
 * `imaging_instances.sha256` (P3.1).
 *
 * Computed over the ORIGINAL bytes, never over a re-encoded or normalised
 * form (ADR-4). If this hash and the client's disagree, the transfer is
 * rejected — we do not "repair" the file.
 */
export function sha256(buffer: Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex');
}

// ---------------------------------------------------------------------------
// Validation result — the shape the ingestion pipeline (P7.4) consumes
// ---------------------------------------------------------------------------

export type ValidationResult =
  | { ok: true; header: DicomHeader; sha256: string }
  | { ok: false; reason: RejectionReason; message: string };

/**
 * Validate a single file without throwing.
 *
 * The ingestion pipeline processes hundreds of files per study and must record
 * a per-file outcome rather than abort the batch on the first bad byte.
 */
export function validate(buffer: Uint8Array): ValidationResult {
  try {
    const header = readHeader(buffer);
    return { ok: true, header, sha256: sha256(buffer) };
  } catch (err) {
    if (err instanceof DicomValidationError) {
      return { ok: false, reason: err.reason, message: err.message };
    }
    throw err;
  }
}
