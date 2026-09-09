import { chromium } from '@playwright/test';
const OUT = process.env.SC;
const shots = [
  { name: 'ar-desktop',  url: 'http://localhost:3101/ar?tier=A', w: 1440, h: 900 },
  { name: 'en-desktop',  url: 'http://localhost:3101/en?tier=A', w: 1440, h: 900 },
  { name: 'ar-mobile',   url: 'http://localhost:3101/ar?tier=B', w: 390,  h: 844 },
  { name: 'ar-tierC',    url: 'http://localhost:3101/ar?tier=C', w: 1440, h: 900 },
];
const browser = await chromium.launch();
const errors = [];
for (const s of shots) {
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push(`${s.name}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${s.name} console: ${m.text()}`); });
  await page.goto(s.url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/${s.name}-hero.png` });
  // full page, capped
  await page.screenshot({ path: `${OUT}/${s.name}-full.png`, fullPage: true });
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  console.log(s.name, 'height', h, 'h-overflow', overflow);
  await page.close();
}
await browser.close();
if (errors.length) { console.log('--- ERRORS ---'); for (const e of errors) console.log(e); }
else console.log('no page errors');
