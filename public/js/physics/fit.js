// Ballistic (no drag) fit of tracked points in world units (meters, y up).
// x(t) = x0 + vx t, y(t) = y0 + vy t - g t^2 / 2, with t measured from the first point.

import { leastSquares } from './linalg.js';

export const G = 9.80665;

const DEG = 180 / Math.PI;

// points: [{ t, x, y }] in seconds and meters. Points with off: true are skipped.
export function fitBallistic(points) {
  const pts = points.filter((p) => !p.off);
  if (pts.length < 4) return null;
  const t0 = pts[0].t;
  const ts = pts.map((p) => p.t - t0);
  const fx = leastSquares(ts.map((t) => [1, t]), pts.map((p) => p.x));
  const fy = leastSquares(ts.map((t) => [1, t, t * t]), pts.map((p) => p.y));
  if (!fx || !fy) return null;

  const [x0, vx] = fx.beta;
  const [y0, vy, a] = fy.beta;
  const g = -2 * a;
  const v0 = Math.hypot(vx, vy);
  const angle = Math.atan2(vy, vx);

  const sVx = fx.cov ? Math.sqrt(Math.max(0, fx.cov[1][1])) : NaN;
  const sVy = fy.cov ? Math.sqrt(Math.max(0, fy.cov[1][1])) : NaN;
  const sA = fy.cov ? Math.sqrt(Math.max(0, fy.cov[2][2])) : NaN;
  const sV0 = Math.sqrt((vx * sVx) ** 2 + (vy * sVy) ** 2) / Math.max(v0, 1e-9);
  const sAngle = Math.sqrt((vy * sVx) ** 2 + (vx * sVy) ** 2) / Math.max(v0 * v0, 1e-9);

  const residuals = pts.map((p, i) => Math.hypot(fx.residuals[i], fy.residuals[i]));
  const rmse = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / residuals.length);

  return {
    model: 'ballistic',
    t0,
    x0, y0, vx, vy, g,
    v0,
    angleDeg: angle * DEG,
    sigma: { v0: sV0, angleDeg: sAngle * DEG, g: 2 * sA },
    rmse,
    n: pts.length,
    duration: ts[ts.length - 1],
    residuals: pts.map((p, i) => ({ t: p.t, dx: fx.residuals[i], dy: fy.residuals[i] })),
    gError: (g - G) / G,
  };
}

// Position and velocity of the ballistic fit at absolute time t.
export function ballisticAt(fit, t, g = fit.g) {
  const s = t - fit.t0;
  return {
    x: fit.x0 + fit.vx * s,
    y: fit.y0 + fit.vy * s - 0.5 * g * s * s,
    vx: fit.vx,
    vy: fit.vy - g * s,
  };
}

// Finite-difference velocities for plotting (central differences, seconds and m/s).
export function velocities(points) {
  const pts = points.filter((p) => !p.off);
  const out = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1];
    const b = pts[i + 1];
    const dt = b.t - a.t;
    if (dt <= 0) continue;
    out.push({ t: pts[i].t, vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt });
  }
  return out;
}

// When the fitted g is off by roughly the square of a common slow-motion ratio,
// the clip was almost certainly re-timed on export. Returns the suggested
// capture fps, or null when the fit already looks right.
export function suggestCaptureFps(fit, videoFps) {
  if (!fit || !(fit.g > 0) || !(videoFps > 0)) return null;
  if (Math.abs(fit.gError) < 0.25) return null;
  const ratio = Math.sqrt(G / fit.g);
  const candidates = [30, 60, 120, 240, 480, 960];
  let best = null;
  for (const fps of candidates) {
    const r = fps / videoFps;
    const err = Math.abs(r - ratio) / r;
    if (err < 0.15 && (!best || err < best.err)) best = { fps, err };
  }
  return best ? best.fps : null;
}
