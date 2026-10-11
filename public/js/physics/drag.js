// Quadratic air drag model: a = -k |v| v - g y_hat, with k = rho Cd A / (2 m) in 1/m.
// Wiffle balls are light and holed, so k is large enough to bend the arc noticeably.

import { solve, invert } from './linalg.js';
import { G, fitBallistic } from './fit.js';

const DEG = 180 / Math.PI;
const STEP = 1 / 2000;

function deriv(s, k, g) {
  const sp = Math.hypot(s[2], s[3]);
  return [s[2], s[3], -k * sp * s[2], -g - k * sp * s[3]];
}

function rk4(s, h, k, g) {
  const k1 = deriv(s, k, g);
  const s2 = s.map((v, i) => v + 0.5 * h * k1[i]);
  const k2 = deriv(s2, k, g);
  const s3 = s.map((v, i) => v + 0.5 * h * k2[i]);
  const k3 = deriv(s3, k, g);
  const s4 = s.map((v, i) => v + h * k3[i]);
  const k4 = deriv(s4, k, g);
  return s.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
}

// Integrate from state [x, y, vx, vy] at time 0 and sample at the given
// non-negative, ascending times. Returns an array of states.
export function simulateAt(state, k, g, times) {
  const out = [];
  let s = state.slice();
  let t = 0;
  for (const target of times) {
    while (t < target - 1e-12) {
      const h = Math.min(STEP, target - t);
      s = rk4(s, h, k, g);
      t += h;
    }
    out.push(s.slice());
  }
  return out;
}

// Integrate until stop(state, t) returns true or tMax passes.
// Returns samples [{ t, x, y, vx, vy }] every `every` seconds plus the final state.
export function simulateUntil(state, k, g, stop, { tMax = 10, every = 1 / 240 } = {}) {
  const out = [{ t: 0, x: state[0], y: state[1], vx: state[2], vy: state[3] }];
  let s = state.slice();
  let t = 0;
  let next = every;
  while (t < tMax) {
    s = rk4(s, STEP, k, g);
    t += STEP;
    const rec = { t, x: s[0], y: s[1], vx: s[2], vy: s[3] };
    if (stop(rec)) {
      out.push(rec);
      break;
    }
    if (t >= next) {
      out.push(rec);
      next += every;
    }
  }
  return out;
}

function residualVector(params, ts, pts, g) {
  const [x0, y0, vx, vy, k] = params;
  const states = simulateAt([x0, y0, vx, vy], Math.max(0, k), g, ts);
  const r = [];
  for (let i = 0; i < pts.length; i++) {
    r.push(pts[i].x - states[i][0], pts[i].y - states[i][1]);
  }
  return r;
}

// Levenberg-Marquardt fit of [x0, y0, vx, vy, k] with g held at the true value.
// The scale calibration is trusted here; the ballistic fit's free g is the check on it.
export function fitDrag(points, { g = G, kInit = 0.03 } = {}) {
  const pts = points.filter((p) => !p.off);
  if (pts.length < 6) return null;
  const base = fitBallistic(pts);
  if (!base) return null;
  const t0 = pts[0].t;
  const ts = pts.map((p) => p.t - t0);

  let p = [base.x0, base.y0, base.vx, base.vy, kInit];
  let r = residualVector(p, ts, pts, g);
  let cost = r.reduce((s, v) => s + v * v, 0);
  let lambda = 1e-3;
  let J = null;

  for (let iter = 0; iter < 60; iter++) {
    J = jacobian(p, ts, pts, g, r);
    const JtJ = Array.from({ length: 5 }, (_, a) =>
      Array.from({ length: 5 }, (_, b) => J.reduce((s, row) => s + row[a] * row[b], 0)));
    const Jtr = Array.from({ length: 5 }, (_, a) => J.reduce((s, row, i) => s + row[a] * r[i], 0));
    let improved = false;
    for (let tries = 0; tries < 8; tries++) {
      const A = JtJ.map((row, i) => row.map((v, j) => (i === j ? v * (1 + lambda) + 1e-12 : v)));
      const step = solve(A, Jtr);
      if (!step) break;
      const cand = p.map((v, i) => v + step[i]);
      cand[4] = Math.max(0, cand[4]);
      const rc = residualVector(cand, ts, pts, g);
      const cc = rc.reduce((s, v) => s + v * v, 0);
      if (cc < cost) {
        const rel = (cost - cc) / Math.max(cost, 1e-18);
        p = cand;
        r = rc;
        cost = cc;
        lambda = Math.max(lambda / 3, 1e-9);
        improved = true;
        if (rel < 1e-10) iter = Infinity;
        break;
      }
      lambda *= 4;
    }
    if (!improved) break;
  }

  J = jacobian(p, ts, pts, g, r);
  const dof = Math.max(1, r.length - 5);
  const sigma2 = cost / dof;
  const JtJ = Array.from({ length: 5 }, (_, a) =>
    Array.from({ length: 5 }, (_, b) => J.reduce((s, row) => s + row[a] * row[b], 0)));
  const inv = invert(JtJ);
  const sd = (i) => (inv ? Math.sqrt(Math.max(0, inv[i][i] * sigma2)) : NaN);

  const [x0, y0, vx, vy, k] = p;
  const v0 = Math.hypot(vx, vy);
  const sV0 = Math.sqrt((vx * sd(2)) ** 2 + (vy * sd(3)) ** 2) / Math.max(v0, 1e-9);
  const sAng = Math.sqrt((vy * sd(2)) ** 2 + (vx * sd(3)) ** 2) / Math.max(v0 * v0, 1e-9);
  const residuals = pts.map((pt, i) => ({ t: pt.t, dx: r[2 * i], dy: r[2 * i + 1] }));

  return {
    model: 'drag',
    t0,
    x0, y0, vx, vy, k, g,
    v0,
    angleDeg: Math.atan2(vy, vx) * DEG,
    sigma: { v0: sV0, angleDeg: sAng * DEG, k: sd(4) },
    // Drag is "resolved" when k is clearly above zero for this clip.
    dragResolved: k > 0 && sd(4) < 0.5 * k,
    rmse: Math.sqrt(cost / pts.length),
    n: pts.length,
    duration: ts[ts.length - 1],
    residuals,
  };
}

function jacobian(p, ts, pts, g, r0) {
  const scales = [1e-5, 1e-5, 1e-5, 1e-5, 1e-6];
  const cols = scales.map((h, j) => {
    const q = p.slice();
    q[j] += h;
    const r = residualVector(q, ts, pts, g);
    // residual = data - model, so d(model)/dp = -(dr/dp)
    return r.map((v, i) => -(v - r0[i]) / h);
  });
  return r0.map((_, i) => cols.map((c) => c[i]));
}

// Model state at absolute time t for either fit type.
export function stateAt(fit, t) {
  const s = t - fit.t0;
  if (fit.model === 'drag') {
    const [st] = simulateAt([fit.x0, fit.y0, fit.vx, fit.vy], fit.k, fit.g, [Math.max(0, s)]);
    return { x: st[0], y: st[1], vx: st[2], vy: st[3] };
  }
  return {
    x: fit.x0 + fit.vx * s,
    y: fit.y0 + fit.vy * s - 0.5 * fit.g * s * s,
    vx: fit.vx,
    vy: fit.vy - fit.g * s,
  };
}
