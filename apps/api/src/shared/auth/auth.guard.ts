import {
  CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { requiresSecondFactor, type Role } from '@mir/contracts';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config.schema';
import { PUBLIC_ENDPOINT_KEY, REQUIRES_ROLE_KEY } from '../authz/access-metadata';
import { setContext, type RequestContext } from '../context/request-context';
import { TokenVerifier } from './token-verifier';

/**
 * Global authentication and role guard — BUILD_SPEC P4.2, P4.3.
 *
 * Applied globally, so the DEFAULT for any route is "denied". A route becomes
 * reachable only by declaring @RequiresRole or @PublicEndpoint, and P1.5
 * refuses to boot if a route declares neither. Between the two, there is no
 * arrangement of code that ships an endpoint nobody decided about.
 *
 * This guard grants REACHABILITY, never data visibility. What rows come back
 * is decided by row-level security, which does not trust anything here
 * (ADR-6).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenVerifier,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const controller = context.getClass();

    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ENDPOINT_KEY, [
      handler,
      controller,
    ]);
    if (isPublic === true) return true;

    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(REQUIRES_ROLE_KEY, [
      handler,
      controller,
    ]);

    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request.headers.authorization);

    if (token === undefined) {
      throw new UnauthorizedException('Authentication required');
    }

    let identity;
    try {
      identity = await this.tokens.verify(token);
    } catch {
      // Uniform 401 regardless of why. Distinguishing "expired" from "bad
      // signature" tells an attacker which half of a forged token to fix.
      throw new UnauthorizedException('Authentication required');
    }

    // P4.3 — accounts that reach patient data must have completed a second
    // factor. Enforced here as well as in the Keycloak flow, so a realm
    // misconfiguration cannot quietly downgrade them to single-factor.
    //
    // The set is `requiresSecondFactor`, not `isClinicalRole`: an assistant is
    // not clinical and must not be treated as such anywhere access is granted,
    // but the account can still see who is attending the clinic and on what
    // number, which is worth protecting the same way.
    if (requiresSecondFactor(identity.role) && !identity.mfaSatisfied) {
      throw new ForbiddenException('Multi-factor authentication required');
    }

    if (requiredRoles !== undefined && !requiredRoles.includes(identity.role)) {
      throw new ForbiddenException('Insufficient role');
    }

    const ctx: RequestContext = {
      userId: identity.userId,
      role: identity.role,
      ipAddress: clientIp(request),
      userAgent: firstHeader(request.headers['user-agent']),
      requestId: firstHeader(request.headers['x-request-id']) ?? randomUUID(),
    };

    // Fill in the scope opened by RequestContextMiddleware. Everything
    // downstream — including the DatabaseService transaction that sets the RLS
    // session variables — reads its identity from here.
    setContext(ctx);
    return true;
  }
}

function extractBearerToken(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer') return undefined;
  return value !== undefined && value !== '' ? value : undefined;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Client IP for the audit trail.
 *
 * Behind Cloudflare and an ALB, `req.ip` is the proxy. `CF-Connecting-IP` is
 * set by Cloudflare and — critically — is overwritten by them on every
 * request, so a client cannot forge it as long as the origin only accepts
 * traffic from Cloudflare (P14.3). `X-Forwarded-For` is NOT used: it is
 * client-controllable and would let an attacker write arbitrary addresses into
 * the audit log.
 */
function clientIp(request: Request): string | undefined {
  return firstHeader(request.headers['cf-connecting-ip']) ?? request.ip;
}
