import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toWorld, toPixel, scaleFromStick, levelAngle, detectMirror } from '../../public/js/calibration.js';

test('stick scale and level correction', () => {
  assert.equal(scaleFromStick({ x: 0, y: 0 }, { x: 200, y: 0 }, 1), 0.005);
  // Camera rolled 10 degrees: the floor line rises to the right in the image.
  const th = (10 * Math.PI) / 180;
  const level = { a: { x: 100, y: 300 }, b: { x: 100 + 300 * Math.cos(th), y: 300 - 300 * Math.sin(th) } };
  assert.ok(Math.abs(levelAngle(level) - th) < 1e-12);
  const cal = { mPerPx: 0.01, origin: { x: 100, y: 300 }, level, mirror: false };
  // A point along the floor line is at y = 0 in the world.
  const w = toWorld(level.b, cal);
  assert.ok(Math.abs(w.y) < 1e-9 && Math.abs(w.x - 3) < 1e-9);
});

test('toPixel inverts toWorld, mirrored or not', () => {
  for (const mirror of [false, true]) {
    const cal = { mPerPx: 0.004, origin: { x: 320, y: 240 }, level: { a: { x: 0, y: 10 }, b: { x: 100, y: 4 } }, mirror };
    const p = { x: 411.5, y: 97.25 };
    const back = toPixel(toWorld(p, cal), cal);
    assert.ok(Math.hypot(back.x - p.x, back.y - p.y) < 1e-9);
  }
  assert.equal(detectMirror([{ x: 300, y: 100 }, { x: 100, y: 100 }], { mPerPx: 1, origin: { x: 0, y: 0 } }), true);
});
