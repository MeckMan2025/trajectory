// Build a distance -> launcher setpoint table from measured shots.
// Step 1: per hood setting, fit exit speed as a function of the setpoint (RPM, power...).
// Step 2: for each distance, solve the exit speed that reaches the goal, then invert step 1.

import { leastSquares } from '../physics/linalg.js';
import { requiredSpeed } from '../physics/solve.js';
import { G } from '../physics/fit.js';

export const DEFAULT_K = 0.03;

function evalPoly(c, x) {
  return c.reduce((s, ci, i) => s + ci * x ** i, 0);
}

// shots: [{ setpoint, hood, fit: { v0, angleDeg, model, k, dragResolved } }]
export function fitSpeedModels(shots, { degree = 1, defaultK = DEFAULT_K } = {}) {
  const byHood = new Map();
  for (const s of shots) {
    if (!s.fit || !Number.isFinite(Number(s.setpoint)) || s.excluded) continue;
    const key = s.hood ?? '';
    if (!byHood.has(key)) byHood.set(key, []);
    byHood.get(key).push(s);
  }
  const models = [];
  for (const [hood, list] of byHood) {
    const xs = list.map((s) => Number(s.setpoint));
    const ys = list.map((s) => s.fit.v0);
    const distinct = new Set(xs).size;
    const deg = Math.min(degree, Math.max(0, distinct - 1));
    let coef;
    let r2 = NaN;
    if (deg === 0) {
      coef = [ys.reduce((a, b) => a + b, 0) / ys.length];
    } else {
      const res = leastSquares(xs.map((x) => Array.from({ length: deg + 1 }, (_, i) => x ** i)), ys);
      if (!res) continue;
      coef = res.beta;
      const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
      const ssTot = ys.reduce((s, y) => s + (y - mean) ** 2, 0);
      const ssRes = res.residuals.reduce((s, r) => s + r * r, 0);
      r2 = ssTot > 0 ? 1 - ssRes / ssTot : 1;
    }
    const angles = list.map((s) => s.fit.angleDeg);
    const ks = list.filter((s) => s.fit.model === 'drag' && s.fit.dragResolved).map((s) => s.fit.k);
    models.push({
      hood: hood === '' ? null : hood,
      degree: deg,
      coef,
      r2,
      n: list.length,
      angleDeg: angles.reduce((a, b) => a + b, 0) / angles.length,
      k: ks.length ? ks.reduce((a, b) => a + b, 0) / ks.length : defaultK,
      kMeasured: ks.length > 0,
      range: [Math.min(...xs), Math.max(...xs)],
    });
  }
  return models;
}

export function speedFor(model, setpoint) {
  return evalPoly(model.coef, setpoint);
}

// Setpoint that gives exit speed v0. Searches the measured range widened by 50%
// so mild extrapolation is possible; the caller flags it.
export function setpointFor(model, v0) {
  if (model.degree === 0) return null;
  if (model.degree === 1) return (v0 - model.coef[0]) / model.coef[1];
  const [lo0, hi0] = model.range;
  const pad = 0.5 * (hi0 - lo0 || Math.abs(hi0) || 1);
  let lo = lo0 - pad;
  let hi = hi0 + pad;
  const f = (x) => speedFor(model, x) - v0;
  if (f(lo) * f(hi) > 0) return null;
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    if (f(lo) * f(mid) <= 0) hi = mid;
    else lo = mid;
  }
  return 0.5 * (lo + hi);
}

export function distances(min, max, step) {
  const out = [];
  for (let d = min; d <= max + 1e-9; d += step) out.push(Math.round(d * 1000) / 1000);
  return out;
}

// Returns one row per distance with the best option across hood models.
export function buildTable(models, { distances: ds, goalHeight, launchHeight, g = G, requireDescending = false }) {
  return ds.map((distance) => {
    const options = [];
    for (const m of models) {
      const sol = requiredSpeed({ angleDeg: m.angleDeg, targetDistance: distance, targetHeight: goalHeight, launchHeight, k: m.k, g });
      if (!sol) continue;
      const setpoint = setpointFor(m, sol.v0);
      if (setpoint == null || !Number.isFinite(setpoint)) continue;
      const span = m.range[1] - m.range[0];
      const tol = 0.02 * (span || Math.abs(m.range[1]) || 1);
      const extrapolated = setpoint < m.range[0] - tol || setpoint > m.range[1] + tol;
      options.push({
        distance,
        hood: m.hood,
        setpoint,
        v0: sol.v0,
        angleDeg: m.angleDeg,
        entryAngleDeg: sol.entryAngleDeg,
        descending: sol.descending,
        flightTime: sol.t,
        extrapolated,
      });
    }
    const pool = options.filter((o) => !requireDescending || o.descending);
    pool.sort((a, b) => (a.extrapolated - b.extrapolated) || (a.entryAngleDeg - b.entryAngleDeg));
    const best = pool[0];
    return best ? { ...best, ok: true } : { distance, ok: false };
  });
}
