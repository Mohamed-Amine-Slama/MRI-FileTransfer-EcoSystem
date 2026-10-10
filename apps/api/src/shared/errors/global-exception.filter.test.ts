import type { ArgumentsHost } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { GlobalExceptionFilter } from './global-exception.filter';

function run(exception: unknown): { status: number; body: Record<string, unknown> } {
  const out = { status: 0, body: {} as Record<string, unknown> };
  const response = {
    status(code: number) {
      out.status = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      out.body = body;
    },
  };
  const host = { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ArgumentsHost;
  new GlobalExceptionFilter().catch(exception, host);
  return out;
}

/** The shape body-parser throws (http-errors). */
function httpError(status: number, message: string, expose: boolean): Error {
  return Object.assign(new Error(message), { status, statusCode: status, expose });
}

describe('GlobalExceptionFilter — body-parser refusals', () => {
  it('passes an oversized body through as 413, not 500', () => {
    const res = run(httpError(413, 'request entity too large', true));
    expect(res.status).toBe(413);
    expect(res.body['message']).toBe('request entity too large');
  });

  it('still hides errors not marked safe to expose', () => {
    const res = run(httpError(400, 'SELECT * FROM identity_users', false));
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('identity_users');
  });

  it('never exposes a 5xx, even when flagged', () => {
    expect(run(httpError(503, 'pool exhausted', true)).status).toBe(500);
  });
});
