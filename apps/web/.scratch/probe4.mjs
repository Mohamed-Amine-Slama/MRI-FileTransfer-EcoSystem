import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto('http://127.0.0.1:3101/ar?tier=A', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
for (const id of ['problem', 'corridor', 'upload']) {
  await p.locator('#' + id).scrollIntoViewIfNeeded();
  const trail = [];
  for (let i = 0; i < 8; i++) {
    trail.push(await p.evaluate((sid) => {
      const el = document.querySelector('#' + sid);
      const planes = [...el.querySelectorAll('[data-plane]')];
      return `y=${Math.round(scrollY)} top=${Math.round(el.getBoundingClientRect().top)} op=[${planes.map(x => Number(getComputedStyle(x).opacity).toFixed(2)).join(',')}]`;
    }, id));
    await p.waitForTimeout(200);
  }
  console.log('#' + id);
  for (const t of trail) console.log('   ', t);
}
await b.close();
