import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG } from '../../../shared/config/config.module';
import type { AppConfig } from '../../../shared/config/config.schema';
import { runWithContext, systemContext } from '../../../shared/context/request-context';
import { CasesService } from './cases.service';

/**
 * The periodic sweep: expire cases a doctor accepted and never answered.
 *
 * WHY THERE IS A TIMER HERE AT ALL. The function it calls has existed since P10
 * and nothing ever called it — no cron, no scheduler, no caller outside its own
 * test, so the one thing written to stop a case hanging open forever had no
 * effect in production.
 *
 * WHAT EXPIRY MEANS NOW. It is the refund trigger: a doctor who takes a case
 * and lets the window run out has not delivered, and `expired` is the only
 * status that says so. It is deliberately not `cancelled`, which is the lab's
 * own withdrawal.
 *
 * WHY setInterval AND NOT @nestjs/schedule. It would be the idiomatic choice
 * and it is one dependency for one timer. This needs no cron expressions, no
 * decorators and no dynamic job registry — and every added package is
 * something the dependency scan, the lockfile and CI carry from here on. If a
 * second scheduled job with real cron semantics ever appears, that is the point
 * to reach for the library.
 *
 * SINGLE-PROCESS ASSUMPTION, stated because it will not hold forever: with more
 * than one API replica every replica runs this. Re-running the sweep is
 * harmless: the conditional UPDATE matches nothing the second time, so a case
 * cannot expire — or refund — twice. The duplicate work is wasted rather than
 * wrong. A real multi-replica deployment should still move this behind an
 * advisory lock.
 */

/** How often the sweep runs. */
const SWEEP_INTERVAL_MS = 15 * 60_000;

@Injectable()
export class CasesMaintenance implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CasesMaintenance.name);
  private timer: NodeJS.Timeout | undefined;
  /** Guards against a slow sweep overlapping the next tick. */
  private running = false;

  constructor(
    private readonly cases: CasesService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    if (this.config.NODE_ENV === 'test') return;

    // `unref` so a pending timer cannot hold the process open on shutdown —
    // without it, a container stop waits out the full interval.
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  /**
   * One pass. Public so a test can drive it directly rather than waiting on a
   * timer, and so an operator can trigger it from a REPL during an incident.
   *
   * Failures are logged and swallowed: an unhandled rejection in a timer
   * callback takes the process down, and a missed sweep is a far smaller
   * problem than an API that restarts every fifteen minutes.
   */
  async sweep(): Promise<{ expired: number }> {
    if (this.running) return { expired: 0 };
    this.running = true;
    try {
      return await runWithContext(systemContext('cases-sweep'), async () => {
        const expired = await this.cases.expireOverdue();
        if (expired > 0) this.logger.log(`sweep: expired ${expired}`);
        return { expired };
      });
    } catch (err) {
      this.logger.error(`sweep failed: ${err instanceof Error ? err.message : String(err)}`);
      return { expired: 0 };
    } finally {
      this.running = false;
    }
  }
}
