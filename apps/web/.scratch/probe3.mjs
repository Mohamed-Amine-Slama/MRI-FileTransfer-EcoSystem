import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto('http://127.0.0.1:3101/ar?tier=A', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);

const report = async (label) => {
  const s = await p.evaluate(() => {
    const out = {};
    for (const id of ['problem','corridor','upload','consent','viewer','appointment','security','doors','questions','close']) {
      const el = document.querySelector('#' + id);
      const planes = [...el.querySelectorAll('[data-plane]')];
      out[id] = planes.map(x => Number(getComputedStyle(x).opacity).toFixed(2)).join(',');
    }
    return { y: Math.round(scrollY), h: document.documentElement.scrollHeight, out };
  });
  console.log(label, 'scrollY', s.y, 'of', s.h);
  for (const [k, v] of Object.entries(s.out)) console.log('   ', k.padEnd(12), v);
};

// Scroll the way a person does: wheel, in steps, all the way down.
for (let i = 0; i < 200; i++) {
  await p.mouse.wheel(0, 300);
  await p.waitForTimeout(30);
}
await p.waitForTimeout(2500);
await report('after wheel-scrolling to the bottom:');
await b.close();
