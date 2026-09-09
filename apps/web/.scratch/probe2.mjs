import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto('http://127.0.0.1:3101/ar?tier=B', { waitUntil: 'networkidle' });
await p.getByTestId('upload-cut').scrollIntoViewIfNeeded();
await p.waitForTimeout(2000);
console.log(await p.evaluate(() => {
  const btn = document.querySelector('[data-testid="upload-cut"]');
  const wrap = btn?.closest('.plate')?.parentElement;
  const r = wrap?.getBoundingClientRect();
  const scene = document.querySelector('#upload');
  return {
    wrapHeight: r?.height, wrapTop: r?.top, viewport: innerHeight,
    maxRatio: r ? Math.min(1, innerHeight / r.height) : null,
    sceneHeight: scene?.getBoundingClientRect().height,
    disabled: btn?.hasAttribute('disabled'),
    cv: scene ? getComputedStyle(scene).contentVisibility : null,
  };
}));
await b.close();
