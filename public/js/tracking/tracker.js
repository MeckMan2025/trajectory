// Frame-to-frame ball tracker. Pure logic: the caller supplies pixel regions.
//
// For each frame: predict where the ball should be from recent points, cut a
// search window around the prediction, mask the ball color, close the wiffle
// holes, find blobs, and score each blob by distance, size and roundness.
// When color fails, frame differencing (motion) is tried in the same window.

import { colorMask } from './color.js';
import { close, components } from './blobs.js';
import { leastSquares } from '../physics/linalg.js';

const MAX_MISSES = 6;

// Fit p(i) = a + b i + c i^2 to the last few points and evaluate at frame i.
export function predict(history, i) {
  const pts = history.slice(-8);
  if (!pts.length) return null;
  if (pts.length === 1) return { x: pts[0].x, y: pts[0].y, speed: 0 };
  if (pts.length < 4) {
    const a = pts[pts.length - 2];
    const b = pts[pts.length - 1];
    const di = b.i - a.i || 1;
    const vx = (b.x - a.x) / di;
    const vy = (b.y - a.y) / di;
    const s = i - b.i;
    return { x: b.x + vx * s, y: b.y + vy * s, speed: Math.hypot(vx, vy) };
  }
  const i0 = pts[pts.length - 1].i;
  const X = pts.map((p) => [1, p.i - i0, (p.i - i0) ** 2]);
  const fit = (key) => {
    const res = leastSquares(X, pts.map((p) => p[key]));
    return res && res.beta;
  };
  const fx = fit('x');
  const fy = fit('y');
  if (!fx || !fy) return predict(pts.slice(-2), i);
  const u = i - i0;
  return {
    x: fx[0] + fx[1] * u + fx[2] * u * u,
    y: fy[0] + fy[1] * u + fy[2] * u * u,
    speed: Math.hypot(fx[1] + 2 * fx[2] * u, fy[1] + 2 * fy[2] * u),
  };
}

function closeRadius(r) {
  return Math.max(1, Math.min(6, Math.round(r * 0.25)));
}

// Score blobs found in a region. Returns candidates in frame coordinates, best first.
export function detectInRegion(region, model, { ox = 0, oy = 0, expectR = null, pred = null, searchR = Infinity, closeR = null } = {}) {
  const { width: w, height: h } = region;
  const raw = colorMask(region, model);
  const mask = close(raw, w, h, closeR ?? (expectR ? closeRadius(expectR) : 2));
  const minArea = expectR ? Math.max(4, 0.15 * Math.PI * expectR * expectR) : 6;
  const blobs = components(mask, w, h, { minArea });
  return scoreBlobs(blobs, { ox, oy, expectR, pred, searchR });
}

function scoreBlobs(blobs, { ox, oy, expectR, pred, searchR }) {
  return blobs.map((b) => {
    const x = b.x + ox;
    const y = b.y + oy;
    const dist = pred ? Math.hypot(x - pred.x, y - pred.y) / Math.max(searchR, 1) : 0;
    const size = expectR ? Math.abs(Math.log(b.r / expectR)) : 0;
    // Motion blur stretches the ball, so aspect is weighted gently.
    // Fill above 1 means corners, which a ball does not have.
    const shape = (1 - b.aspect) * 0.5 + Math.max(0, 0.6 - b.fill) + 2.5 * Math.max(0, b.fill - 1.05);
    const conf = Math.exp(-(2.2 * dist * dist + 1.6 * size * size + 1.2 * shape));
    return { x, y, r: b.r, area: b.area, aspect: b.aspect, conf };
  }).sort((a, b) => b.conf - a.conf);
}

// Fallback detector: pixels that changed in the same window. With both the
// previous and next frame (three-frame differencing) only the ball's current
// position survives, instead of a smear across where it was and where it is.
export function detectMotion(region, prevRegion, nextRegion, { ox = 0, oy = 0, expectR, pred, searchR, threshold = 28 } = {}) {
  const { data, width: w, height: h } = region;
  const p = prevRegion.data;
  const n = nextRegion ? nextRegion.data : null;
  const lim = threshold * 3;
  const mask = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    const dp = Math.abs(data[j] - p[j]) + Math.abs(data[j + 1] - p[j + 1]) + Math.abs(data[j + 2] - p[j + 2]);
    if (dp <= lim) continue;
    if (n) {
      const dn = Math.abs(data[j] - n[j]) + Math.abs(data[j + 1] - n[j + 1]) + Math.abs(data[j + 2] - n[j + 2]);
      if (dn <= lim) continue;
    }
    mask[i] = 1;
  }
  const closed = close(mask, w, h, expectR ? closeRadius(expectR) : 2);
  const minArea = expectR ? Math.max(4, 0.25 * Math.PI * expectR * expectR) : 6;
  return scoreBlobs(components(closed, w, h, { minArea }), { ox, oy, expectR, pred, searchR })
    .map((c) => ({ ...c, conf: c.conf * 0.6 }));
}

// Fraction of a candidate's disc that changed between two frames.
function changedFraction(a, b, c, r) {
  let n = 0;
  let hit = 0;
  const R = Math.max(2, r);
  for (let y = Math.max(0, Math.floor(c.y - R)); y < Math.min(a.height, Math.ceil(c.y + R)); y++) {
    for (let x = Math.max(0, Math.floor(c.x - R)); x < Math.min(a.width, Math.ceil(c.x + R)); x++) {
      if ((x + 0.5 - c.x) ** 2 + (y + 0.5 - c.y) ** 2 > R * R) continue;
      const j = 4 * (y * a.width + x);
      const d = Math.abs(a.data[j] - b.data[j]) + Math.abs(a.data[j + 1] - b.data[j + 1]) + Math.abs(a.data[j + 2] - b.data[j + 2]);
      n++;
      if (d > 60) hit++;
    }
  }
  return n ? hit / n : 0;
}

// Find the ball anywhere in a full frame (used when the user has not clicked it).
// With neighbouring frames, blobs that do not move (posters, tape, bumpers) are
// ruled out, which matters on a cluttered field.
export function findBall(frame, model, neighbours = []) {
  const cands = detectInRegion(frame, model, { closeR: 3 }).slice(0, 30);
  const scored = cands.map((c) => {
    const moving = neighbours.length
      ? Math.max(...neighbours.map((nb) => changedFraction(frame, nb, c, c.r)))
      : 1;
    return { ...c, moving, score: c.conf * c.conf * Math.sqrt(c.area) * (neighbours.length ? moving : 1) };
  }).filter((c) => !neighbours.length || c.moving > 0.2);
  return scored.sort((a, b) => b.score - a.score)[0] || null;
}

/**
 * Track the ball across a clip.
 * getRegion(i, x0, y0, w, h) -> { data, width, height } (may be async).
 * start: { i, x, y, r } where the ball is in frame i.
 * Tracks forward to lastIndex and backward to firstIndex from the start frame.
 * Returns points [{ i, x, y, r, conf, source }] sorted by frame.
 */
export async function trackClip({ getRegion, frameWidth, frameHeight, firstIndex = 0, lastIndex, start, model, onProgress, shouldStop, minConf = 0.12, directions = [1, -1] }) {
  const all = new Map();
  all.set(start.i, { i: start.i, x: start.x, y: start.y, r: start.r, conf: 1, source: 'start' });
  for (const dir of directions) {
    const history = [{ i: start.i, x: start.x, y: start.y }];
    let expectR = start.r;
    let misses = 0;
    for (let i = start.i + dir; dir > 0 ? i <= lastIndex : i >= firstIndex; i += dir) {
      if (shouldStop && shouldStop()) return [...all.values()].sort((a, b) => a.i - b.i);
      // Going backward, flip frame numbers so the predictor always sees time increasing.
      const ordered = dir > 0 ? history : history.map((p) => ({ ...p, i: -p.i }));
      const pr = predict(ordered, dir > 0 ? i : -i);
      if (!pr) break;
      const pred = { x: pr.x, y: pr.y };
      if (pred.x < -expectR * 2 || pred.y < -expectR * 2 || pred.x > frameWidth + expectR * 2 || pred.y > frameHeight + expectR * 2) break;

      // With a single known point there is no velocity yet, so look wide.
      const base = history.length < 2
        ? Math.max(10 * expectR, 0.08 * Math.max(frameWidth, frameHeight))
        : Math.max(4 * expectR, 2.5 * pr.speed + 3 * expectR);
      const searchR = base * (1 + 0.5 * misses);
      const x0 = Math.max(0, Math.floor(pred.x - searchR));
      const y0 = Math.max(0, Math.floor(pred.y - searchR));
      const x1 = Math.min(frameWidth, Math.ceil(pred.x + searchR));
      const y1 = Math.min(frameHeight, Math.ceil(pred.y + searchR));
      if (x1 - x0 < 3 || y1 - y0 < 3) break;
      const region = await getRegion(i, x0, y0, x1 - x0, y1 - y0);
      const opts = { ox: x0, oy: y0, expectR, pred, searchR };
      let best = detectInRegion(region, model, opts)[0];
      let source = 'color';
      if (!best || best.conf < minConf) {
        const prev = await getRegion(i - dir, x0, y0, x1 - x0, y1 - y0);
        const hasNext = dir > 0 ? i + 1 <= lastIndex : i - 1 >= firstIndex;
        const next = hasNext ? await getRegion(i + dir, x0, y0, x1 - x0, y1 - y0) : null;
        const m = detectMotion(region, prev, next, opts)[0];
        if (m && m.conf >= minConf && (!best || m.conf > best.conf)) {
          best = m;
          source = 'motion';
        }
      }
      if (best && best.conf >= minConf) {
        all.set(i, { i, x: best.x, y: best.y, r: best.r, conf: best.conf, source });
        history.push({ i, x: best.x, y: best.y });
        if (source === 'color') expectR = 0.8 * expectR + 0.2 * best.r;
        misses = 0;
      } else {
        misses++;
        if (misses >= MAX_MISSES) break;
      }
      if (onProgress) onProgress(all.size, i);
    }
  }
  return [...all.values()].sort((a, b) => a.i - b.i);
}
