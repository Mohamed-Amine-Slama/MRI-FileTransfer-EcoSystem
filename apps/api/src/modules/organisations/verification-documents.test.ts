import { describe, expect, it } from 'vitest';
import { matchesContentType } from './internal/organisations.service';

describe('matchesContentType', () => {
  const pdf = Buffer.from('%PDF-1.7\n');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

  it('accepts a file whose bytes match its declared type', () => {
    expect(matchesContentType('application/pdf', pdf)).toBe(true);
    expect(matchesContentType('image/png', png)).toBe(true);
    expect(matchesContentType('image/jpeg', jpeg)).toBe(true);
  });

  it('refuses a relabelled file, an unknown type, and a truncated body', () => {
    expect(matchesContentType('image/png', Buffer.from('<html><script>'))).toBe(false);
    expect(matchesContentType('application/pdf', png)).toBe(false);
    expect(matchesContentType('text/html', pdf)).toBe(false);
    expect(matchesContentType('image/jpeg', Buffer.from([0xff]))).toBe(false);
  });
});
