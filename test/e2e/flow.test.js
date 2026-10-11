import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { serve } from './server.js';

const SHOTS = 'test/output';
mkdirSync(SHOTS, { recursive: true });
let srv;
let browser;

before(async () => {
  // BASE_URL=https://trajectory.meckman.org npm run e2e tests the live site.
  srv = process.env.BASE_URL ? { url: process.env.BASE_URL, server: { close() {} } } : await serve();
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  srv?.server.close();
});

async function clickFrame(page, p) {
  const box = await page.locator('#canvas').boundingBox();
  const size = await page.evaluate(() => ({ w: document.querySelector('#canvas').width, h: document.querySelector('#canvas').height }));
  await page.mouse.click(box.x + (p.x / size.w) * box.width, box.y + (p.y / size.h) * box.height);
}

async function gotoFrame(page, i) {
  await page.evaluate((i) => {
    const s = document.querySelector('#scrub');
    s.value = String(i);
    s.dispatchEvent(new Event('input'));
  }, i);
  await page.waitForTimeout(150);
}

async function trackAndFit(page) {
  const truth = await page.evaluate(async () => (await import('/js/state.js')).S.clip.truth);
  await gotoFrame(page, truth.launchFrame + 60);
  await page.getByRole('button', { name: 'Find Ball' }).click();
  await page.locator('#toast', { hasText: 'Tracked' }).waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Next: Fit Arc' }).click();
  await page.locator('.stat .l', { hasText: 'Exit speed' }).waitFor();
  const v0 = Number(await page.locator('.stat').first().locator('.n').textContent());
  return { truth, v0 };
}

test('sample shot: scale, track, fit, save, tune, export', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(srv.url);
  await page.screenshot({ path: `${SHOTS}/01-landing.png`, fullPage: true });

  await page.getByRole('button', { name: 'Try Sample Shot' }).click();
  await page.getByRole('button', { name: 'Next: Track Motion' }).waitFor({ timeout: 30000 });
  const truth = await page.evaluate(async () => (await import('/js/state.js')).S.clip.truth);
  await clickFrame(page, truth.stickA);
  await clickFrame(page, truth.stickB);
  await page.screenshot({ path: `${SHOTS}/02-scale.png`, fullPage: true });
  await page.getByRole('button', { name: 'Next: Track Motion' }).click();

  const results = [];
  for (let k = 0; k < 3; k++) {
    if (k > 0) {
      await page.getByRole('button', { name: 'Shot Log' }).first().click();
      await page.evaluate(async () => {
        const { app } = await import('/app.js');
        await app.loadSample();
      });
      await page.getByRole('button', { name: 'Find Ball' }).waitFor({ timeout: 30000 });
    }
    const r = await trackAndFit(page);
    results.push(r);
    if (k === 0) await page.screenshot({ path: `${SHOTS}/03-fit.png`, fullPage: true });
    const err = Math.abs(r.v0 - r.truth.v0) / r.truth.v0;
    assert.ok(err < 0.02, `shot ${k}: v0 ${r.v0} vs truth ${r.truth.v0.toFixed(3)}`);
    await page.getByRole('button', { name: 'Save Shot' }).click();
    await page.locator('#toast', { hasText: 'saved' }).waitFor();
  }

  await page.locator('#steps button[data-view="log"]').click();
  await page.locator('#logPage tbody tr').nth(2).waitFor();
  await page.screenshot({ path: `${SHOTS}/04-log.png`, fullPage: true });

  await page.locator('#steps button[data-view="tune"]').click();
  await page.locator('#tunePage pre').waitFor();
  const code = await page.locator('#tunePage pre').textContent();
  assert.match(code, /InterpolatingDoubleTreeMap/);
  const rpms = new Set(results.map((r) => r.truth.rpm));
  if (rpms.size > 1) assert.match(code, /SETPOINT\.put\(/);
  await page.screenshot({ path: `${SHOTS}/05-tune.png`, fullPage: true });

  await page.locator('#steps button[data-view="compare"]').click();
  await page.locator('#comparePage table').waitFor();
  await page.screenshot({ path: `${SHOTS}/06-compare.png`, fullPage: true });

  assert.deepEqual(errors, []);
  await page.close();
});

test('phone width has no horizontal scroll', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.goto(srv.url);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 0, `landing overflows by ${over}px`);
  await page.screenshot({ path: `${SHOTS}/07-phone-landing.png`, fullPage: true });
  await page.getByRole('button', { name: 'Try Sample Shot' }).click();
  await page.getByRole('button', { name: 'Next: Track Motion' }).waitFor({ timeout: 30000 });
  const over2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over2 <= 0, `scale view overflows by ${over2}px`);
  await page.screenshot({ path: `${SHOTS}/08-phone-scale.png`, fullPage: true });
  await page.close();
});
