import { chromium } from '@playwright/test';
const b = await chromium.launch();
for (const tier of ['C', 'B', 'A']) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(`http://127.0.0.1:3101/ar?tier=${tier}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1000);
  const initial = await p.evaluate(() => {
    const e = performance.getEntriesByType('resource');
    const doc = performance.getEntriesByType('navigation')[0];
    const sum = (f) => e.filter(f).reduce((a, r) => a + (r.encodedBodySize || 0), 0);
    return {
      total: (doc?.encodedBodySize || 0) + sum(() => true),
      html: doc?.encodedBodySize || 0,
      js: sum((r) => /\.js(\?|$)/.test(r.name)),
      css: sum((r) => /\.css(\?|$)/.test(r.name)),
      img: sum((r) => /\.(avif|png|svg)(\?|$)/.test(r.name)),
      font: sum((r) => /\.woff2(\?|$)/.test(r.name)),
      count: e.length,
    };
  });
  await p.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 40)); }
    window.scrollTo(0, document.body.scrollHeight);
  });
  await p.waitForTimeout(4000);
  const full = await p.evaluate(() => {
    const e = performance.getEntriesByType('resource');
    const doc = performance.getEntriesByType('navigation')[0];
    return (doc?.encodedBodySize || 0) + e.reduce((a, r) => a + (r.encodedBodySize || 0), 0);
  });
  const k = (n) => (n / 1024).toFixed(1).padStart(7);
  console.log(`tier ${tier}: initial ${k(initial.total)} KB / full ${k(full)} KB  ·  html ${k(initial.html)} js ${k(initial.js)} css ${k(initial.css)} img ${k(initial.img)} font ${k(initial.font)}`);
  await ctx.close();
}
await b.close();
