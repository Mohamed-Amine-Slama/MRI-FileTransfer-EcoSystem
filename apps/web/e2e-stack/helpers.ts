import { expect, type Page } from '@playwright/test';
import pg from 'pg';
import type { Role } from '@mir/contracts';

const env = (k: string, d: string): string => process.env[k] ?? d;
export const STACK = {
  web: env('E2E_WEB', 'http://127.0.0.1:3231'),
  api: env('E2E_API', 'http://127.0.0.1:3110'),
  kc: env('E2E_KC', 'http://localhost:8081'),
  db: env('E2E_DB', 'postgresql://postgres:postgres@127.0.0.1:5433/mir'),
};
for (const [k, v] of Object.entries(STACK)) {
  if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(v).hostname)) {
    throw new Error(`stack suite refuses a non-loopback ${k}: it uses dev credentials and writes data`);
  }
}

export const ACCOUNTS = {
  clinic: { email: 'dev-doctor@example.test', password: 'dev-doctor-pass-1234', role: 'libya_doctor' },
  doctor: { email: 'dev-receiver@example.test', password: 'dev-receiver-pass-1234', role: 'tunisia_doctor' },
  ops: { email: 'dev-ops@example.test', password: 'dev-ops-pass-1234', role: 'admin' },
  assistant: { email: 'dev-assistant@example.test', password: 'dev-assist-pass-1234', role: 'assistant' },
} as const satisfies Record<string, { email: string; password: string; role: Role }>;

export async function token(email: string, password: string): Promise<string> {
  const res = await fetch(`${STACK.kc}/realms/mir/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'mir-web', username: email, password, scope: 'openid' }),
  });
  if (!res.ok) throw new Error(`token for ${email}: ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

export async function apiCall<T = unknown>(
  bearer: string,
  path: string,
  init: { method?: string; body?: unknown; idempotent?: boolean } = {},
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${STACK.api}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
      ...(init.idempotent === true ? { 'idempotency-key': crypto.randomUUID() } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  return { status: res.status, body: (text === '' ? null : JSON.parse(text)) as T };
}

export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client(STACK.db);
  await client.connect();
  try {
    return (await client.query(sql, params)).rows as T[];
  } finally {
    await client.end();
  }
}

export async function signIn(page: Page, who: keyof typeof ACCOUNTS): Promise<void> {
  const { email, password } = ACCOUNTS[who];
  await page.goto('/login');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
}

let seed: { patientId: string; studyId: string; receiverId: string } | null = null;
/** The seeded MR study and its patient (dev-seed-imaging.mjs), and dev-receiver. */
export async function SEED(): Promise<{ patientId: string; studyId: string; receiverId: string }> {
  if (seed !== null) return seed;
  const [row] = await query<{ patient_id: string; study_id: string; receiver: string }>(
    `SELECT c.patient_id, cs.study_id,
            (SELECT id FROM identity_users WHERE email = 'dev-receiver@example.test') AS receiver
       FROM cases_cases c JOIN cases_case_studies cs ON cs.case_id = c.id
      WHERE c.reason = 'seed:accepted'`,
  );
  if (row === undefined) {
    throw new Error('no seeded study: run scripts/dev-bootstrap.mjs then scripts/dev-seed-imaging.mjs');
  }
  seed = { patientId: row.patient_id, studyId: row.study_id, receiverId: row.receiver };
  return seed;
}

/** A fresh case accepted by dev-receiver, with the seeded MR study linked. */
export async function acceptedCase(opts: { reason?: string } = {}): Promise<{ id: string; ref: string }> {
  const s = await SEED();
  const lab = await token(ACCOUNTS.clinic.email, ACCOUNTS.clinic.password);
  const doc = await token(ACCOUNTS.doctor.email, ACCOUNTS.doctor.password);
  const must = <T>(r: { status: number; body: T }, what: string): T => {
    expect(r.status, `${what}: ${JSON.stringify(r.body)}`).toBeLessThan(300);
    return r.body;
  };
  must(await apiCall(doc, '/doctors/me/accepting', { method: 'PATCH', body: { accepting: true } }), 'accepting');
  const c = must(
    await apiCall<{ id: string }>(lab, '/cases', {
      method: 'POST',
      body: {
        patientId: s.patientId,
        specialty: 'radiology',
        studyIds: [s.studyId],
        reason: opts.reason ?? `stack ${Date.now()}`,
      },
    }),
    'submit',
  );
  must(await apiCall(lab, `/cases/${c.id}/quote`, { method: 'POST', body: { doctorId: s.receiverId } }), 'quote');
  must(await apiCall(lab, `/cases/${c.id}/pay`, { method: 'POST', idempotent: true }), 'pay');
  must(await apiCall(doc, `/cases/${c.id}/accept`, { method: 'POST', idempotent: true }), 'accept');
  const [row] = await query<{ case_ref: string }>('SELECT case_ref FROM cases_cases WHERE id = $1', [c.id]);
  if (row === undefined) throw new Error(`case ${c.id} not found after submit`);
  return { id: c.id, ref: row.case_ref };
}
