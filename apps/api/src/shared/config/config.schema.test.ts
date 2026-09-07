import { describe, expect, it } from 'vitest';
import { ConfigValidationError, loadConfig } from './config.schema';

/** A complete, valid environment. Tests mutate copies of this. */
const VALID: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://app:pw@localhost:5432/mir',
  REDIS_URL: 'redis://localhost:6379',
  KEYCLOAK_ISSUER_URL: 'https://auth.example.test/realms/mir',
  KEYCLOAK_AUDIENCE: 'mir-api',
  KEYCLOAK_JWKS_URL: 'https://auth.example.test/realms/mir/protocol/openid-connect/certs',
  AWS_REGION: 'eu-south-1',
  S3_BUCKET_ORIGINALS: 'mir-dev-dicom-originals',
  S3_BUCKET_DERIVED: 'mir-dev-derived',
  S3_BUCKET_AUDIT_LOGS: 'mir-dev-audit-logs',
  ORTHANC_URL: 'http://orthanc.internal:8042',
  ORTHANC_USERNAME: 'mir-api',
  ORTHANC_PASSWORD: 'local-dev-only',
  SIGNED_URL_SECRET: 'test-signing-key-at-least-32-characters-long',
};

describe('config validation (P1.6)', () => {
  it('accepts a complete environment and applies documented defaults', () => {
    const cfg = loadConfig(VALID);
    expect(cfg.PORT).toBe(3000);
    expect(cfg.UPLOAD_CHUNK_SIZE_BYTES).toBe(5 * 1024 * 1024); // P7.2 default
    expect(cfg.SIGNED_URL_TTL_SECONDS).toBe(600); // P8.2, within 5-15 min
    expect(cfg.CASES_QUOTE_TTL_MINUTES).toBe(30);
    expect(cfg.CASES_ANSWER_WINDOW_HOURS).toBe(72);
  });

  it('refuses to start when a required variable is missing, and names it', () => {
    const env = { ...VALID };
    delete env['DATABASE_URL'];

    expect(() => loadConfig(env)).toThrow(ConfigValidationError);
    try {
      loadConfig(env);
    } catch (err) {
      // The message must be actionable at 3am, not a stack trace.
      expect((err as Error).message).toContain('DATABASE_URL');
      expect((err as Error).message).toContain('refusing to start');
    }
  });

  it('reports every problem at once, not just the first', () => {
    const env = { ...VALID };
    delete env['DATABASE_URL'];
    delete env['REDIS_URL'];
    delete env['ORTHANC_URL'];

    try {
      loadConfig(env);
      expect.unreachable('should have thrown');
    } catch (err) {
      const issues = (err as ConfigValidationError).issues;
      expect(issues.length).toBeGreaterThanOrEqual(3);
      expect(issues.join('\n')).toContain('DATABASE_URL');
      expect(issues.join('\n')).toContain('REDIS_URL');
      expect(issues.join('\n')).toContain('ORTHANC_URL');
    }
  });

  it('rejects a malformed database URL rather than failing later at connect time', () => {
    expect(() => loadConfig({ ...VALID, DATABASE_URL: 'mysql://nope' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('enforces the P8.2 signed-URL window of 5-15 minutes', () => {
    // A deployment must not be able to widen this to hours.
    expect(() => loadConfig({ ...VALID, SIGNED_URL_TTL_SECONDS: '86400' })).toThrow(
      /SIGNED_URL_TTL_SECONDS/,
    );
    expect(() => loadConfig({ ...VALID, SIGNED_URL_TTL_SECONDS: '10' })).toThrow(
      /SIGNED_URL_TTL_SECONDS/,
    );
    expect(loadConfig({ ...VALID, SIGNED_URL_TTL_SECONDS: '900' }).SIGNED_URL_TTL_SECONDS).toBe(
      900,
    );
  });


  it('requires a signing key long enough to be a key (P8.2)', () => {
    // A short HMAC key is brute-forceable, and these URLs grant access to
    // patient imaging.
    expect(() => loadConfig({ ...VALID, SIGNED_URL_SECRET: 'short' })).toThrow(
      /SIGNED_URL_SECRET/,
    );
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => loadConfig({ ...VALID, NODE_ENV: 'prod' })).toThrow(/NODE_ENV/);
  });

  it('keeps retention periods configurable (BLOCKING L5)', () => {
    // Counsel has not answered L5. These must be settable without a code change.
    const cfg = loadConfig({ ...VALID, IMAGING_RETENTION_DAYS: '7300' });
    expect(cfg.IMAGING_RETENTION_DAYS).toBe(7300);
  });
});
