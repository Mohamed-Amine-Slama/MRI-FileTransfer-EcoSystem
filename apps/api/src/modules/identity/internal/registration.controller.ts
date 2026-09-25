import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { registrationSchema, uiLocaleSchema, verificationCodeSchema } from '@mir/contracts';
import { PublicEndpoint } from '../../../shared/authz/access-metadata';
import { RateLimit } from '../../../shared/ratelimit/rate-limit.guard';
import { RegistrationService } from './registration.service';

/**
 * Self-service sign-up — brief §5.1.
 *
 * THE THREE ROUTES HERE ARE THE ONLY @PublicEndpoint ROUTES THAT WRITE. Each is
 * a deliberate, reviewable statement that it is safe to expose to the internet,
 * and each earns it the same way:
 *
 *   * They touch no patient data. Registration creates an `applicant`, and no
 *     row-level security policy in this schema names that role.
 *   * They go through SECURITY DEFINER functions with the rule baked in, not
 *     through a widened policy. `identity_register_account` has no role
 *     parameter; there is no request body that produces a clinician.
 *   * Every one of them is rate limited, and every one answers identically
 *     whether or not the address exists.
 *
 * ALL THREE RETURN 204. Not 201, not a body, not an id. A response that varied
 * with whether the address was already registered would be an enumeration
 * oracle for which clinicians have accounts on this platform — the same reason
 * /reset-password answers identically, and the same reason the patient claim
 * screen renders one sentence for four different failures.
 */

const verifySchema = z.object({
  email: z.string().email().max(254),
  code: verificationCodeSchema,
});

const resendSchema = z.object({
  email: z.string().email().max(254),
  locale: uiLocaleSchema,
});

@Controller('auth')
export class RegistrationController {
  constructor(private readonly registration: RegistrationService) {}

  /**
   * Keyed on the IP, because there is no account yet to key on. The `login`
   * budget (5 per 5 minutes, doubling lockout) is the right shape: registration
   * is rare enough that a clinic sharing one NAT will not notice it, and it
   * bounds automated account creation.
   */
  @PublicEndpoint()
  @RateLimit('login')
  @Post('register')
  @HttpCode(204)
  async register(@Body() body: unknown): Promise<void> {
    await this.registration.register(registrationSchema.parse(body));
  }

  /**
   * Keyed on the ADDRESS, not the IP.
   *
   * The `otpRequest` budget is 3 per 15 minutes. Against an IP that would lock
   * out the second member of staff at a clinic to sign up that morning, because
   * the first one used the budget. The abuse this prevents is guessing the code
   * for one account, so the budget belongs to that account — the same argument
   * the guard already makes for keying claim-code issuance on the patient's
   * phone rather than on the issuing doctor.
   */
  @PublicEndpoint()
  // Narrowed to the IP as well: keyed on the address alone, four wrong codes
  // from anyone locked the real owner out of verifying AND resending (the two
  // routes shared one bucket). Guessing stays bounded — the database caps
  // attempts per code.
  @RateLimit('otpRequest', { keyBy: 'body+ip:email' })
  @Post('verify-email')
  @HttpCode(204)
  async verifyEmail(@Body() body: unknown): Promise<void> {
    const input = verifySchema.parse(body);
    // The boolean is deliberately DISCARDED. Wrong, expired, already used and
    // too-many-attempts are indistinguishable inside the function, and turning
    // any of them into a 4xx here would undo that at the last step.
    await this.registration.verify(input.email, input.code);
  }

  @PublicEndpoint()
  @RateLimit('otpRequest', { keyBy: 'body:email' })
  @Post('resend-code')
  @HttpCode(204)
  async resend(@Body() body: unknown): Promise<void> {
    const input = resendSchema.parse(body);
    await this.registration.issueCode(input.email, input.locale);
  }
}
