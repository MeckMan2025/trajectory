// Shot prediction and the inverse problem: what launch speed hits a target?

import { simulateUntil } from './drag.js';
import { G } from './fit.js';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

// Fly a shot from (0, launchHeight) and report the height and descent angle when
// it reaches horizontal distance `x`. Returns null when it lands first.
export function crossingAt(v0, angleDeg, x, { k = 0, g = G, launchHeight = 0 } = {}) {
  const a = angleDeg * RAD;
  const state = [0, launchHeight, v0 * Math.cos(a), v0 * Math.sin(a)];
  let prev = null;
  let hit = null;
  simulateUntil(state, k, g, (s) => {
    if (s.x >= x) {
      hit = s;
      return true;
    }
    if (s.y < -1 || s.vx <= 0) return true;
    prev = s;
    return false;
  }, { tMax: 6, every: 1 });
  if (!hit) return null;
  // Linear interpolation between the last two integration states.
  let y = hit.y;
  let vy = hit.vy;
  let vx = hit.vx;
  let t = hit.t;
  if (prev && hit.x !== prev.x) {
    const f = (x - prev.x) / (hit.x - prev.x);
    y = prev.y + f * (hit.y - prev.y);
    vy = prev.vy + f * (hit.vy - prev.vy);
    vx = prev.vx + f * (hit.vx - prev.vx);
    t = prev.t + f * (hit.t - prev.t);
  }
  return { y, vx, vy, t, entryAngleDeg: Math.atan2(vy, vx) * DEG, descending: vy < 0 };
}

// Find the launch speed that puts the ball at targetHeight when it reaches
// targetDistance, for a fixed launch angle. Height at a fixed x rises with speed,
// so bisection on v0 is safe. Returns null when no speed in range works.
export function requiredSpeed({ angleDeg, targetDistance, targetHeight, launchHeight = 0, k = 0, g = G, vMin = 0.5, vMax = 40 }) {
  const heightAt = (v) => {
    const c = crossingAt(v, angleDeg, targetDistance, { k, g, launchHeight });
    return c ? c.y : -Infinity;
  };
  if (heightAt(vMax) < targetHeight) return null;
  let lo = vMin;
  let hi = vMax;
  if (heightAt(lo) >= targetHeight) return null;
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (heightAt(mid) < targetHeight) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-5) break;
  }
  const v0 = 0.5 * (lo + hi);
  const c = crossingAt(v0, angleDeg, targetDistance, { k, g, launchHeight });
  return { v0, ...c };
}

// Predicted full flight from a fit (world coordinates), until the ball falls
// `floorDrop` meters below the launch point or leaves maxX.
export function predictArc(fit, { floorY = -2, maxX = 30, every = 1 / 240 } = {}) {
  const state = [fit.x0, fit.y0, fit.vx, fit.vy];
  const k = fit.model === 'drag' ? fit.k : 0;
  const pts = simulateUntil(state, k, fit.g, (s) => s.y < floorY || Math.abs(s.x) > maxX, { tMax: 6, every });
  let apex = pts[0];
  for (const p of pts) if (p.y > apex.y) apex = p;
  const last = pts[pts.length - 1];
  return { points: pts.map((p) => ({ ...p, t: p.t + fit.t0 })), apex: { ...apex, t: apex.t + fit.t0 }, landing: last };
}
