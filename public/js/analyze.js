// Glue between tracked pixels, calibration and the physics fits.

import { S, sortedPoints, inRange, timeScale } from './state.js';
import { scaleFromStick, scaleFromBall, worldPoints, detectMirror, toWorld } from './calibration.js';
import { fitBallistic, suggestCaptureFps } from './physics/fit.js';
import { fitDrag } from './physics/drag.js';
import { crossingAt, predictArc } from './physics/solve.js';

// Returns meters per pixel from the chosen scale method, or null.
export function metersPerPixel() {
  const c = S.cal;
  if (c.scaleMode === 'stick' && c.stickA && c.stickB) return scaleFromStick(c.stickA, c.stickB, c.stickLen);
  if (c.scaleMode === 'ball') return scaleFromBall(sortedPoints(), S.session.settings.ballDiameter);
  return null;
}

export function calibration() {
  const mPerPx = metersPerPixel();
  if (!mPerPx) return null;
  const flight = sortedPoints().filter((p) => inRange(p) && !p.off);
  const origin = S.cal.origin || (flight[0] ? { x: flight[0].x, y: flight[0].y } : null);
  if (!origin) return null;
  const level = S.cal.levelA && S.cal.levelB ? { a: S.cal.levelA, b: S.cal.levelB } : null;
  const base = { mPerPx, origin, level, timeScale: timeScale() };
  return { ...base, mirror: detectMirror(flight, base), originAuto: !S.cal.origin };
}

export function analyze() {
  const cal = calibration();
  if (!cal || !S.clip) return null;
  const pts = sortedPoints().filter(inRange);
  const world = worldPoints(pts, cal, (i) => S.clip.frames.mediaTime(i));
  const ballistic = fitBallistic(world);
  if (!ballistic) return null;
  const drag = fitDrag(world);
  const chosen = S.fit?.prefer === 'ballistic' || !drag ? ballistic : drag;
  const effFps = S.clip.videoFps / cal.timeScale;
  const st = S.session.settings;
  const goal = crossingAt(chosen.v0, chosen.angleDeg, st.goalDistance - chosen.x0, {
    k: chosen.model === 'drag' ? chosen.k : 0,
    launchHeight: st.launchHeight + chosen.y0,
  });
  return {
    prefer: S.fit?.prefer || 'drag',
    cal,
    world,
    ballistic,
    drag,
    chosen,
    goal,
    arc: predictArc(chosen, { floorY: -st.launchHeight - 0.05, maxX: Math.max(10, st.goalDistance * 2) }),
    suggestFps: suggestCaptureFps(ballistic, effFps),
    effFps,
  };
}

// World position of any pixel, for readouts under the pointer.
export function pixelToWorld(p) {
  const cal = calibration();
  return cal ? toWorld(p, cal) : null;
}
