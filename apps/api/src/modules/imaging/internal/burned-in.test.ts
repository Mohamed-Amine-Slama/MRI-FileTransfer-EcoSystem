import { describe, expect, it } from 'vitest';
import { decideRelease } from './burned-in';

describe('burned-in annotation gate', () => {
  it('quarantines when the tag says YES', () => {
    expect(decideRelease({ modality: 'CT', burnedInAnnotation: 'YES' })).toBe('quarantined');
  });

  it('quarantines a risky modality when the tag is absent', () => {
    for (const modality of ['US', 'XC', 'OT', 'SC']) {
      expect(decideRelease({ modality, burnedInAnnotation: undefined })).toBe('quarantined');
    }
  });

  it('releases a CT with no tag — a scanner effectively never burns text in', () => {
    expect(decideRelease({ modality: 'CT', burnedInAnnotation: undefined })).toBe('processing');
  });

  it('releases a risky modality that explicitly says NO', () => {
    expect(decideRelease({ modality: 'US', burnedInAnnotation: 'NO' })).toBe('processing');
  });

  it('is not fooled by case or padding', () => {
    expect(decideRelease({ modality: 'ct', burnedInAnnotation: ' yes ' })).toBe('quarantined');
    expect(decideRelease({ modality: ' us ', burnedInAnnotation: undefined })).toBe('quarantined');
  });

  it('quarantines an unrecognised value rather than trusting it', () => {
    // A scanner writing something outside the DICOM vocabulary tells us
    // nothing, and "nothing" on this question must not read as "no".
    expect(decideRelease({ modality: 'US', burnedInAnnotation: 'MAYBE' })).toBe('quarantined');
  });
});
