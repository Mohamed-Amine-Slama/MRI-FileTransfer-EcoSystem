import { expect, test, type Page, type Route } from '@playwright/test';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * BUILD_SPEC P9.1 gate:
 *   - "Time to first rendered image on a throttled connection (simulate
 *      2 Mbit/s, 200 ms latency) is under 5 seconds."
 *   - "Network trace confirms frames load on demand, not all at once."
 *   - "Banner present on every viewer screen."
 *
 * Throttling is applied through the Chrome DevTools Protocol, so it constrains
 * the real network stack rather than being simulated in application code.
 *
 * The API is stubbed and serves REAL generated thumbnails — the same bytes the
 * ingestion pipeline produces — so the measured time reflects actual payload
 * sizes rather than a placeholder.
 */

const STUDY_UID = '1.3.6.1.4.1.99999.1.102.1';
const INSTANCE_COUNT = 120;

/** 2 Mbit/s in bytes per second, and 200 ms round trip, per the spec. */
const THROTTLE = {
  offline: false,
  downloadThroughput: (2 * 1000 * 1000) / 8,
  uploadThroughput: (512 * 1000) / 8,
  latency: 200,
};

/**
 * A real JPEG thumbnail, generated from a real DICOM fixture by the same
 * service the ingestion pipeline uses. Generated once per run.
 */
function realThumbnail(): Buffer {
  const script = `
    const { ThumbnailService } = require('${join(process.cwd(), '../api/dist/modules/imaging/internal/thumbnail.service.js').replace(/\\/g, '/')}');
    const fs = require('fs');
    const bytes = new Uint8Array(fs.readFileSync('${join(process.cwd(), '../../test-data/dicom/02-ct-series-120/IM000001').replace(/\\/g, '/')}'));
    new ThumbnailService().generate(bytes).then(r => process.stdout.write(Buffer.from(r.bytes).toString('base64')));
  `;
  const out = execFileSync('node', ['-e', script], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  return Buffer.from(out, 'base64');
}

interface Trace {
  thumbnailRequests: string[];
  instanceListRequests: number;
  pixelDataRequests: number;
  /** WADO-RS frame fetches — full-fidelity pixel data (P9.1). */
  frameRequests: string[];
  /** Per-instance DICOM JSON metadata fetches. */
  metadataRequests: string[];
}

async function stubApi(page: Page, thumbnail: Buffer, trace: Trace): Promise<void> {
  await page.route('**/api/dicom-web/studies/*/instances', async (route: Route) => {
    trace.instanceListRequests++;
    const instances = Array.from({ length: INSTANCE_COUNT }, (_, i) => ({
      sopInstanceUid: `1.3.6.1.4.1.99999.1.102.1.1.${i + 1}`,
      seriesInstanceUid: '1.3.6.1.4.1.99999.1.102.1.1',
    }));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ instances }),
    });
  });

  await page.route('**/api/dicom-web/studies/*/instances/*/thumbnail', async (route: Route) => {
    const url = route.request().url();
    const sop = url.split('/instances/')[1]?.split('/')[0] ?? '';
    trace.thumbnailRequests.push(sop);
    await route.fulfill({ status: 200, contentType: 'image/jpeg', body: thumbnail });
  });

  // Per-instance metadata — Cornerstone needs this before any frame renders.
  await page.route('**/api/dicom-web/studies/*/series/*/instances/*/metadata', async (route: Route) => {
    const sop = route.request().url().split('/instances/')[1]?.split('/')[0] ?? '';
    trace.metadataRequests.push(sop);
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  // WADO-RS frames — full-fidelity pixel data.
  await page.route('**/api/dicom-web/studies/*/series/*/instances/*/frames/*', async (route: Route) => {
    const sop = route.request().url().split('/instances/')[1]?.split('/')[0] ?? '';
    trace.frameRequests.push(sop);
    await route.fulfill({ status: 404, body: '' });
  });

  // Full-fidelity pixel data. If the viewer prefetches the study, these fire.
  await page.route('**/api/dicom-web/studies/*/series/*/instances/*', async (route: Route) => {
    trace.pixelDataRequests++;
    await route.fulfill({ status: 200, contentType: 'application/dicom', body: Buffer.alloc(0) });
  });
}

function newTrace(): Trace {
  return {
    thumbnailRequests: [],
    instanceListRequests: 0,
    pixelDataRequests: 0,
    frameRequests: [],
    metadataRequests: [],
  };
}

test.describe('P9.1 viewer', () => {
  let thumbnail: Buffer;

  test.beforeAll(() => {
    thumbnail = realThumbnail();
    // Sanity: a real JPEG, and small enough to matter for the 5s budget.
    expect(thumbnail[0]).toBe(0xff);
    expect(thumbnail[1]).toBe(0xd8);
    expect(thumbnail.byteLength).toBeLessThan(40 * 1024);
  });

  test('first image renders in under 5s at 2 Mbit/s with 200ms latency (the gate)', async ({
    page,
    browser,
  }) => {
    test.skip(browser.browserType().name() !== 'chromium', 'CDP throttling is Chromium-only');
    test.setTimeout(120_000);

    const trace = newTrace();
    await stubApi(page, thumbnail, trace);

    // Throttle the real network stack, not the application.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', THROTTLE);

    const started = Date.now();
    await page.goto(`/viewer/${STUDY_UID}`);

    // "First rendered image" = a real image element has decoded and painted.
    await page.getByTestId('first-image-rendered').waitFor({ state: 'attached', timeout: 30_000 });
    const elapsed = Date.now() - started;

    // eslint-disable-next-line no-console -- the measured value is the point
    console.log(`time to first rendered image: ${elapsed}ms (budget 5000ms)`);

    // NOTE ON READING THIS NUMBER.
    // It is wall-clock and therefore sensitive to CPU contention. Measured
    // alone on the dev machine it is consistently ~985ms; with 7 parallel
    // Playwright workers on the same box it rises to ~4700ms — still inside
    // budget, but close enough to look like a regression when it is not.
    //
    // If this starts failing, re-run it with `--workers=1` BEFORE concluding
    // the viewer got slower. A genuine regression shows up in the isolated
    // number and in the JS-transferred assertion in the test below.
    expect(elapsed).toBeLessThan(5000);
  });

  test('loads frames on demand, never the whole study up front', async ({ page }) => {
    test.setTimeout(120_000);

    const trace = newTrace();
    await stubApi(page, trace ? thumbnail : thumbnail, trace);

    await page.goto(`/viewer/${STUDY_UID}`);
    await page.getByTestId('first-image-rendered').waitFor({ state: 'attached' });
    await expect(page.getByTestId('image-position')).toHaveText(`1 / ${INSTANCE_COUNT}`);

    // Give any (incorrect) prefetch a chance to fire.
    await page.waitForTimeout(1500);

    // ONE thumbnail for 120 instances. A prefetching viewer would show 120.
    expect(trace.thumbnailRequests.length).toBe(1);
    expect(trace.pixelDataRequests).toBe(0);

    // Navigating fetches exactly one more.
    await page.getByTestId('next-image').click();
    await expect(page.getByTestId('image-position')).toHaveText(`2 / ${INSTANCE_COUNT}`);
    await page.waitForTimeout(500);
    expect(trace.thumbnailRequests.length).toBe(2);

    // Total bytes stayed proportional to what was viewed, not to study size.
    const transferred = trace.thumbnailRequests.length * thumbnail.byteLength;
    const wholeStudy = INSTANCE_COUNT * thumbnail.byteLength;
    expect(transferred).toBeLessThan(wholeStudy * 0.05);
  });

  test('Cornerstone is NOT in the initial bundle — it loads after first paint', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const trace = newTrace();
    await stubApi(page, thumbnail, trace);

    const scriptsBeforeFirstImage: string[] = [];
    page.on('request', (req) => {
      if (req.resourceType() === 'script') scriptsBeforeFirstImage.push(req.url());
    });

    await page.goto(`/viewer/${STUDY_UID}`);
    await page.getByTestId('first-image-rendered').waitFor({ state: 'attached' });

    // The whole point of the lazy import: Cornerstone must not be in the
    // critical path, or the 5-second budget is gone before a pixel is drawn.
    //
    // Counted up to the page's own first-image mark, not up to "now": the
    // upgrade starts the moment the preview is up, and on a fast local server
    // its chunks finish before this evaluate runs. Counting them measured the
    // upgrade, not the critical path — and only passed while the upgrade was
    // broken and never downloaded anything.
    const bytes = await page.evaluate(() => {
      const mark = performance.getEntriesByName('mir:viewer-first-image')[0];
      const cutoff = mark?.startTime ?? Number.POSITIVE_INFINITY;
      return performance
        .getEntriesByType('resource')
        .filter((e) => e.name.endsWith('.js') && e.startTime < cutoff)
        .reduce((sum, e) => sum + ((e as PerformanceResourceTiming).transferSize || 0), 0);
    });

    // eslint-disable-next-line no-console -- the measured value is the point
    console.log(`JS transferred before first image: ${Math.round(bytes / 1024)} KB`);

    // 2 Mbit/s is 256 KB/s. The entire 5s budget is ~1.2 MB including HTML and
    // TLS; the JS alone must stay well under that.
    expect(bytes).toBeLessThan(600 * 1024);
  });

  test('attempts full-fidelity upgrade after the thumbnail, degrading safely', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const trace = newTrace();
    await stubApi(page, thumbnail, trace);

    await page.goto(`/viewer/${STUDY_UID}`);
    await page.getByTestId('first-image-rendered').waitFor({ state: 'attached' });

    // The upgrade is attempted only AFTER the thumbnail is on screen.
    await expect
      .poll(async () => page.getByTestId('viewer').getAttribute('data-fidelity'), {
        timeout: 60_000,
      })
      .not.toBe('thumbnail');

    // Cornerstone asks for metadata before frames — a frame without metadata
    // is undecodable, so this ordering is a correctness property.
    if (trace.frameRequests.length > 0) {
      expect(trace.metadataRequests.length).toBeGreaterThan(0);
    }

    // The stub returns 404 for metadata, so the upgrade must FAIL SAFELY:
    // the doctor keeps the thumbnail rather than getting a blank pane.
    const fidelity = await page.getByTestId('viewer').getAttribute('data-fidelity');
    expect(['loading-full', 'full', 'unavailable']).toContain(fidelity ?? '');
    await expect(page.getByTestId('current-image')).toBeVisible();

    // And the banner is still there regardless of fidelity.
    await expect(page.getByTestId('diagnostic-banner')).toBeVisible();
  });

  test('banner is present, and present before any image loads', async ({ page }) => {
    const trace = newTrace();
    await stubApi(page, thumbnail, trace);

    await page.goto(`/viewer/${STUDY_UID}`);

    const banner = page.getByTestId('diagnostic-banner');
    await expect(banner).toBeVisible();
    // The exact wording the spec mandates.
    await expect(page.getByTestId('diagnostic-banner-en')).toHaveText(
      'Reference viewing only — not for diagnostic use',
    );
    // Arabic too, per DECISION D4.
    await expect(banner).toContainText('ليس للاستخدام التشخيصي');
  });

  test('banner cannot be dismissed', async ({ page }) => {
    const trace = newTrace();
    await stubApi(page, thumbnail, trace);
    await page.goto(`/viewer/${STUDY_UID}`);

    const banner = page.getByTestId('diagnostic-banner');
    await expect(banner).toBeVisible();

    // No close control exists anywhere inside it.
    expect(await banner.locator('button').count()).toBe(0);
    expect(await banner.locator('[aria-label*="close" i]').count()).toBe(0);

    // Still there after navigating images — it is not a one-time notice.
    await page.getByTestId('first-image-rendered').waitFor({ state: 'attached' });
    await page.getByTestId('next-image').click();
    await expect(banner).toBeVisible();
  });

  test('stays visible when the viewport is scrolled', async ({ page }) => {
    // A banner that scrolls away is absent during the reading that matters.
    const trace = newTrace();
    await stubApi(page, thumbnail, trace);
    await page.goto(`/viewer/${STUDY_UID}`);
    await page.getByTestId('first-image-rendered').waitFor({ state: 'attached' });

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.getByTestId('diagnostic-banner')).toBeInViewport();
  });
});
