import { describe, expect, it } from 'vitest';
import {
  detectAccessAnomalies,
  MemoryRateLimitStore,
  RATE_LIMITS,
  RateLimiter,
} from './rate-limiter';

/** Controllable clock, so lockout behaviour is tested without real waiting. */
function makeLimiter(): { limiter: RateLimiter; advance: (ms: number) => void } {
  let now = 1_700_000_000_000;
  const limiter = new RateLimiter(new MemoryRateLimitStore(), () => now);
  return { limiter, advance: (ms: number) => (now += ms) };
}

describe('P4.5 rate limiting and lockout', () => {
  it('allows attempts up to the limit, then locks out', async () => {
    const { limiter } = makeLimiter();

    for (let i = 0; i < RATE_LIMITS.login.limit; i++) {
      const d = await limiter.consume('login', 'doctor@clinic.ly');
      expect(d.allowed, `attempt ${i + 1}`).toBe(true);
    }

    const blocked = await limiter.consume('login', 'doctor@clinic.ly');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(RATE_LIMITS.login.baseLockoutMs);
  });

  it('throttles a scripted brute-force attempt', async () => {
    const { limiter } = makeLimiter();
    let allowed = 0;

    // 100 rapid attempts, as a script would make them.
    for (let i = 0; i < 100; i++) {
      const d = await limiter.consume('login', 'victim@clinic.ly');
      if (d.allowed) allowed++;
    }

    // Only the initial burst gets through; everything after is locked out.
    expect(allowed).toBe(RATE_LIMITS.login.limit);
  });

  it('escalates the lockout on each repeat violation', async () => {
    const { limiter, advance } = makeLimiter();
    const id = 'persistent@attacker';
    const rule = RATE_LIMITS.login;

    const trigger = async (): Promise<number> => {
      let retry = 0;
      for (let i = 0; i <= rule.limit; i++) {
        const d = await limiter.consume('login', id);
        if (!d.allowed) retry = d.retryAfterMs;
      }
      return retry;
    };

    const first = await trigger();
    advance(first + 1);
    const second = await trigger();
    advance(second + 1);
    const third = await trigger();

    expect(first).toBe(rule.baseLockoutMs);
    expect(second).toBe(rule.baseLockoutMs * 2);
    expect(third).toBe(rule.baseLockoutMs * 4);
  });

  it('caps the lockout so a legitimate user is never locked out forever', async () => {
    const { limiter, advance } = makeLimiter();
    const rule = RATE_LIMITS.login;
    let retry = 0;

    for (let round = 0; round < 12; round++) {
      for (let i = 0; i <= rule.limit; i++) {
        const d = await limiter.consume('login', 'unlucky@clinic.ly');
        if (!d.allowed) retry = d.retryAfterMs;
      }
      advance(retry + 1);
    }

    expect(retry).toBe(rule.maxLockoutMs);
  });

  it('does not reset the penalty just because the window elapsed', async () => {
    // The attack this prevents: pace attempts to exactly the limit per window,
    // forever, with no escalation. Violations must survive the window roll.
    const { limiter, advance } = makeLimiter();
    const rule = RATE_LIMITS.login;
    const id = 'paced@attacker';

    const triggerOnce = async (): Promise<number> => {
      let retry = 0;
      for (let i = 0; i <= rule.limit; i++) {
        const d = await limiter.consume('login', id);
        if (!d.allowed) retry = d.retryAfterMs;
      }
      return retry;
    };

    const first = await triggerOnce();
    // Wait out both the lockout AND a full window.
    advance(first + rule.windowMs + 1);
    const second = await triggerOnce();

    expect(second).toBeGreaterThan(first);
  });

  it('clears the penalty after a successful authentication', async () => {
    const { limiter } = makeLimiter();
    const id = 'doctor@clinic.ly';

    for (let i = 0; i < 4; i++) await limiter.consume('login', id);
    await limiter.clear('login', id);

    const after = await limiter.consume('login', id);
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(RATE_LIMITS.login.limit - 1);
  });

  it('keeps separate budgets per identifier', async () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i <= RATE_LIMITS.login.limit; i++) {
      await limiter.consume('login', 'a@clinic.ly');
    }

    // One locked-out account must not affect another.
    const other = await limiter.consume('login', 'b@clinic.ly');
    expect(other.allowed).toBe(true);
  });

  it('keeps separate budgets per kind', async () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i <= RATE_LIMITS.otpRequest.limit; i++) {
      await limiter.consume('otpRequest', '+218912345678');
    }

    const login = await limiter.consume('login', '+218912345678');
    expect(login.allowed).toBe(true);
  });

  it('gives OTP a tighter budget than login', async () => {
    // A 6-digit code needs a smaller guessing budget than a password, and
    // every request costs an SMS.
    expect(RATE_LIMITS.otpRequest.limit).toBeLessThan(RATE_LIMITS.login.limit);
    expect(RATE_LIMITS.otpRequest.maxLockoutMs).toBeGreaterThan(RATE_LIMITS.login.maxLockoutMs);
  });

  it('does not throttle normal clinic upload volume', async () => {
    const { limiter } = makeLimiter();
    let allowed = 0;
    // A doctor uploading 40 studies in a session must not be interrupted.
    for (let i = 0; i < 40; i++) {
      const d = await limiter.consume('uploadInit', 'doctor-1');
      if (d.allowed) allowed++;
    }
    expect(allowed).toBe(40);
  });
});

describe('P4.5 access anomaly detection', () => {
  it('flags an actor touching an unusual number of distinct patients', async () => {
    const flagged = detectAccessAnomalies([
      { actorId: 'normal-doctor', distinctPatients: 12 },
      { actorId: 'compromised', distinctPatients: 250 },
    ]);

    expect(flagged.map((f) => f.actorId)).toEqual(['compromised']);
  });

  it('does not flag a busy but plausible clinic day', async () => {
    // A detector that fires on ordinary work gets muted within a week.
    const flagged = detectAccessAnomalies([{ actorId: 'busy', distinctPatients: 20 }]);
    expect(flagged).toHaveLength(0);
  });

  it('fires exactly at the threshold', async () => {
    const flagged = detectAccessAnomalies([{ actorId: 'edge', distinctPatients: 40 }]);
    expect(flagged).toHaveLength(1);
  });
});

describe('MemoryRateLimitStore', () => {
  it('evicts expired buckets nobody reads again, so one-off keys cannot grow it forever', async () => {
    const store = new MemoryRateLimitStore();
    const bucket = { attempts: 1, windowStart: 0, violations: 0, lockedUntil: 0 };
    for (let i = 0; i <= 10_000; i++) await store.set(`ip:${i}`, bucket, -1);
    expect(store.size).toBeLessThan(10);
  });
});
