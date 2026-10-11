// Synthetic launcher footage with a known answer, for tests and demos.
// Draws a cluttered gym-like background, a 1.000 m reference stick, and a holed
// wiffle ball flying along a drag model trajectory.

import { simulateAt } from '../physics/drag.js';
import { G } from '../physics/fit.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const COLORS = {
  yellow: [242, 212, 58],
  blue: [47, 111, 224],
  red: [216, 38, 44],
  purple: [123, 75, 196],
};

export function makeScene({ width = 640, height = 360, seed = 7, color = 'yellow' } = {}) {
  const r = rng(seed);
  const bg = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const j = 4 * (y * width + x);
      const floor = y > height * 0.82;
      const base = floor ? [120, 92, 60] : [58 + (40 * y) / height, 60 + (36 * y) / height, 66 + (20 * y) / height];
      bg[j] = base[0];
      bg[j + 1] = base[1];
      bg[j + 2] = base[2];
      bg[j + 3] = 255;
    }
  }
  // Clutter: muted boxes, plus a static distractor in the ball's own color.
  const rect = (x0, y0, w, h, c) => {
    for (let y = Math.max(0, y0); y < Math.min(height, y0 + h); y++) {
      for (let x = Math.max(0, x0); x < Math.min(width, x0 + w); x++) {
        const j = 4 * (y * width + x);
        bg[j] = c[0];
        bg[j + 1] = c[1];
        bg[j + 2] = c[2];
      }
    }
  };
  for (let k = 0; k < 14; k++) {
    const c = [40 + r() * 120, 40 + r() * 120, 40 + r() * 120].map((v) => Math.round(v * 0.8 + 30));
    rect(Math.floor(r() * width), Math.floor(r() * height * 0.8), 10 + Math.floor(r() * 80), 10 + Math.floor(r() * 50), c);
  }
  const ballColor = COLORS[color];
  rect(Math.floor(width * 0.86), Math.floor(height * 0.88), 14, 6, ballColor);
  return { width, height, bg, ballColor, rng: r };
}

// World to pixel mapping used by the generator (y up in world, down in pixels).
export function makeCamera({ width, height, pxPerM, originPx }) {
  return {
    pxPerM,
    originPx,
    toPx: (x, y) => ({ x: originPx.x + x * pxPerM, y: originPx.y - y * pxPerM }),
  };
}

export function drawStick(frame, cam, { x = 0.2, y = -0.05, length = 1 } = {}) {
  const a = cam.toPx(x, y);
  const b = cam.toPx(x + length, y);
  const { data, width } = frame;
  for (let px = Math.round(a.x); px <= Math.round(b.x); px++) {
    for (let dy = -2; dy <= 2; dy++) {
      const j = 4 * ((Math.round(a.y) + dy) * width + px);
      const end = Math.abs(px - a.x) < 3 || Math.abs(px - b.x) < 3;
      const c = end ? 250 : 220;
      data[j] = c;
      data[j + 1] = end ? 250 : 200;
      data[j + 2] = end ? 250 : 150;
    }
  }
  return { a, b, length };
}

// Draw a ball with holes. Coverage is sampled 4x per pixel for soft edges, and
// `blur` samples along the velocity smear it like a real shutter.
export function drawBall(frame, { x, y, r, color, spin = 0, vx = 0, vy = 0, blur = 3 }) {
  const { data, width, height } = frame;
  const holes = [];
  for (let k = 0; k < 7; k++) {
    const a = spin + (k * 2 * Math.PI) / 7;
    holes.push([0.55 * r * Math.cos(a), 0.55 * r * Math.sin(a)]);
  }
  holes.push([0, 0]);
  const hr = 0.17 * r;
  const reach = r + Math.hypot(vx, vy) + 2;
  for (let py = Math.floor(y - reach); py <= Math.ceil(y + reach); py++) {
    if (py < 0 || py >= height) continue;
    for (let px = Math.floor(x - reach); px <= Math.ceil(x + reach); px++) {
      if (px < 0 || px >= width) continue;
      let cov = 0;
      let lit = 0;
      for (let b = 0; b < blur; b++) {
        const f = blur > 1 ? b / (blur - 1) - 0.5 : 0;
        const cx = x + vx * f;
        const cy = y + vy * f;
        for (const [sx, sy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
          const dx = px + sx - cx;
          const dy = py + sy - cy;
          if (dx * dx + dy * dy > r * r) continue;
          let hole = false;
          for (const [hx, hy] of holes) if ((dx - hx) ** 2 + (dy - hy) ** 2 < hr * hr) hole = true;
          cov += 1;
          lit += hole ? 0.35 : 1 - 0.25 * ((dx + dy) / (2 * r) + 0.5);
        }
      }
      if (!cov) continue;
      const a = cov / (4 * blur);
      const shade = lit / cov;
      const j = 4 * (py * width + px);
      for (let c = 0; c < 3; c++) data[j + c] = data[j + c] * (1 - a) + color[c] * shade * a;
    }
  }
}

/**
 * Render a full shot. Returns frames (RGBA arrays), the true trajectory in
 * world meters, and the camera, so tests know the exact answer.
 */
export function renderShot({
  width = 640, height = 360, fps = 240, duration = 0.7, pre = 0.05,
  v0 = 7.5, angleDeg = 52, k = 0.04, ballDiameter = 0.0762, color = 'yellow',
  pxPerM = 120, originPx = { x: 70, y: 300 }, noise = 3, seed = 7,
} = {}) {
  const scene = makeScene({ width, height, seed, color });
  const cam = makeCamera({ width, height, pxPerM, originPx });
  const a = (angleDeg * Math.PI) / 180;
  const n = Math.round((duration + pre) * fps);
  const times = [];
  for (let i = 0; i < n; i++) times.push(Math.max(0, i / fps - pre));
  const states = simulateAt([0, 0, v0 * Math.cos(a), v0 * Math.sin(a)], k, G, times);
  const rPx = (ballDiameter / 2) * pxPerM;
  const r = rng(seed + 1);
  const frames = [];
  const truth = [];
  for (let i = 0; i < n; i++) {
    const data = new Uint8ClampedArray(scene.bg);
    const frame = { data, width, height };
    drawStick(frame, cam);
    const [x, y, vx, vy] = states[i];
    const p = cam.toPx(x, y);
    // Smear over a 1/1000 s shutter.
    const sm = cam.pxPerM / 1000;
    drawBall(frame, { x: p.x, y: p.y, r: rPx, color: scene.ballColor, spin: i * 0.3, vx: vx * sm, vy: -vy * sm, blur: 3 });
    if (noise) for (let j = 0; j < data.length; j += 4) {
      const e = (r() - 0.5) * 2 * noise;
      data[j] += e; data[j + 1] += e; data[j + 2] += e;
    }
    frames.push(frame);
    truth.push({ i, t: i / fps, x, y, vx, vy, px: p.x, py: p.y, moving: i / fps >= pre });
  }
  return { frames, truth, cam, fps, rPx, v0, angleDeg, k, pre };
}

// Region accessor matching the tracker's getRegion contract.
export function regionGetter(frames) {
  return (i, x0, y0, w, h) => {
    const f = frames[i];
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      const src = 4 * ((y0 + y) * f.width + x0);
      data.set(f.data.subarray(src, src + 4 * w), 4 * y * w);
    }
    return { data, width: w, height: h };
  };
}
