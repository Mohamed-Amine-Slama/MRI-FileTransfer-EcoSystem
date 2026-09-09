import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto('http://127.0.0.1:3101/ar?tier=A', { waitUntil: 'domcontentloaded' });
// Click as early as the test can: as soon as the split headline exists.
await p.locator('h1 [data-unit]').first().waitFor({ state: 'visible', timeout: 15000 });
console.log('clicking at y=', await p.evaluate(() => Math.round(scrollY)));
await p.locator('.chrome-link[href="#security"]').first().click();
for (let i = 0; i < 16; i++) {
  await p.waitForTimeout(400);
  console.log(' t+' + (i + 1) * 400, await p.evaluate(() => {
    const el = document.querySelector('#security');
    const r = el.getBoundingClientRect();
    return `y=${Math.round(scrollY)} secTop=${Math.round(r.top)} h=${Math.round(r.height)} docH=${document.documentElement.scrollHeight}`;
  }));
}
await b.close();
