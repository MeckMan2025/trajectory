import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitBallistic, suggestCaptureFps, G } from '../../public/js/physics/fit.js';
import { fitDrag, simulateAt } from '../../public/js/physics/drag.js';
import { requiredSpeed, crossingAt, predictArc } from '../../public/js/physics/solve.js';

// Deterministic noise so tests never flake.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
function gauss(r) {
  return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
}

function shot({ v0 = 8, angle = 50, k = 0, fps = 240, dur = 0.6, noise = 0.002, seed = 1 }) {
  const a = (angle * Math.PI) / 180;
  const times = [];
  for (let i = 0; i <= dur * fps; i++) times.push(i / fps);
  const states = simulateAt([0, 0, v0 * Math.cos(a), v0 * Math.sin(a)], k, G, times);
  const r = rng(seed);
  return times.map((t, i) => ({ t: t + 1.25, x: states[i][0] + noise * gauss(r), y: states[i][1] + noise * gauss(r) }));
}

test('ballistic fit recovers v0, angle and g from noisy points', () => {
  const f = fitBallistic(shot({ v0: 8, angle: 50 }));
  assert.ok(Math.abs(f.v0 - 8) < 0.04, `v0 ${f.v0}`);
  assert.ok(Math.abs(f.angleDeg - 50) < 0.3, `angle ${f.angleDeg}`);
  assert.ok(Math.abs(f.g - G) < 0.1, `g ${f.g}`);
  assert.ok(f.sigma.v0 > 0 && f.sigma.v0 < 0.05);
  assert.equal(f.t0, 1.25);
});

test('ballistic fit skips points marked off', () => {
  const pts = shot({});
  pts[10] = { ...pts[10], y: pts[10].y + 1, off: true };
  const f = fitBallistic(pts);
  assert.ok(Math.abs(f.g - G) < 0.1);
});

test('drag fit recovers a known drag coefficient', () => {
  const pts = shot({ v0: 11, angle: 45, k: 0.05, dur: 0.9, noise: 0.001 });
  const f = fitDrag(pts);
  assert.ok(Math.abs(f.v0 - 11) < 0.05, `v0 ${f.v0}`);
  assert.ok(Math.abs(f.angleDeg - 45) < 0.3, `angle ${f.angleDeg}`);
  assert.ok(Math.abs(f.k - 0.05) < 0.006, `k ${f.k}`);
  assert.equal(f.dragResolved, true);
  // Ignoring drag makes the no-drag fit report a g above 9.8.
  assert.ok(fitBallistic(pts).g > G);
});

test('drag fit returns k near zero for a drag-free shot', () => {
  const f = fitDrag(shot({ k: 0, noise: 0.001 }));
  assert.ok(f.k < 0.005, `k ${f.k}`);
});

test('re-timed slow motion clip is detected from g', () => {
  // A 240 fps capture exported at 30 fps stretches time by 8x, so g looks 64x smaller.
  const pts = shot({}).map((p) => ({ ...p, t: p.t * 8 }));
  const f = fitBallistic(pts);
  assert.equal(suggestCaptureFps(f, 30), 240);
  assert.equal(suggestCaptureFps(fitBallistic(shot({})), 240), null);
});

test('required speed round-trips through the simulator', () => {
  for (const k of [0, 0.04]) {
    const sol = requiredSpeed({ angleDeg: 55, targetDistance: 4, targetHeight: 2.1, launchHeight: 0.5, k });
    assert.ok(sol, 'solution exists');
    const c = crossingAt(sol.v0, 55, 4, { k, launchHeight: 0.5 });
    assert.ok(Math.abs(c.y - 2.1) < 1e-3, `height ${c.y}`);
  }
  // Analytic check without drag: y = h + x tan a - g x^2 / (2 v^2 cos^2 a)
  const a = (55 * Math.PI) / 180;
  const v = Math.sqrt((G * 16) / (2 * Math.cos(a) ** 2 * (0.5 + 4 * Math.tan(a) - 2.1)));
  const sol = requiredSpeed({ angleDeg: 55, targetDistance: 4, targetHeight: 2.1, launchHeight: 0.5 });
  assert.ok(Math.abs(sol.v0 - v) < 1e-3, `${sol.v0} vs ${v}`);
});

test('unreachable target returns null', () => {
  assert.equal(requiredSpeed({ angleDeg: 10, targetDistance: 3, targetHeight: 5, launchHeight: 0 }), null);
});

test('predicted arc finds the apex', () => {
  const f = fitBallistic(shot({ v0: 8, angle: 50, noise: 0 }));
  const arc = predictArc(f);
  const vy = 8 * Math.sin((50 * Math.PI) / 180);
  assert.ok(Math.abs(arc.apex.y - (vy * vy) / (2 * G)) < 0.01);
});
