import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderShot, regionGetter } from '../../public/js/demo/synth.js';
import { trackClip, findBall, predict } from '../../public/js/tracking/tracker.js';
import { PRESETS, sampleModel, nearestPreset } from '../../public/js/tracking/color.js';
import { close, components } from '../../public/js/tracking/blobs.js';
import { fitDrag } from '../../public/js/physics/drag.js';

test('closing fills holes so a holed ball is one blob', () => {
  const w = 40, h = 40;
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.hypot(x - 20, y - 20);
    const hole = Math.hypot(x - 26, y - 20) < 2.5 || Math.hypot(x - 14, y - 20) < 2.5 || Math.hypot(x - 20, y - 20) < 2.5;
    if (d < 10 && !hole) m[y * w + x] = 1;
  }
  const blobs = components(close(m, w, h, 2), w, h);
  assert.equal(blobs.length, 1);
  assert.ok(Math.abs(blobs[0].x - 20.5) < 0.3 && Math.abs(blobs[0].y - 20.5) < 0.3);
});

test('predictor extrapolates a parabola', () => {
  const hist = [0, 1, 2, 3, 4, 5].map((i) => ({ i, x: 3 * i, y: 100 - 10 * i + 0.5 * i * i }));
  const p = predict(hist, 7);
  assert.ok(Math.abs(p.x - 21) < 1e-6 && Math.abs(p.y - (100 - 70 + 24.5)) < 1e-6);
});

for (const [color, fps] of [['yellow', 240], ['blue', 120], ['red', 240], ['purple', 120], ['yellow', 30], ['red', 60]]) {
  test(`tracks a ${color} wiffle ball at ${fps} fps within 1 px and v0 within 2%`, async () => {
    const shot = renderShot({ color, fps, seed: color.length * 13 });
    const startI = Math.round(shot.frames.length * 0.45);
    const t = shot.truth[startI];
    const pts = await trackClip({
      getRegion: regionGetter(shot.frames),
      frameWidth: 640, frameHeight: 360,
      lastIndex: shot.frames.length - 1,
      start: { i: startI, x: t.px + 1.5, y: t.py - 1, r: shot.rPx },
      model: PRESETS[color],
    });
    const moving = pts.filter((p) => shot.truth[p.i].moving && p.source !== 'start');
    assert.ok(moving.length > shot.frames.length * 0.6, `tracked ${moving.length} of ${shot.frames.length}`);
    const errs = moving.map((p) => Math.hypot(p.x - shot.truth[p.i].px, p.y - shot.truth[p.i].py));
    const rms = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length);
    assert.ok(rms < 1, `rms ${rms.toFixed(2)} px`);
    console.log(`${color} ${fps} fps: ${moving.length} points, rms ${rms.toFixed(2)} px`);
    const world = moving.map((p) => ({
      t: p.i / fps,
      x: (p.x - shot.cam.originPx.x) / shot.cam.pxPerM,
      y: (shot.cam.originPx.y - p.y) / shot.cam.pxPerM,
    }));
    const f = fitDrag(world);
    // v0 is reported at the first tracked point, so compare speed there.
    const first = shot.truth[moving[0].i];
    const tv = Math.hypot(first.vx, first.vy);
    assert.ok(first.moving);
    assert.ok(Math.abs(f.v0 - tv) / tv < 0.02, `v0 ${f.v0.toFixed(3)} vs ${tv.toFixed(3)}`);
  });
}

test('auto find and color sampling', () => {
  const shot = renderShot({ color: 'blue', seed: 3 });
  const i = 60;
  const t = shot.truth[i];
  const b = findBall(shot.frames[i], PRESETS.blue, [shot.frames[i - 3], shot.frames[i + 3]]);
  assert.ok(Math.hypot(b.x - t.px, b.y - t.py) < 2, `found at ${b.x},${b.y} want ${t.px},${t.py}`);
  const m = sampleModel(shot.frames[i], t.px, t.py, shot.rPx * 0.8);
  assert.equal(nearestPreset(m), 'blue');
});

test('flight range drops the launcher wait and a bounce', async () => {
  const { flightRange } = await import('../../public/js/tracking/segment.js');
  const shot = renderShot({ color: 'yellow', fps: 240, pre: 0.1, duration: 0.8, k: 0.05 });
  const pts = shot.truth.map((t) => ({ i: t.i, x: t.px, y: t.py }));
  // Add a floor bounce after the last frame: the ball reverses vertical direction.
  const last = pts[pts.length - 1];
  for (let k = 1; k <= 20; k++) pts.push({ i: last.i + k, x: last.x + 2 * k, y: last.y - 3 * k });
  const r = flightRange(pts);
  const firstMoving = shot.truth.find((t) => t.moving).i;
  assert.ok(Math.abs(r.first - firstMoving) <= 1, `first ${r.first} vs ${firstMoving}`);
  assert.ok(Math.abs(r.last - last.i) <= 2, `last ${r.last} vs ${last.i}`);
});

test('find ball ignores a big still patch of the same color', () => {
  const shot = renderShot({ color: 'yellow', seed: 11 });
  // Paint a 40x40 yellow poster into every frame, bigger than the ball.
  for (const f of shot.frames) {
    for (let y = 40; y < 80; y++) for (let x = 400; x < 440; x++) {
      const j = 4 * (y * f.width + x);
      f.data[j] = 240; f.data[j + 1] = 210; f.data[j + 2] = 60;
    }
  }
  const i = 70;
  const t = shot.truth[i];
  assert.ok(findBall(shot.frames[i], PRESETS.yellow).x > 390, 'without motion the poster wins');
  const b = findBall(shot.frames[i], PRESETS.yellow, [shot.frames[i - 3], shot.frames[i + 3]]);
  assert.ok(Math.hypot(b.x - t.px, b.y - t.py) < 2, `found ${b.x},${b.y}`);
});
