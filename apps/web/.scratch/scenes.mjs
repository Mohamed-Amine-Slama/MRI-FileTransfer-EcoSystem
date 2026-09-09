import { chromium } from '@playwright/test';
const OUT = process.env.SC;
const locale = process.argv[2] || 'ar';
const tier = process.argv[3] || 'A';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await p.goto(`http://localhost:3101/${locale}?tier=${tier}`, { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
for (const id of ['problem','corridor','upload','consent','viewer','appointment','security','doors','questions','close']) {
  const el = p.locator('#' + id);
  await el.scrollIntoViewIfNeeded();
  await p.waitForTimeout(1400);
  await el.screenshot({ path: `${OUT}/${locale}-${tier}-${id}.png` }).catch(e => console.log(id, 'ERR', e.message.slice(0,80)));
}
await p.locator('footer').scrollIntoViewIfNeeded();
await p.waitForTimeout(800);
await p.locator('footer').screenshot({ path: `${OUT}/${locale}-${tier}-footer.png` });
console.log('done');
await b.close();
