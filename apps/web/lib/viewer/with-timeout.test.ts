import { afterEach, describe, expect, it, vi } from 'vitest';
import { withTimeout } from './with-timeout';

afterEach(() => {
  vi.useRealTimers();
});

describe('withTimeout', () => {
  it('resolves when the promise wins', async () => {
    await expect(withTimeout(Promise.resolve(7), 50)).resolves.toBe(7);
  });

  it('rejects with "timeout" when the clock wins', async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise(() => {}), 50);
    vi.advanceTimersByTime(51);
    await expect(pending).rejects.toThrow('timeout');
  });

  it('passes the original rejection through', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 50)).rejects.toThrow('boom');
  });
});
