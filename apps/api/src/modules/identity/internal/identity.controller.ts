import { Controller, Get } from '@nestjs/common';
import { RequiresRole } from '../../../shared/authz/access-metadata';
import { IdentityService, type CurrentUser } from './identity.service';

/**
 * Session introspection — the endpoint every screen calls on load.
 *
 * ALL FOUR ROLES, and no @PublicEndpoint. An anonymous caller gets 401 from
 * the guard, which is exactly what the web client uses to decide it is
 * anonymous. Making this public so it could answer "nobody" would mean an
 * unauthenticated request reaching application code, for no gain.
 */
@Controller('auth')
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  /*
   * `applicant` BELONGS ON THIS LIST, and leaving it off was a real defect.
   *
   * This is the endpoint the web client calls on every load to decide whether
   * anyone is signed in. An applicant that cannot reach it is rendered as
   * anonymous — so the account can authenticate, hold a valid token, and still
   * be unable to see /verification, which is the single screen the role exists
   * to reach (§5.1 P0: know where your application stands without contacting
   * the platform team).
   *
   * `assistant` BELONGS HERE TOO, and leaving it off repeated the same defect
   * one role later. An assistant could obtain a valid token and was then shown
   * the signed-out screen, because this endpoint answered 403 and the client
   * reads that as "nobody is signed in". A role added to `ROLES` without being
   * added here can authenticate and still not be able to log in.
   *
   * Listing a role here grants REACHABILITY only. The response is built from
   * the caller's own row, which row-level security already restricts to
   * themselves, so an applicant learns nothing here they should not.
   */
  @RequiresRole(
    'patient',
    'libya_doctor',
    'tunisia_doctor',
    'admin',
    'applicant',
    'assistant',
  )
  @Get('me')
  async me(): Promise<CurrentUser> {
    return this.identity.currentUser();
  }
}
