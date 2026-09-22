#!/usr/bin/env node
/**
 * Puts one real MR series into the local world, THROUGH THE API.
 *
 * Not SQL: an upload writes the original to storage, stores it in Orthanc,
 * records instances, and builds the de-identified twin the receiving doctor
 * reads. Faking those rows would give a viewer that 404s on every frame.
 *
 * Runs as the referring clinic's doctor (ROPC — dev realm only), uploads
 * test-data/dicom/03-mr-series for the patient on the `seed:accepted` case,
 * waits for ingestion (ImagingWorker) to finish, then links the study to the
 * `seed:accepted` and `seed:answered` cases. Idempotent: skips the upload when
 * that patient already has a study.
 *
 *   node scripts/dev-seed-imaging.mjs       (after dev-bootstrap.mjs, API up)
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env['API_URL'] ?? 'http://127.0.0.1:3100';
const KC = process.env['KC_SERVER'] ?? 'http://localhost:8081';
const SERIES = join(REPO, 'test-data', 'dicom', '03-mr-series');

for (const [label, url] of [['API_URL', API], ['KC_SERVER', KC]]) {
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname)) {
    console.error(`refusing to run: ${label} is not loopback — this uses dev-only credentials`);
    process.exit(1);
  }
}

function sql(query) {
  return execFileSync(
    'docker',
    ['exec', 'mir-postgres', 'psql', '-U', 'postgres', '-d', 'mir', '-Atc', query],
    { encoding: 'utf8' },
  ).trim();
}

async function token() {
  const res = await fetch(`${KC}/realms/mir/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'mir-web',
      username: 'dev-doctor@example.test',
      password: 'dev-doctor-pass-1234',
      scope: 'openid',
    }),
  });
  if (!res.ok) throw new Error(`token: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function call(bearer, path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${bearer}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text === '' ? null : JSON.parse(text);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const patientId = sql(`select patient_id from cases_cases where reason = 'seed:accepted'`);
  if (patientId === '') throw new Error('run scripts/dev-bootstrap.mjs first');

  let studyId = sql(`select id from imaging_studies where patient_id = '${patientId}' limit 1`);
  if (studyId === '') {
    const bearer = await token();
    const files = readdirSync(SERIES).filter((f) => f.endsWith('.dcm')).sort();
    const { sessionId } = await call(bearer, '/uploads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ patientId, expectedFileCount: files.length }),
    });
    for (const name of files) {
      const bytes = readFileSync(join(SERIES, name));
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const state = await call(bearer, `/uploads/${sessionId}/files`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientFileId: name, fileName: name, sizeBytes: bytes.length, sha256 }),
      });
      const chunk = state.chunkSizeBytes;
      for (let i = 0, off = 0; off < bytes.length; i += 1, off += chunk) {
        await call(bearer, `/uploads/files/${state.fileId}/chunks/${i}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/octet-stream' },
          body: bytes.subarray(off, off + chunk),
        });
      }
      await call(bearer, `/uploads/files/${state.fileId}/complete`, { method: 'POST' });
      process.stdout.write('.');
    }
    process.stdout.write('\n');
  }

  // Ingestion and the twin build run in the API's ImagingWorker.
  for (let i = 0; i < 60; i += 1) {
    const row = sql(
      `select id || '|' || status || '|' || coalesce(twin_study_uid, '') from imaging_studies
        where patient_id = '${patientId}' order by created_at desc limit 1`,
    );
    const [id, status, twin] = row.split('|');
    if (id && status === 'ready' && twin) {
      studyId = id;
      break;
    }
    if (i === 0 || i % 5 === 0) console.log(`  waiting for ingestion: ${status ?? 'no study yet'}`);
    await sleep(2000);
  }
  if (studyId === '') throw new Error('the study did not become ready — check the API log');

  for (const reason of ['seed:accepted', 'seed:answered']) {
    sql(`insert into cases_case_studies (case_id, study_id)
         select id, '${studyId}' from cases_cases where reason = '${reason}'
         on conflict do nothing`);
  }

  const uid = sql(`select study_instance_uid from imaging_studies where id = '${studyId}'`);
  console.log(`study ${studyId}\n  uid ${uid}\n  linked to seed:accepted, seed:answered`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
