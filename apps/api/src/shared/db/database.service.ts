import './pg-types';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config.schema';
import { requireContext, type RequestContext } from '../context/request-context';

export type Tx = PoolClient;

/**
 * Database access under row-level security — BUILD_SPEC P4.2, ADR-6.
 *
 * THE ONE THING THIS CLASS EXISTS TO GUARANTEE:
 * the RLS session context is set INSIDE the same transaction as the queries it
 * governs.
 *
 * `SET LOCAL` (and `set_config(..., true)`) are scoped to the current
 * transaction. Issued outside one, on a pooled connection, they either apply
 * to the wrong statement or evaporate immediately — and the policies then
 * evaluate against NULL, returning zero rows with no error. The failure is
 * silent in exactly the direction that looks like "the feature is broken"
 * rather than "authorization is off", so it survives review.
 *
 * There is deliberately NO method that runs a query outside a transaction, and
 * no second pool connecting as a privileged role. A single admin/bypass
 * connection would defeat the entire second layer of defence (§17).
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: config.DATABASE_POOL_MAX,
      // A request that cannot get a connection should fail fast rather than
      // pile up behind a saturated pool during an upload burst.
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    });
  }

  private closed = false;

  /**
   * Idempotent shutdown.
   *
   * Nest can invoke lifecycle hooks more than once — a manual close alongside
   * an application shutdown hook, for instance — and `Pool.end()` throws on the
   * second call. A crash during shutdown obscures whatever caused the shutdown,
   * which is exactly when the real error matters most.
   */
  async onModuleDestroy(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.pool.end();
  }

  /**
   * Run `fn` inside a transaction with the caller's RLS context applied.
   *
   * Uses the ambient request context; throws if there isn't one.
   */
  async tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.txAs(requireContext(), fn);
  }

  /**
   * Run `fn` inside a transaction under an explicit context.
   *
   * Used by background jobs (P7.4 ingestion) which have no HTTP request but
   * still must not query without an identity.
   */
  async txAs<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Parameterised rather than interpolated. `SET LOCAL app.user_id = '...'`
      // cannot take a bind parameter, so building it as a string would put
      // caller-influenced data straight into SQL — on the single value an
      // attacker most wants to control. set_config(name, value, is_local=true)
      // is the parameterisable equivalent.
      await client.query('SELECT set_config($1, $2, true)', ['app.user_id', ctx.userId]);
      await client.query('SELECT set_config($1, $2, true)', ['app.user_role', ctx.role]);

      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Connection check for readiness probes. Runs no patient query and needs no
   * identity, so it is exempt from the context requirement.
   */
  async ping(): Promise<boolean> {
    const res = await this.pool.query('SELECT 1 AS ok');
    return res.rows.length === 1;
  }
}
