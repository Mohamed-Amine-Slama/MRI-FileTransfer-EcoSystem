import { describe, expect, it } from 'vitest';
import { STALE_AFTER_MS, isSameLocalDay, isStale, isWithinDays, relativeAge } from './time';

const NOW = Date.parse('2026-09-25T12:00:00Z');
const ago = (ms: number): string => new Date(NOW - ms).toISOString();
const H = 60 * 60 * 1000;

describe('isStale', () => {
  it('is false for a case updated recently', () => {
    expect(isStale({ status: 'paid', updatedAt: ago(2 * H) }, NOW)).toBe(false);
  });
  it('is true past 48 hours', () => {
    expect(isStale({ status: 'paid', updatedAt: ago(49 * H) }, NOW)).toBe(true);
  });
  it('is false at exactly 48 hours', () => {
    expect(isStale({ status: 'paid', updatedAt: ago(STALE_AFTER_MS) }, NOW)).toBe(false);
  });
  it('is never true for a finished case', () => {
    expect(isStale({ status: 'closed', updatedAt: ago(500 * H) }, NOW)).toBe(false);
  });
  it('is false for an unparseable timestamp', () => {
    expect(isStale({ status: 'paid', updatedAt: '' }, NOW)).toBe(false);
  });
});

describe('isWithinDays', () => {
  it('counts an instant inside the window', () => {
    expect(isWithinDays(ago(6 * 24 * H), 7, NOW)).toBe(true);
  });
  it('excludes an instant outside the window', () => {
    expect(isWithinDays(ago(8 * 24 * H), 7, NOW)).toBe(false);
  });
  it('is false for null, undefined and garbage', () => {
    expect(isWithinDays(null, 7, NOW)).toBe(false);
    expect(isWithinDays(undefined, 7, NOW)).toBe(false);
    expect(isWithinDays('not a date', 7, NOW)).toBe(false);
  });
});

describe('isSameLocalDay', () => {
  it('matches the same calendar day', () => {
    expect(isSameLocalDay(new Date(NOW - 60_000).toISOString(), NOW)).toBe(true);
  });
  it('rejects two days ago', () => {
    expect(isSameLocalDay(ago(48 * H), NOW)).toBe(false);
  });
});

describe('relativeAge', () => {
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' });
  it('uses minutes under an hour', () => {
    expect(relativeAge(ago(30 * 60_000), NOW, 'en')).toBe(rtf.format(-30, 'minute'));
  });
  it('uses hours under a day', () => {
    expect(relativeAge(ago(5 * H), NOW, 'en')).toBe(rtf.format(-5, 'hour'));
  });
  it('uses days beyond that', () => {
    expect(relativeAge(ago(72 * H), NOW, 'en')).toBe(rtf.format(-3, 'day'));
  });
  it('renders a dash for an unparseable timestamp', () => {
    expect(relativeAge('', NOW, 'en')).toBe('—');
  });
});
