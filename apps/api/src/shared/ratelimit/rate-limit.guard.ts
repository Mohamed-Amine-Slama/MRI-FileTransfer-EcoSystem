import {
  CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { clientIp } from '../auth/auth.guard';
import { getContext } from '../context/request-context';
import { RateLimiter, type RateLimitKind } from './rate-limiter';

/**
 * The rate limiter, actually in the request path — BUILD_SPEC P4.5.
 *
 * WHAT WAS WRONG. `rate-limiter.ts` was written, tested, and referenced by
 * nothing outside its own test. The ledger recorded P4.5 as "logic tested; no
 * alert delivery", which reads as *the limiter works, the alerting does not*.
 * The truth was worse: the API applied NO rate limiting to any route. A
 * tested-but-unreferenced security control is not a partial control, it is an
 * absent one, and the note said otherwise.
 *
 * The intent was visible in code that had already been written around it —
 * `PatientsController` validates claim-token shape early with the comment
 * "so a 400 is returned for obvious junk without consuming rate-limit budget".
 * That budget did not exist.
 *
 * WHY OPT-IN PER ROUTE rather than global. Throttling is a blunt instrument
 * and the clinical read paths must not be subject to it: a doctor scrolling a
 * 300-instance study issues hundreds of legitimate requests, and a global
 * limiter that treats that as abuse denies care. Each protected route is named
 * deliberately, the same discipline P1.5 applies to access declarations.
 *
 * WHY IT RUNS AFTER THE AUTH GUARD. Registration order in AppModule puts
 * AuthGuard first, so the request context carries a verified `userId` by the
 * time this runs and the limiter can key on the account rather than on an IP
 * a botnet rotates freely. The cost is that unauthenticated floods are not
 * counted here — they are rejected by AuthGuard without a database round trip,
 * and volumetric defence at that layer is the edge's job (P14.3, Cloudflare,
 * still unconfigured).
 */

export const RATE_LIMIT_KEY = 'mir:rate_limit';

/**
 * What to count against.
 *
 * `user` — the authenticated caller. Right for budgets that bound what one
 * account may do (guessing a code, starting uploads).
 *
 * `param:<name>` — a route parameter, for budgets that protect a THIRD PARTY
 * rather than the caller. Getting this wrong in either direction is harmful,
 * and the two are not symmetric:
 *
 *   Issuing a claim code sends an SMS to a patient. Keyed on the doctor, a
 *   budget of 3 per 15 minutes throttles a clinic onboarding four patients in
 *   a morning — legitimate work, denied. Keyed on the patient, the same budget
 *   bounds messages to any ONE number while leaving the clinic's throughput
 *   untouched. The abuse being prevented is bombing a phone, so the phone's
 *   owner is what the budget belongs to.
 *
 * `body:<field>` — a field of the request body, for a budget that protects an
 *   account the caller has not authenticated as. Verifying an emailed code is
 *   the case it exists for: the request is public, so `user` is unavailable and
 *   the guard would fall back to the IP — which puts an entire clinic behind
 *   one NAT into a single three-per-fifteen-minutes bucket, so the second
 *   member of staff to sign up that morning is locked out by the first. The
 *   abuse being prevented is guessing the code for ONE account, so the budget
 *   belongs to that account.
 *
 *   The value is HASHED into the bucket key. Rate-limiter keys outlive the
 *   request and may reach a shared store; an email address is not something to
 *   leave lying in one when a digest works identically.
 *
 * `body+ip:<field>` — the same, narrowed to the caller's IP. For a budget whose
 *   exhaustion must not be a weapon: keyed on the account alone, anyone can
 *   burn a victim's budget and lock them out of their own sign-up. Use it only
 *   where something else bounds the per-account total (verifying a code: the
 *   database caps attempts per code).
 *
 * Every IP here is `clientIp()` — Cloudflare's connecting IP — never the bare
 * `req.ip`, which behind Cloudflare and the ALB is the proxy for every caller
 * and would put the whole platform in one bucket.
 */
export type RateLimitKeyBy =
  | 'user'
  | `param:${string}`
  | `body:${string}`
  | `body+ip:${string}`;

export interface RateLimitOptions {
  keyBy?: RateLimitKeyBy;
}

/** Apply a named rate-limit budget to a route. */
export const RateLimit = (kind: RateLimitKind, options: RateLimitOptions = {}) =>
  SetMetadata(RATE_LIMIT_KEY, { kind, keyBy: options.keyBy ?? 'user' });

interface RateLimitMetadata {
  kind: RateLimitKind;
  keyBy: RateLimitKeyBy;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger('RateLimit');

  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<RateLimitMetadata | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Unmarked routes are not throttled. This is the deliberate default —
    // see the note above on clinical read paths.
    if (meta === undefined) return true;

    const ctx = getContext();
    const request = context
      .switchToHttp()
      .getRequest<Request>();
    const ip = `ip:${clientIp(request) ?? 'unknown'}`;

    let identifier: string;
    if (meta.keyBy.startsWith('body:') || meta.keyBy.startsWith('body+ip:')) {
      const withIp = meta.keyBy.startsWith('body+ip:');
      const name = meta.keyBy.slice(meta.keyBy.indexOf(':') + 1);
      const body = request.body;
      const value =
        typeof body === 'object' && body !== null
          ? (body as Record<string, unknown>)[name]
          : undefined;
      // Same reasoning as the missing-param case below: a request with no such
      // field must not join one shared bucket with every other malformed one.
      identifier =
        typeof value === 'string' && value !== ''
          ? `${meta.keyBy}:${createHash('sha256').update(value.toLowerCase()).digest('hex')}${withIp ? `:${ip}` : ''}`
          : ip;
    } else if (meta.keyBy.startsWith('param:')) {
      const name = meta.keyBy.slice('param:'.length);
      const value = request.params[name];
      // A missing parameter must not collapse every caller into one shared
      // bucket — that would let one abusive request lock out the platform.
      // Fall back to the account, which is always at least as specific.
      identifier =
        value === undefined ? `user:${ctx?.userId ?? 'anonymous'}` : `${meta.keyBy}:${value}`;
    } else {
      // Authenticated identity first. The IP fallback exists only so a
      // misordered guard chain degrades to *something* rather than keying
      // every caller to the same bucket and locking out the whole platform.
      identifier = ctx?.userId ?? ip;
    }

    const decision = await this.limiter.consume(meta.kind, identifier);
    if (decision.allowed) return true;

    const retryAfterSeconds = Math.ceil(decision.retryAfterMs / 1000);

    // P4.5's alerting half has no delivery channel, but a lockout must at
    // least be visible in the log store. This goes through ScrubbingLogger,
    // so the identifier is redacted on the way out.
    this.logger.warn(`rate limit exceeded`, JSON.stringify({ kind: meta.kind, retryAfterSeconds }));

    const response = context.switchToHttp().getResponse<Response>();
    response.setHeader('Retry-After', String(retryAfterSeconds));

    // 429 with no detail about which budget or how much remains: a precise
    // response tells an attacker exactly how to pace themselves.
    throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
  }
}
