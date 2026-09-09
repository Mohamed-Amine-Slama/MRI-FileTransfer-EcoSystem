import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', e => console.log('PAGEERROR', e.message));
await p.goto('http://127.0.0.1:3101/ar?tier=A', { waitUntil: 'networkidle' });
await p.waitForTimeout(1800);
console.log('links found:', await p.locator('.chrome-link[href="#security"]').count());
console.log('before click y =', await p.evaluate(() => Math.round(scrollY)));
await p.locator('.chrome-link[href="#security"]').first().click();
for (let i = 0; i < 10; i++) {
  await p.waitForTimeout(300);
  console.log(' t+' + (i+1)*300, await p.evaluate(() => {
    const el = document.querySelector('#security');
    return `y=${Math.round(scrollY)} secTop=${Math.round(el.getBoundingClientRect().top)} hash=${location.hash} focus=${document.activeElement?.id || document.activeElement?.tagName}`;
  }));
}
await b.close();
