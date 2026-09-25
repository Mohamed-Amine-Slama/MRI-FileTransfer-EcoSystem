import { chromium, expect, test, type BrowserContext, type Route } from '@playwright/test';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * BUILD_SPEC P7.3 gate:
 * "Start a large upload, hard-close the browser, reopen -> upload resumes
 *  without user action."
 *
 * This uses a PERSISTENT browser profile and genuinely closes it mid-transfer,
 * because that is the only way IndexedDB survives and the only way the test
 * proves anything. A normal Playwright context is discarded on close, so a
 * reload-based test would pass against an implementation that keeps the queue
 * in memory — exactly the implementation this gate exists to rule out.
 *
 * The API is stubbed, with server state held in this process so it survives
 * the browser restart. The real server logic is covered by the P7.1/P7.2/P7.4
 * suite against a real database; what is under test here is the CLIENT's
 * ability to lose everything and recover.
 */

const CHUNK_SIZE = 16 * 1024;

interface StubFile {
  id: string;
  clientFileId: string;
  declaredSha: string;
  declaredSize: number;
  chunks: Buffer[];
  complete: boolean;
}

/** Server state, deliberately outside the browser so it outlives the crash. */
class StubServer {
  readonly files = new Map<string, StubFile>();
  readonly byClientId = new Map<string, string>();
  totalChunkBytesReceived = 0;
  private seq = 0;

  reset(): void {
    this.files.clear();
    this.byClientId.clear();
    this.totalChunkBytesReceived = 0;
  }

  register(input: {
    clientFileId: string;
    sha256: string;
    sizeBytes: number;
  }): { fileId: string; nextChunkIndex: number; receivedBytes: number; chunkSizeBytes: number } {
    let id = this.byClientId.get(input.clientFileId);
    if (id === undefined) {
      id = `f${++this.seq}`;
      this.byClientId.set(input.clientFileId, id);
      this.files.set(id, {
        id,
        clientFileId: input.clientFileId,
        declaredSha: input.sha256,
        declaredSize: input.sizeBytes,
        chunks: [],
        complete: false,
      });
    }
    const file = this.files.get(id);
    if (file === undefined) throw new Error('unreachable');
    return {
      fileId: id,
      // The authoritative resume point.
      nextChunkIndex: file.chunks.length,
      receivedBytes: file.chunks.reduce((n, c) => n + c.byteLength, 0),
      chunkSizeBytes: CHUNK_SIZE,
    };
  }
}

async function routeApi(context: BrowserContext, server: StubServer): Promise<void> {
  // The session provider only asks /me once it holds a token, and after a
  // load it gets one from the refresh cookie. Without this stub the page stays
  // signed out and the upload screen never renders.
  await context.route('**/auth/refresh', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ accessToken: 'e2e-token' }),
    });
  });

  // The upload screen is behind RoleGate, so the session lookup has to answer
  // before anything else renders. Stubbing it here rather than bypassing the
  // gate keeps these tests on the same code path a real doctor takes.
  await context.route('**/api/auth/me', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        userId: 'u-libya-doctor',
        role: 'libya_doctor',
        displayName: 'Dr Test',
        mfaEnrolled: true,
      }),
    });
  });

  // The patient selector: a study must be attached to a record before the
  // folder input is enabled.
  await context.route('**/api/patients', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        patients: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            fullName: 'Test Patient',
            phoneE164: '+218910000000',
            dateOfBirth: '1990-01-01',
            sex: 'M',
          },
        ],
      }),
    });
  });

  await context.route('**/api/uploads', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sessionId: 'session-1' }),
    });
  });

  await context.route('**/api/uploads/*/files', async (route: Route) => {
    const body = route.request().postDataJSON() as {
      clientFileId: string;
      sha256: string;
      sizeBytes: number;
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(server.register(body)),
    });
  });

  await context.route('**/api/uploads/files/*/chunks/*', async (route: Route) => {
    const url = new URL(route.request().url());
    const parts = url.pathname.split('/');
    const fileId = parts[parts.length - 3] ?? '';
    const index = Number(parts[parts.length - 1]);
    const file = server.files.get(fileId);
    if (file === undefined) {
      await route.fulfill({ status: 404, body: '' });
      return;
    }

    const data = route.request().postDataBuffer() ?? Buffer.alloc(0);

    if (index < file.chunks.length) {
      await route.fulfill({ status: 200, body: '' }); // duplicate, no-op
      return;
    }
    if (index > file.chunks.length) {
      await route.fulfill({ status: 400, body: 'out of order' });
      return;
    }

    file.chunks.push(data);
    server.totalChunkBytesReceived += data.byteLength;
    await route.fulfill({ status: 200, body: '' });
  });

  await context.route('**/api/uploads/files/*/complete', async (route: Route) => {
    const url = new URL(route.request().url());
    const parts = url.pathname.split('/');
    const fileId = parts[parts.length - 2] ?? '';
    const file = server.files.get(fileId);
    if (file === undefined) {
      await route.fulfill({ status: 404, body: '' });
      return;
    }

    // Verify exactly as the real server does: decompress, then hash the
    // ORIGINAL bytes (P7.3 step 4 / ADR-4).
    const assembled = Buffer.concat(file.chunks);
    let original: Buffer;
    try {
      original = gunzipSync(assembled);
    } catch {
      await route.fulfill({ status: 400, body: 'bad gzip' });
      return;
    }
    const digest = createHash('sha256').update(original).digest('hex');
    if (digest !== file.declaredSha || original.byteLength !== file.declaredSize) {
      await route.fulfill({ status: 400, body: 'checksum mismatch' });
      return;
    }

    file.complete = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ verified: true }),
    });
  });
}

/**
 * A study folder shaped like a real clinic CD: nested, extensionless files,
 * plus the OS junk that always comes along with removable media.
 */
async function makeStudyFolder(): Promise<{ dir: string; expectedFiles: number }> {
  const dir = await mkdtemp(join(tmpdir(), 'mir-study-'));
  const dicomDir = join(dir, 'DICOM');
  await mkdir(dicomDir, { recursive: true });

  const fileCount = 6;
  for (let i = 1; i <= fileCount; i++) {
    // Random bytes, NOT zero-filled: the client gzips before transfer, and a
    // zero-filled buffer compresses to a couple of hundred bytes, so the whole
    // "large upload" would finish in one chunk per file and there would be
    // nothing to interrupt. Real DICOM pixel data is close to incompressible,
    // which is what this reproduces.
    const body = Buffer.concat([Buffer.alloc(128), Buffer.from('DICM'), randomBytes(120 * 1024)]);
    // Extensionless, as clinic CDs actually are.
    await writeFile(join(dicomDir, `IM${String(i).padStart(6, '0')}`), body);
  }

  // Must be ignored by the client, not uploaded and rejected one round trip
  // at a time.
  await writeFile(join(dicomDir, '.DS_Store'), 'junk');
  await writeFile(join(dicomDir, '._IM000001'), 'apple double');

  return { dir, expectedFiles: fileCount };
}

test.describe('P7.3 persistent upload queue', () => {
  test('resumes automatically after the browser is killed mid-upload', async () => {
    test.setTimeout(180_000);

    const server = new StubServer();
    const { dir: studyDir, expectedFiles } = await makeStudyFolder();
    const profileDir = await mkdtemp(join(tmpdir(), 'mir-profile-'));

    try {
      // ---------------------------------------------------------------------
      // 1. First session: start the upload, then kill the browser part-way.
      // ---------------------------------------------------------------------
      const first = await chromium.launchPersistentContext(profileDir, { headless: true });
      await routeApi(first, server);

      const page = await first.newPage();
      await page.goto('/upload');

      // A study is attached to a patient record when the session is created,
      // so the record is chosen before the folder.
      await page
        .getByTestId('patient-select')
        .selectOption('11111111-1111-4111-8111-111111111111');
      await page.getByTestId('folder-input').setInputFiles(studyDir);

      // Wait until the transfer is genuinely under way but nowhere near done.
      await expect
        .poll(() => server.totalChunkBytesReceived, { timeout: 60_000 })
        .toBeGreaterThan(50 * 1024);

      const bytesBeforeCrash = server.totalChunkBytesReceived;
      const completedBeforeCrash = [...server.files.values()].filter((f) => f.complete).length;
      expect(completedBeforeCrash).toBeLessThan(expectedFiles);

      // HARD CLOSE. Not a reload, not a navigation — the browser process goes
      // away, taking every bit of in-memory state with it.
      await first.close();

      // ---------------------------------------------------------------------
      // 2. Reopen with the SAME profile. IndexedDB survives; memory does not.
      // ---------------------------------------------------------------------
      const second = await chromium.launchPersistentContext(profileDir, { headless: true });
      await routeApi(second, server);

      const page2 = await second.newPage();
      await page2.goto('/upload');

      // No clicks, no folder re-selection: the gate is that it resumes
      // WITHOUT user action.
      await expect(page2.getByTestId('resume-notice')).toBeVisible({ timeout: 30_000 });

      await expect
        .poll(() => [...server.files.values()].filter((f) => f.complete).length, {
          timeout: 120_000,
        })
        .toBe(expectedFiles);

      // ---------------------------------------------------------------------
      // 3. Assertions about WHAT was transferred.
      // ---------------------------------------------------------------------

      // Every file verified server-side: decompressed, hashed, matched.
      for (const file of server.files.values()) {
        expect(file.complete, `${file.clientFileId} verified`).toBe(true);
      }

      // OS junk was never uploaded.
      const uploadedNames = [...server.files.values()].map((f) => f.clientFileId);
      expect(uploadedNames.some((n) => n.includes('.DS_Store'))).toBe(false);
      expect(uploadedNames.some((n) => n.includes('._IM'))).toBe(false);
      expect(server.files.size).toBe(expectedFiles);

      // Extensionless, nested paths were preserved — a `.dcm` filter would
      // have skipped the entire study.
      expect(uploadedNames.every((n) => n.includes('DICOM/IM'))).toBe(true);

      // The resume SAVED work: total bytes received is far below what a full
      // restart-from-zero would have cost.
      const originalTotal = expectedFiles * (120 * 1024 + 132);
      expect(server.totalChunkBytesReceived).toBeLessThan(originalTotal);
      expect(bytesBeforeCrash).toBeGreaterThan(0);

      await second.close();
    } finally {
      await rm(studyDir, { recursive: true, force: true });
      await rm(profileDir, { recursive: true, force: true });
    }
  });

  test('survives a page reload without losing progress', async () => {
    test.setTimeout(120_000);

    const server = new StubServer();
    const { dir: studyDir, expectedFiles } = await makeStudyFolder();
    const profileDir = await mkdtemp(join(tmpdir(), 'mir-profile-reload-'));

    try {
      const context = await chromium.launchPersistentContext(profileDir, { headless: true });
      await routeApi(context, server);
      const page = await context.newPage();
      await page.goto('/upload');
      await page
        .getByTestId('patient-select')
        .selectOption('11111111-1111-4111-8111-111111111111');
      await page.getByTestId('folder-input').setInputFiles(studyDir);

      await expect
        .poll(() => server.totalChunkBytesReceived, { timeout: 60_000 })
        .toBeGreaterThan(30 * 1024);

      await page.reload();

      await expect
        .poll(() => [...server.files.values()].filter((f) => f.complete).length, {
          timeout: 90_000,
        })
        .toBe(expectedFiles);

      await context.close();
    } finally {
      await rm(studyDir, { recursive: true, force: true });
      await rm(profileDir, { recursive: true, force: true });
    }
  });
});
