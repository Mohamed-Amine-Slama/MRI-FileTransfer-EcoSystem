import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PublicEndpoint } from '../shared/authz/access-metadata';
import { DatabaseService } from '../shared/db/database.service';

/**
 * Liveness endpoint (BUILD_SPEC P1.1).
 *
 * Deliberately returns nothing but a literal status. A health endpoint that
 * reports version numbers, hostnames, or dependency detail is a free
 * reconnaissance surface on an unauthenticated route, and BUILD_SPEC §6
 * forbids leaking internal identifiers to clients.
 *
 * Readiness (can we reach Postgres / Orthanc / S3?) is a separate concern and
 * belongs on an internal-only route, not here.
 */
@Controller()
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  // Deliberately public: the load balancer must be able to probe it without
  // credentials. This is why it returns nothing but a literal status.
  @PublicEndpoint()
  @Get('health')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /**
   * Readiness: can this process serve a real request? `/health` only says the
   * process is up — it answered 200 while the database was unreachable, so a
   * load balancer kept routing traffic to an instance that could only 500.
   * Same public, literal-status contract; 503 when the database does not
   * answer within two seconds.
   */
  @PublicEndpoint()
  @Get('health/ready')
  async ready(): Promise<{ status: 'ready' }> {
    const ok = await Promise.race([
      this.db.ping().catch(() => false),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000).unref()),
    ]);
    if (!ok) throw new ServiceUnavailableException();
    return { status: 'ready' };
  }
}
