// Render the app icons as real PNGs (V4 section 10: static PNG files, never JPEG).
// Usage: node tools/make-icons.mjs
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#000"/>
  <circle cx="256" cy="256" r="196" fill="none" stroke="#fff2cc" stroke-opacity="0.18" stroke-width="3"/>
  <line x1="84" y1="404" x2="428" y2="404" stroke="#fff2cc" stroke-opacity="0.35" stroke-width="6"/>
  <path d="M 104 396 Q 236 40 412 330" fill="none" stroke="#fff2cc" stroke-width="16" stroke-linecap="round" stroke-dasharray="2 30"/>
  <circle cx="104" cy="396" r="14" fill="#fff2cc"/>
  <circle cx="300" cy="196" r="34" fill="#cc0000"/>
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [name, size] of [['app-icon-512.png', 512], ['apple-touch-icon.png', 180], ['favicon.png', 64]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:#000">${svg(size)}</body></html>`);
  await page.screenshot({ path: join(out, name), omitBackground: false });
}
await browser.close();
console.log('icons written to', out);
