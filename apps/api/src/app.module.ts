import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, DiscoveryModule } from '@nestjs/core';
import { HealthModule } from './health/health.module';
import { AuthGuard } from './shared/auth/auth.guard';
import { TokenVerifier } from './shared/auth/token-verifier';
import { ConfigModule } from './shared/config/config.module';
import { RequestContextMiddleware } from './shared/context/request-context.middleware';
import { DatabaseModule } from './shared/db/database.module';
import { GlobalExceptionFilter } from './shared/errors/global-exception.filter';
import { SecurityHeadersMiddleware } from './shared/http/security-headers.middleware';
import { EventsModule } from './shared/events/events.module';
import { JobsModule } from './shared/jobs/jobs.module';
import { MailModule } from './shared/mail';
import { RateLimitModule } from './shared/ratelimit/rate-limit.module';
import { TracingModule } from './shared/observability/tracing.module';
import { RateLimitGuard } from './shared/ratelimit/rate-limit.guard';
import { AuditModule } from './modules/audit';
import { ConsentModule } from './modules/consent';
import { IdentityModule } from './modules/identity';
import { ImagingModule } from './modules/imaging';
import { LedgerModule } from './modules/ledger';
import { NotificationsModule } from './modules/notifications';
import { OrganisationsModule } from './modules/organisations';
import { PlansModule } from './modules/plans';
import { PricingModule } from './modules/pricing';
import { PatientsModule } from './modules/patients';
import { CasesModule } from './modules/cases';

/**
 * Application root.
 *
 * Module boundaries are enforced structurally by dependency-cruiser (P1.4),
 * not by convention. Note that domain modules are imported through their
 * public `index.ts` only — reaching into `modules/x/internal/...` from here
 * would fail the build.
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    EventsModule,
    JobsModule,
    MailModule,
    RateLimitModule,
    TracingModule,
    // Needed by the P1.5 bootstrap audit to enumerate every registered route.
    DiscoveryModule,
    HealthModule,
    AuditModule,
    IdentityModule,
    PatientsModule,
    ConsentModule,
    ImagingModule,
    CasesModule,
    LedgerModule,
    NotificationsModule,
    OrganisationsModule,
    PlansModule,
    PricingModule,
  ],
  providers: [
    TokenVerifier,
    // Global by default: an undeclared route is unreachable, and P1.5 refuses
    // to boot if one exists at all.
    { provide: APP_GUARD, useClass: AuthGuard },
    // P4.5 — registered AFTER AuthGuard so the request context already carries
    // a verified userId and the limiter keys on the account, not on a rotatable
    // IP. Only routes marked with @RateLimit are throttled.
    { provide: APP_GUARD, useClass: RateLimitGuard },
    // §6: no stack traces, no SQL, no internal identifiers in any response.
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // P14.3 — security headers first, so they are set before any handler can
    // short-circuit and before the exception filter renders an error.
    consumer.apply(SecurityHeadersMiddleware).forRoutes('*');

    // Must cover every route: this opens the AsyncLocalStorage scope that the
    // auth guard fills in and that DatabaseService reads to set the RLS
    // session context. A route without it fails at request time, not at boot.
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
