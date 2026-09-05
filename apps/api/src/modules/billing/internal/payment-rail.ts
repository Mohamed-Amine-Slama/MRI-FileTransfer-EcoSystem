/**
 * UNWIRED ON PURPOSE — nothing imports this file.
 *
 * The patient's card was the only payer this platform ever had, and migration
 * 0021 removed patient accounts. The Stripe authorise-at-booking /
 * capture-on-acceptance flow that used this port went with them, along with
 * `billing_payments` and the module that owned it. Acceptance is now a
 * scheduling decision (SchedulingService.accept) because that is what it
 * always was once money stopped moving through it.
 *
 * WHY THE FILE STAYS. Organisation-side collection will need a rail when
 * BLOCKING ITEM L7 resolves — whether a Libyan payer can lawfully pay a
 * Tunisian-facing platform, and where the receiving entity must be
 * incorporated. The INTERFACE is the part worth preserving; re-deriving the
 * port shape, the webhook signature verification, and the idempotency contract
 * from scratch would be the expensive half.
 *
 * `pnpm scan:unwired` reports this file. That is correct and expected — this
 * comment is the answer to the question that script asks. Do NOT wire it back
 * up to make the report quiet; wire it up when there is a payer.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

// The DI token lives in payment-rail.tokens.ts so consumers can import it
// without pulling in the Stripe implementation.

/**
 * Payment rail abstraction — BUILD_SPEC P11, DECISION D2/D2a.
 *
 * WHY AN INTERFACE RATHER THAN CALLING STRIPE DIRECTLY:
 * L7 is unresolved. Stripe requires the business to be established in a
 * country it supports, and to the best of our knowledge neither Libya nor
 * Tunisia is on that list — so the corporate structure, and possibly the rail
 * itself, may still change. Everything behind this interface is replaceable
 * without touching scheduling, which is the module that actually cares whether
 * an appointment is paid for.
 *
 * D2 requires AUTHORISE-THEN-CAPTURE: hold the money when the patient books,
 * take it when the Tunisian doctor accepts the case. Any rail that cannot do
 * that cannot implement D2, which is the concrete thing to check before
 * committing to an alternative.
 */

export interface AuthorisationRequest {
  amountMinor: number;
  currency: string;
  /** Stripe requires this to be stable across retries (P11.2 rule 2). */
  idempotencyKey: string;
  /** Opaque reference so a provider dashboard row can be traced back. */
  reference: string;
}

export interface AuthorisationResult {
  providerIntentId: string;
  status: 'authorised' | 'requires_action' | 'failed';
  /** Present when the customer must complete 3-D Secure or similar. */
  clientSecret?: string;
  failureReason?: string;
}

export interface CaptureResult {
  status: 'captured' | 'failed';
  failureReason?: string;
}

export interface PaymentRail {
  readonly name: string;
  /** Hold funds without taking them. */
  authorise(request: AuthorisationRequest): Promise<AuthorisationResult>;
  /** Take previously held funds. */
  capture(providerIntentId: string, idempotencyKey: string): Promise<CaptureResult>;
  /** Release a hold that will never be captured. */
  cancel(providerIntentId: string, idempotencyKey: string): Promise<void>;
  /**
   * Verify a webhook came from the provider and has not been replayed from an
   * old capture. Returns the parsed event, or throws.
   */
  verifyWebhook(rawBody: string, signatureHeader: string): WebhookEvent;
}

export interface WebhookEvent {
  id: string;
  type: string;
  providerIntentId: string | undefined;
}

export class WebhookVerificationError extends Error {
  constructor(reason: string) {
    super(`Webhook rejected: ${reason}`);
    this.name = 'WebhookVerificationError';
  }
}

/**
 * How long a signed webhook stays acceptable.
 *
 * Stripe's own guidance is five minutes. Without a bound, an attacker who ever
 * captures one valid signed payload can replay it forever — the signature
 * stays valid because the body never changes. The database's event-id table
 * catches duplicates too, but defence in depth: this rejects the request
 * before it reaches any state.
 */
const MAX_SIGNATURE_AGE_SECONDS = 300;

/**
 * Stripe rail, implemented against the REST API directly.
 *
 * No SDK: the surface used here is three endpoints and one HMAC, and the SDK
 * is a large dependency whose install repeatedly failed on this repository's
 * filesystem. Signature verification in particular is better written out —
 * it is security-critical and should be readable, not delegated.
 */
export class StripePaymentRail implements PaymentRail {
  readonly name = 'stripe';

  constructor(
    private readonly secretKey: string,
    private readonly webhookSecret: string,
    private readonly apiBase = 'https://api.stripe.com/v1',
    private readonly now: () => number = () => Date.now(),
  ) {}

  async authorise(request: AuthorisationRequest): Promise<AuthorisationResult> {
    const body = new URLSearchParams({
      amount: String(request.amountMinor),
      currency: request.currency.toLowerCase(),
      // The whole of D2 in one parameter: hold now, take later.
      capture_method: 'manual',
      'metadata[reference]': request.reference,
    });

    const res = await this.post('/payment_intents', body, request.idempotencyKey);
    const json = (await res.json()) as {
      id?: string;
      status?: string;
      client_secret?: string;
      error?: { message?: string };
    };

    if (!res.ok || json.id === undefined) {
      return {
        providerIntentId: '',
        status: 'failed',
        failureReason: json.error?.message ?? `provider returned ${res.status}`,
      };
    }

    return {
      providerIntentId: json.id,
      status: json.status === 'requires_capture' ? 'authorised' : 'requires_action',
      ...(json.client_secret !== undefined ? { clientSecret: json.client_secret } : {}),
    };
  }

  async capture(providerIntentId: string, idempotencyKey: string): Promise<CaptureResult> {
    const res = await this.post(
      `/payment_intents/${encodeURIComponent(providerIntentId)}/capture`,
      new URLSearchParams(),
      idempotencyKey,
    );
    const json = (await res.json()) as { status?: string; error?: { message?: string } };

    if (!res.ok || json.status !== 'succeeded') {
      return {
        status: 'failed',
        failureReason: json.error?.message ?? `provider returned ${res.status}`,
      };
    }
    return { status: 'captured' };
  }

  async cancel(providerIntentId: string, idempotencyKey: string): Promise<void> {
    await this.post(
      `/payment_intents/${encodeURIComponent(providerIntentId)}/cancel`,
      new URLSearchParams(),
      idempotencyKey,
    );
  }

  /**
   * Verify a Stripe webhook signature.
   *
   * Header form: `t=<unix seconds>,v1=<hex hmac>[,v1=<hmac>...]`
   * Signed payload: `<t>.<raw body>` — the RAW body, byte for byte. Verifying
   * a re-serialised JSON object silently fails whenever key order or number
   * formatting differs, and the usual "fix" is to stop verifying.
   */
  verifyWebhook(rawBody: string, signatureHeader: string): WebhookEvent {
    const parts = signatureHeader.split(',').map((p) => p.trim());
    const timestamp = parts.find((p) => p.startsWith('t='))?.slice(2);
    const signatures = parts.filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));

    if (timestamp === undefined || signatures.length === 0) {
      throw new WebhookVerificationError('malformed signature header');
    }

    const age = Math.floor(this.now() / 1000) - Number(timestamp);
    if (!Number.isFinite(age)) {
      throw new WebhookVerificationError('malformed timestamp');
    }
    if (Math.abs(age) > MAX_SIGNATURE_AGE_SECONDS) {
      // Also rejects far-future timestamps: an attacker controls the value and
      // could otherwise mint one valid for years.
      throw new WebhookVerificationError('signature timestamp outside tolerance');
    }

    const expected = createHmac('sha256', this.webhookSecret)
      .update(`${timestamp}.${rawBody}`, 'utf8')
      .digest('hex');

    const matched = signatures.some((candidate) => {
      const a = Buffer.from(candidate, 'utf8');
      const b = Buffer.from(expected, 'utf8');
      return a.length === b.length && timingSafeEqual(a, b);
    });

    if (!matched) throw new WebhookVerificationError('signature mismatch');

    let parsed: { id?: string; type?: string; data?: { object?: { id?: string } } };
    try {
      parsed = JSON.parse(rawBody) as typeof parsed;
    } catch {
      throw new WebhookVerificationError('body is not valid JSON');
    }

    if (parsed.id === undefined || parsed.type === undefined) {
      throw new WebhookVerificationError('event has no id or type');
    }

    return {
      id: parsed.id,
      type: parsed.type,
      providerIntentId: parsed.data?.object?.id,
    };
  }

  private async post(
    path: string,
    body: URLSearchParams,
    idempotencyKey: string,
  ): Promise<Response> {
    return fetch(`${this.apiBase}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
        // Stripe deduplicates on this for 24 hours, so a retried request
        // returns the ORIGINAL result rather than charging twice.
        'idempotency-key': idempotencyKey,
      },
      body,
      signal: AbortSignal.timeout(20_000),
    });
  }
}
