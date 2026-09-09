import { chromium } from '@playwright/test';
const b = await chromium.launch();
for (const tier of ['C', 'B', 'A']) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  let bytes = 0, count = 0, js = 0, css = 0, img = 0, font = 0;
  p.on('response', async (r) => {
    try {
      const h = await r.allHeaders();
      const len = Number(h['content-length'] ?? 0);
      const url = r.url();
      if (!url.startsWith('http://127.0.0.1:3101')) return;
      bytes += len; count++;
      if (/\.js(\?|$)/.test(url)) js += len;
      else if (/\.css(\?|$)/.test(url)) css += len;
      else if (/\.(avif|png|svg|jpg|webp)(\?|$)/.test(url)) img += len;
      else if (/\.woff2(\?|$)/.test(url)) font += len;
    } catch {}
  });
  await p.goto(`http://127.0.0.1:3101/ar?tier=${tier}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  const initial = { bytes, count, js, css, img, font };
  // then the whole page, scrolled
  await p.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 40)); }
    window.scrollTo(0, document.body.scrollHeight);
  });
  await p.waitForTimeout(4000);
  const k = (n) => (n / 1024).toFixed(1).padStart(7);
  console.log(`tier ${tier}  initial ${k(initial.bytes)} KB (${initial.count} req)   full-scroll ${k(bytes)} KB (${count} req)`);
  console.log(`         js ${k(js)}  css ${k(css)}  img ${k(img)}  font ${k(font)}`);
  await ctx.close();
}
await b.close();
