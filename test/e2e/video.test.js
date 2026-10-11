// Real video files through mp4box + WebCodecs in Google Chrome (H.264 and HEVC
// need Chrome's codecs; Playwright's bundled Chromium lacks them).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { serve } from './server.js';

const FX = 'test/fixtures';
let srv;
let browser;
let truth;

before(async () => {
  if (!existsSync(`${FX}/shot-240.mp4`)) execFileSync('node', ['tools/make-fixtures.mjs'], { stdio: 'inherit' });
  truth = JSON.parse(readFileSync(`${FX}/truth.json`, 'utf8'));
  mkdirSync('test/output', { recursive: true });
  // BASE_URL=https://trajectory.meckman.org npm run e2e tests the live site.
  srv = process.env.BASE_URL ? { url: process.env.BASE_URL, server: { close() {} } } : await serve();
  browser = await chromium.launch({ channel: 'chrome' });
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

async function run(file, { retimed = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(srv.url);
  await page.locator('#fileInput').setInputFiles(`${FX}/${file}`);
  await page.getByRole('button', { name: 'Next: Track Motion' }).waitFor({ timeout: 60000 });
  const clip = await page.evaluate(async () => {
    const { S } = await import('/js/state.js');
    return { method: S.clip.method, codec: S.clip.codec, fps: S.clip.videoFps, n: S.clip.frames.count, w: S.clip.width };
  });
  await clickFrame(page, truth.stickA);
  await clickFrame(page, truth.stickB);
  await page.getByRole('button', { name: 'Next: Track Motion' }).click();
  await page.evaluate((i) => {
    const s = document.querySelector('#scrub');
    s.value = String(i);
    s.dispatchEvent(new Event('input'));
  }, truth.launchFrame + 50);
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Find Ball' }).click();
  await page.locator('#toast', { hasText: 'Tracked' }).waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: 'Next: Fit Arc' }).click();
  await page.locator('.stat .l', { hasText: 'Exit speed' }).waitFor();
  let suggested = null;
  if (retimed) {
    const btn = page.getByRole('button', { name: /Use \d+ fps/ });
    await btn.waitFor();
    suggested = (await btn.textContent()).match(/\d+/)[0];
    await btn.click();
    await page.locator('.note.ok').waitFor();
  }
  const v0 = Number(await page.locator('.stat').first().locator('.n').textContent());
  const angle = parseFloat(await page.locator('.stat').nth(1).locator('.n').textContent());
  await page.screenshot({ path: `test/output/video-${file}.png`, fullPage: true });
  await page.close();
  console.log(`${file}: ${clip.method} ${clip.codec} ${clip.fps.toFixed(2)} fps, v0 ${v0} (truth ${truth.v0}), angle ${angle} (truth ${truth.angleDeg})`);
  return { clip, v0, angle, suggested, errors };
}

test('H.264 240 fps MP4 decodes with exact timing and measures v0 within 2%', async () => {
  const r = await run('shot-240.mp4');
  assert.equal(r.clip.method, 'webcodecs');
  assert.ok(Math.abs(r.clip.fps - 240) < 0.5, `fps ${r.clip.fps}`);
  assert.equal(r.clip.n, 194);
  assert.ok(Math.abs(r.v0 - truth.v0) / truth.v0 < 0.02, `v0 ${r.v0} vs ${truth.v0}`);
  assert.ok(Math.abs(r.angle - truth.angleDeg) < 1, `angle ${r.angle}`);
  assert.deepEqual(r.errors, []);
});

test('HEVC MOV (iPhone style) decodes and measures', async () => {
  const r = await run('shot-240-hevc.mov');
  assert.equal(r.clip.method, 'webcodecs', `method ${r.clip.method} codec ${r.clip.codec}`);
  assert.ok(Math.abs(r.v0 - truth.v0) / truth.v0 < 0.02, `v0 ${r.v0} vs ${truth.v0}`);
  assert.deepEqual(r.errors, []);
});

test('re-timed 30 fps export is caught and corrected to 240 fps', async () => {
  const r = await run('shot-retimed-30.mp4', { retimed: true });
  assert.ok(Math.abs(r.clip.fps - 30) < 0.5);
  assert.equal(r.suggested, '240');
  assert.ok(Math.abs(r.v0 - truth.v0) / truth.v0 < 0.02, `v0 ${r.v0} vs ${truth.v0}`);
  assert.deepEqual(r.errors, []);
});
