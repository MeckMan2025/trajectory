// Pick the free-flight part of a tracked clip: drop the frames where the ball is
// still sitting in the launcher, and the frames after it hits something.

import { leastSquares } from '../physics/linalg.js';

// points: [{ i, x, y }] in pixels, sorted by frame. Returns { first, last } frame
// indices of free flight, or null when there is no clear flight.
export function flightRange(points, { minSpeed = 0.6, maxGap = 3 } = {}) {
  if (points.length < 5) return null;
  const moving = [];
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1];
    const b = points[k];
    const v = Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, b.i - a.i);
    moving.push({ i: b.i, from: a.i, on: v > minSpeed });
  }
  // Longest run of moving steps, allowing short gaps.
  let best = null;
  let cur = null;
  for (const m of moving) {
    if (m.on) {
      if (cur && m.from - cur.last <= maxGap) cur.last = m.i;
      else cur = { first: m.from, last: m.i };
      if (!best || cur.last - cur.first > best.last - best.first) best = { ...cur };
    }
  }
  if (!best) return null;
  return trimBreaks(points.filter((p) => p.i >= best.first && p.i <= best.last), best);
}

// A bounce or catch shows up as a kink: the end points stop fitting a smooth curve.
// A cubic absorbs the gentle bend that air drag adds, so only real breaks stand out.
function trimBreaks(pts, range) {
  let lo = 0;
  let hi = pts.length - 1;
  for (let guard = 0; guard < pts.length && hi - lo >= 6; guard++) {
    const seg = pts.slice(lo, hi + 1);
    const i0 = seg[0].i;
    const X = seg.map((p) => [1, p.i - i0, (p.i - i0) ** 2, (p.i - i0) ** 3]);
    const fx = leastSquares(X, seg.map((p) => p.x));
    const fy = leastSquares(X, seg.map((p) => p.y));
    if (!fx || !fy) break;
    const res = seg.map((_, k) => Math.hypot(fx.residuals[k], fy.residuals[k]));
    const sorted = [...res].sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1];
    const lim = Math.max(2, 6 * med);
    const head = res[0];
    const tail = res[res.length - 1];
    if (Math.max(head, tail) <= lim) break;
    if (tail >= head) hi--;
    else lo++;
  }
  return { first: pts[lo].i, last: pts[hi].i, trimmed: lo > 0 || hi < pts.length - 1 || range.first !== pts[0].i };
}
