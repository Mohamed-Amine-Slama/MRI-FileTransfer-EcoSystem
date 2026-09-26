import { Injectable } from '@nestjs/common';

/**
 * Rate limiting and progressive lockout — BUILD_SPEC P4.5.
 *
 * Protects login, OTP request, and upload initiation.
 *
 * WHY PROGRESSIVE RATHER THAN A FLAT WINDOW:
 * a flat "5 per minute" limit costs an attacker nothing — they simply pace
 * themselves at 5/minute forever, which is 7,200 attempts a day against a
 * 6-digit OTP. Doubling the lockout on each failed burst makes sustained
 * guessing impractical while a doctor who fat-fingers their password twice
 * waits seconds, not minutes.
 *
 * WHY OTP DESERVES ITS OWN TIGHTER BUDGET:
 * a 6-digit code has a million possibilities, but SMS delivery means an
 * attacker who can request unlimited codes also runs up the bill and trains
 * patients to ignore the messages.
 */

export interface RateLimitRule {
  /** Attempts allowed inside the window before lockout begins. */
  limit: number;
  windowMs: number;
  /** First lockout duration; doubles with each subsequent violation. */
  baseLockoutMs: number;
  maxLockoutMs: number;
}

export const RATE_LIMITS = {
  login: {
    limit: 5,
    windowMs: 5 * 60_000,
    baseLockoutMs: 60_000,
    maxLockoutMs: 60 * 60_000,
  },
  otpRequest: {
    limit: 3,
    windowMs: 15 * 60_000,
    baseLockoutMs: 5 * 60_000,
    maxLockoutMs: 4 * 60 * 60_000,
  },
  scheduleWrite: {
    // A receptionist working through a morning's calls legitimately creates and
    // moves a great many appointments, so this is deliberately generous — it
    // exists to bound a script hammering the booking endpoint, not to pace a
    // human doing their job. Throttling a practice mid-morning is its own kind
    // of harm, the same argument uploadInit makes below.
    limit: 120,
    windowMs: 60_000,
    baseLockoutMs: 30_000,
    maxLockoutMs: 10 * 60_000,
  },
  uploadInit: {
    // Generous: a clinic legitimately starts many study uploads in a session.
    // This is abuse protection, not a workflow constraint — throttling a
    // doctor mid-referral is its own kind of harm.
    limit: 60,
    windowMs: 60_000,
    baseLockoutMs: 30_000,
    maxLockoutMs: 10 * 60_000,
  },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitKind = keyof typeof RATE_LIMITS;

interface Bucket {
  attempts: number;
  windowStart: number;
  violations: number;
  lockedUntil: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Milliseconds until the caller may retry. Zero when allowed. */
  retryAfterMs: number;
  remaining: number;
}

/**
 * Store abstraction so production can use Redis (shared across instances)
 * while tests use memory.
 *
 * This matters more than it looks: an in-memory limiter on three application
 * instances behind a load balancer permits three times the intended rate, and
 * resets entirely on deploy. Redis is the correct production store.
 */
export interface RateLimitStore {
  get(key: string): Promise<Bucket | undefined>;
  set(key: string, bucket: Bucket, ttlMs: number): Promise<void>;
  reset(key: string): Promise<void>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, { bucket: Bucket; expiresAt: number }>();

  async get(key: string): Promise<Bucket | undefined> {
    const entry = this.buckets.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.buckets.delete(key);
      return undefined;
    }
    return entry.bucket;
  }

  async set(key: string, bucket: Bucket, ttlMs: number): Promise<void> {
    this.buckets.set(key, { bucket, expiresAt: Date.now() + ttlMs });
    if (this.buckets.size > this.sweepAt) this.sweep();
  }

  /**
   * Expired buckets were only dropped when their own key was read again, so
   * a spray of one-off keys (rotating IPs, invented emails) grew the map
   * forever. Sweep when it doubles; the threshold tracks the live size so the
   * O(n) pass stays amortised O(1) per write.
   *
   * ponytail: per-process memory — with N API replicas each limit is N× as
   * loose. A Redis-backed RateLimitStore fixes both when there are replicas.
   */
  private sweepAt = 10_000;

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.buckets) {
      if (entry.expiresAt <= now) this.buckets.delete(key);
    }
    this.sweepAt = Math.max(10_000, this.buckets.size * 2);
  }

  /** For tests. */
  get size(): number {
    return this.buckets.size;
  }

  async reset(key: string): Promise<void> {
    this.buckets.delete(key);
  }
}

@Injectable()
export class RateLimiter {
  constructor(
    private readonly store: RateLimitStore = new MemoryRateLimitStore(),
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Register an attempt and decide whether it is allowed.
   *
   * `identifier` should be the most specific stable thing available — the
   * account being targeted for login, or the phone number for OTP. Keying on
   * IP alone is defeated by a botnet; keying on account alone lets one
   * attacker lock a doctor out of their own account, so callers combine both.
   */
  async consume(kind: RateLimitKind, identifier: string): Promise<RateLimitDecision> {
    const rule = RATE_LIMITS[kind];
    const key = `${kind}:${identifier}`;
    const t = this.now();

    const existing = await this.store.get(key);
    const bucket: Bucket = existing ?? {
      attempts: 0,
      windowStart: t,
      violations: 0,
      lockedUntil: 0,
    };

    if (bucket.lockedUntil > t) {
      return { allowed: false, retryAfterMs: bucket.lockedUntil - t, remaining: 0 };
    }

    // Roll the window forward once it has elapsed. `violations` deliberately
    // survives the roll — otherwise an attacker resets their penalty simply by
    // waiting out one window, and the escalation never escalates.
    if (t - bucket.windowStart >= rule.windowMs) {
      bucket.attempts = 0;
      bucket.windowStart = t;
    }

    bucket.attempts += 1;

    if (bucket.attempts > rule.limit) {
      bucket.violations += 1;
      const lockout = Math.min(
        rule.baseLockoutMs * 2 ** (bucket.violations - 1),
        rule.maxLockoutMs,
      );
      bucket.lockedUntil = t + lockout;
      bucket.attempts = 0;
      bucket.windowStart = t;

      await this.store.set(key, bucket, lockout + rule.windowMs);
      return { allowed: false, retryAfterMs: lockout, remaining: 0 };
    }

    await this.store.set(key, bucket, rule.windowMs * 4);
    return { allowed: true, retryAfterMs: 0, remaining: rule.limit - bucket.attempts };
  }

  /** Called after a successful authentication to clear the penalty. */
  async clear(kind: RateLimitKind, identifier: string): Promise<void> {
    await this.store.reset(`${kind}:${identifier}`);
  }
}

// ---------------------------------------------------------------------------
// Anomaly detection (P4.5: "alert on ... one account accessing an unusual
// number of distinct patients in an hour")
// ---------------------------------------------------------------------------

export interface AccessAnomalyThresholds {
  /** Distinct patients per actor per hour that triggers an alert. */
  distinctPatientsPerHour: number;
}

export const DEFAULT_ANOMALY_THRESHOLDS: AccessAnomalyThresholds = {
  // A busy Tunisian doctor might open a dozen patients in an hour. Forty is
  // not a clinic workflow; it is enumeration. Tuned deliberately loose — a
  // noisy detector gets muted, and a muted detector is worse than none.
  distinctPatientsPerHour: 40,
};

export interface ActorAccessWindow {
  actorId: string;
  distinctPatients: number;
}

export function detectAccessAnomalies(
  windows: ActorAccessWindow[],
  thresholds: AccessAnomalyThresholds = DEFAULT_ANOMALY_THRESHOLDS,
): ActorAccessWindow[] {
  return windows.filter((w) => w.distinctPatients >= thresholds.distinctPatientsPerHour);
}

/**
 * SQL for the hourly anomaly sweep, run against the audit log.
 *
 * Reads audit_events rather than instrumenting the read path: the audit log is
 * the one place every access is guaranteed to appear (P4.4), so a detector
 * built on it cannot be bypassed by a code path that forgot to increment a
 * counter.
 */
export const ANOMALY_SWEEP_SQL = `
  SELECT actor_id AS "actorId",
         COUNT(DISTINCT patient_id)::int AS "distinctPatients"
  FROM audit_events
  WHERE action = 'StudyAccessed'
    AND occurred_at >= now() - interval '1 hour'
    AND patient_id IS NOT NULL
  GROUP BY actor_id
  HAVING COUNT(DISTINCT patient_id) >= $1
`;
