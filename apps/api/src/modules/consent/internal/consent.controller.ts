import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { localeSchema } from '@mir/contracts';
import { RequiresRole } from '../../../shared/authz/access-metadata';
import { ConsentService } from './consent.service';

/**
 * Consent HTTP layer — BUILD_SPEC P5.3.
 *
 * CONSENT IS NEVER OPEN-ENDED. `grantedTo` is required, so the patient agrees
 * to a NAMED doctor receiving their imaging, not to "sharing" in the abstract.
 * That is what makes revocation meaningful and what makes the Chapter V
 * position defensible: the decisions file records that a Tunisian doctor's
 * access is a restricted transfer, and a blanket consent could not describe
 * the recipient of one.
 *
 * WHO SUBMITS IT. The referring doctor, as an attestation — migration 0021
 * removed patient accounts, so there is no patient session in which a patient
 * could click anything. The patient still signs, on paper; the doctor uploads
 * the scan and asserts they hold it. The RLS policy checks all three things
 * that matter: the caller is a referring doctor, the patient is one they
 * created, and the attestation names the caller themselves.
 *
 * The client also sends back the exact text it displayed. The service hashes
 * it and refuses if it does not match the published wording — a stale tab
 * showing superseded terms is rejected rather than recorded.
 */

const attestSchema = z.object({
  patientId: z.string().uuid(),
  grantedTo: z.string().uuid(),
  version: z.string().min(1).max(32),
  locale: localeSchema,
  renderedText: z.string().min(1).max(20_000),
  scope: z.string().max(64).optional(),
  /** Where the scan of the signed paper form is stored. */
  documentObjectKey: z.string().min(1).max(512),
  /** SHA-256 of the uploaded document bytes, lowercase hex. */
  documentSha256: z.string().regex(/^[0-9a-f]{64}$/, 'must be a lowercase sha-256 digest'),
  /**
   * The doctor confirms they hold the signed form.
   *
   * A literal `true` rather than a boolean: an attestation that can arrive
   * `false` is a field a caller can forget, and "submitted without attesting"
   * should be unrepresentable rather than merely rejected.
   */
  attested: z.literal(true),
});

const termsQuerySchema = z.object({
  locale: localeSchema,
  scope: z.string().max(64).optional(),
});

const patientQuerySchema = z.object({ patientId: z.string().uuid() });

@Controller('consent')
export class ConsentController {
  constructor(private readonly consent: ConsentService) {}

  /**
   * The current published terms.
   *
   * Readable by the patient who must agree and by the referring doctor who
   * explains them. Not public: the wording is versioned evidence, and an
   * unauthenticated endpoint would be one more thing to keep in step.
   */
  @RequiresRole('libya_doctor')
  @Get('terms')
  async terms(@Query() query: unknown): Promise<{
    version: string;
    locale: string;
    scope: string;
    body: string;
    contentHash: string;
  }> {
    const { locale, scope } = termsQuerySchema.parse(query);
    const terms = await this.consent.getCurrentTerms(locale, scope);
    return {
      version: terms.version,
      locale: terms.locale,
      scope: terms.scope,
      body: terms.body,
      contentHash: terms.contentHash,
    };
  }

  @RequiresRole('libya_doctor')
  @Get()
  async listForPatient(
    @Query() query: unknown,
  ): Promise<{ consents: { consentId: string; grantedTo: string; grantedAt: string }[] }> {
    const { patientId } = patientQuerySchema.parse(query);
    const rows = await this.consent.listActiveForPatient(patientId);
    return {
      consents: rows.map((r) => ({
        consentId: r.consentId,
        grantedTo: r.grantedTo,
        grantedAt: r.grantedAt.toISOString(),
      })),
    };
  }

  /**
   * The referring doctor records their attestation and the signed form.
   *
   * The comment that stood here said "only the PATIENT may grant; a doctor
   * cannot consent on a patient's behalf". That is still true of the CONSENT —
   * the patient signs the paper. What this endpoint records is the doctor's
   * assertion that they hold that signature, which is a different claim and is
   * evidenced by the uploaded document rather than by a checkbox alone.
   */
  @RequiresRole('libya_doctor')
  @Post()
  @HttpCode(201)
  async attest(@Body() body: unknown): Promise<{ consentId: string; evidenceHash: string }> {
    const input = attestSchema.parse(body);
    return this.consent.attest(input);
  }

  @RequiresRole('libya_doctor')
  @Delete(':id')
  @HttpCode(204)
  async revoke(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.consent.revoke(id);
  }
}
