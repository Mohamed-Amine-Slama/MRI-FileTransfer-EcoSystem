import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('http://localhost:3101/ar?tier=A', { waitUntil: 'networkidle' });
const out = await p.evaluate(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return [sel, 'MISSING'];
    const cs = getComputedStyle(el);
    return [sel, { ls: cs.letterSpacing, tt: cs.textTransform, ff: cs.fontFamily.slice(0, 60), fs: cs.fontSize }];
  };
  return [pick('.security'), pick('.security dd'), pick('.eyebrow'), pick('.chrome-link'), pick('.hero-trust')];
});
console.log(JSON.stringify(out, null, 1));
await b.close();
