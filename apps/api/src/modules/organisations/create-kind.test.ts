import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { OrganisationsController } from './internal/organisations.controller';

/**
 * Who may register — requirements §2, spec 2026-09-21 §2.
 *
 * Libya refers through clinics and laboratories; Tunisia answers through
 * individual doctors. The API is the gate: the sign-up form only mirrors it.
 * A ZodError here becomes a 400 in GlobalExceptionFilter.
 */
const controller = new OrganisationsController({ create: async () => ({ id: 'org' }) } as never);

const body = (kind: string, side: string) => ({
  kind,
  side,
  legalName: 'Synthetic Practice',
  corridorId: 'ly-tn',
  credentials: {},
  seatCount: 1,
});

describe('POST /organisations — kinds per side', () => {
  it('refuses a Tunisian clinic', async () => {
    await expect(controller.create(body('clinic', 'destination'))).rejects.toBeInstanceOf(ZodError);
  });

  it('refuses a Libyan doctor', async () => {
    await expect(controller.create(body('doctor', 'source'))).rejects.toBeInstanceOf(ZodError);
  });

  it('refuses a hospital on either side', async () => {
    await expect(controller.create(body('hospital', 'source'))).rejects.toBeInstanceOf(ZodError);
    await expect(controller.create(body('hospital', 'destination'))).rejects.toBeInstanceOf(ZodError);
  });

  it('accepts a Libyan clinic or laboratory and a Tunisian doctor', async () => {
    await expect(controller.create(body('clinic', 'source'))).resolves.toBeDefined();
    await expect(controller.create(body('laboratory', 'source'))).resolves.toBeDefined();
    await expect(controller.create(body('doctor', 'destination'))).resolves.toBeDefined();
  });
});
