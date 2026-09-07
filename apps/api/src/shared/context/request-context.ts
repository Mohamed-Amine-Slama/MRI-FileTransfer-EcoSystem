import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Role } from '@mir/contracts';

/**
 * Per-request identity, carried implicitly through the call stack.
 *
 * Why AsyncLocalStorage rather than threading a context parameter: every
 * database call in this system must run under an RLS session context. If that
 * context is an ordinary argument, forgetting to pass it produces a query that
 * silently runs with NO identity — which, thanks to the NULL-safe policies,
 * returns zero rows rather than erroring. A doctor sees an empty study list
 * and nobody finds out why for a week.
 *
 * WHY A MUTABLE HOLDER RATHER THAN storage.run(ctx, ...):
 *
 * The identity is not known when the scope must be opened. Authentication
 * happens in a guard, but a guard cannot wrap the execution that follows it —
 * `storage.run(ctx, () => true)` exits the moment the guard returns, and the
 * handler then runs outside the scope with no context at all.
 *
 * So a middleware opens an EMPTY scope around the whole downstream chain, and
 * the guard fills it in once the token is verified. `run()` keeps the scope
 * strictly per-request; `enterWith()` would also work but leaks into whatever
 * else shares the current async resource, which is a bad property for the
 * value that decides who can read a patient's scan.
 */
export interface RequestContext {
  userId: string;
  role: Role;
  /** For the audit trail (P4.4). */
  ipAddress: string | undefined;
  userAgent: string | undefined;
  requestId: string;
}

interface ContextHolder {
  ctx?: RequestContext;
}

const storage = new AsyncLocalStorage<ContextHolder>();

/** Open an empty context scope around `fn`. Called by the middleware. */
export function runWithContextScope<T>(fn: () => T): T {
  return storage.run({}, fn);
}

/** Open a scope with the context already established. For jobs and tests. */
export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run({ ctx }, fn);
}

export class ContextScopeMissingError extends Error {
  constructor() {
    super(
      'No request-context scope is open. RequestContextMiddleware must run ' +
        'before the auth guard for every route.',
    );
    this.name = 'ContextScopeMissingError';
  }
}

/** Establish the identity for the current scope. Called by the auth guard. */
export function setContext(ctx: RequestContext): void {
  const holder = storage.getStore();
  if (holder === undefined) throw new ContextScopeMissingError();
  holder.ctx = ctx;
}

export function getContext(): RequestContext | undefined {
  return storage.getStore()?.ctx;
}

export class MissingRequestContextError extends Error {
  constructor() {
    super(
      'No request context. A query that touches patient data must run inside ' +
        'an authenticated request (BUILD_SPEC §6). If this is a background job, ' +
        'establish an explicit context for it rather than querying without one.',
    );
    this.name = 'MissingRequestContextError';
  }
}

/**
 * Fetch the context or throw.
 *
 * Throwing is deliberate. Returning `undefined` and letting the query proceed
 * would produce a policy evaluation against NULL — zero rows, no error, no
 * signal. A missing context is a programming bug and should look like one.
 */
export function requireContext(): RequestContext {
  const ctx = getContext();
  if (ctx === undefined) throw new MissingRequestContextError();
  return ctx;
}

/**
 * Identity for work that has no user session — a provider webhook, a periodic
 * sweep.
 *
 * NOT A BYPASS. It is the same `mir_app` connection with an explicit role in
 * the session context, subject to every policy a request is (§17). What it
 * grants is exactly what the `*_admin` policies grant and nothing more: an
 * admin identity cannot see a single imaging study, and the P3.2 suite asserts
 * that.
 *
 * The nil-ish UUID is deliberate and stable: `app_current_user_id()` must parse
 * as a uuid, and the admin policies turn on the ROLE rather than the id, so
 * this identifies "the system" in the audit log without impersonating a person.
 */
export function systemContext(userAgent: string): RequestContext {
  return {
    userId: '00000000-0000-7000-8000-000000000000',
    role: 'admin',
    ipAddress: undefined,
    userAgent,
    requestId: randomUUID(),
  };
}
