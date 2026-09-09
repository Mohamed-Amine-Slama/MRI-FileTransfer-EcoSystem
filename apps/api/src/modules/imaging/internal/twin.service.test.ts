import { describe, expect, it } from 'vitest';
import { anonymisationRequest, dicomAge } from './twin.service';

describe('dicomAge', () => {
  it('formats as three digits and a Y, which is the DICOM AS value representation', () => {
    expect(dicomAge(45)).toBe('045Y');
    expect(dicomAge(7)).toBe('007Y');
  });

  it('caps at 90 — above 89 an age identifies individuals in a small population', () => {
    expect(dicomAge(104)).toBe('090Y');
    expect(dicomAge(90)).toBe('090Y');
  });

  it('floors at zero rather than emitting a negative age', () => {
    expect(dicomAge(-3)).toBe('000Y');
  });
});

describe('anonymisationRequest', () => {
  it('keeps what the read needs', () => {
    const req = anonymisationRequest({ ageYears: 62, sex: 'F' });
    expect(req.Keep).toContain('StudyDate');
    expect(req.Keep).toContain('PatientSex');
    expect(req.KeepPrivateTags).toBe(false);
  });

  it('sets the age rather than stripping it', () => {
    expect(anonymisationRequest({ ageYears: 62, sex: 'F' }).Replace['PatientAge']).toBe('062Y');
  });

  it('never keeps or preserves a patient identifier', () => {
    const req = anonymisationRequest({ ageYears: 40, sex: 'M' });
    for (const tag of [
      'PatientName',
      'PatientID',
      'PatientBirthDate',
      'OtherPatientIDs',
      'PatientAddress',
      'PatientTelephoneNumbers',
      'ReferringPhysicianName',
      'AccessionNumber',
    ]) {
      expect(req.Keep, tag).not.toContain(tag);
      expect(req.Replace, tag).not.toHaveProperty(tag);
    }
  });

  it('does not keep the free-text description fields', () => {
    // StudyDescription and SeriesDescription are operator-typed and routinely
    // carry a patient's name. The clinical context a doctor needs comes from
    // the case's `reason`, which is authored in the platform and validated.
    const req = anonymisationRequest({ ageYears: 30, sex: 'O' });
    expect(req.Keep).not.toContain('StudyDescription');
    expect(req.Keep).not.toContain('SeriesDescription');
  });
});
