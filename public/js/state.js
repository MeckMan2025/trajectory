// Shared app state and a tiny change notifier.

export const S = {
  session: null,
  view: 'load',
  mentor: false,
  clip: null,
  // Calibration persists across clips from the same camera setup.
  cal: {
    scaleMode: 'stick',
    stickA: null,
    stickB: null,
    stickLen: 1.0,
    origin: null,
    levelA: null,
    levelB: null,
    captureFps: null,
    width: null,
    height: null,
  },
  track: {
    colorKey: 'yellow',
    model: null,
    points: new Map(),
    range: null,
    running: false,
    stop: false,
  },
  fit: null,
  // Placement mode for canvas clicks: stickA, stickB, origin, levelA, levelB, ball, edit.
  mode: null,
};

const listeners = new Set();
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function changed(what) {
  for (const fn of listeners) fn(what);
}

export function sortedPoints() {
  return [...S.track.points.values()].sort((a, b) => a.i - b.i);
}

export function inRange(p) {
  const r = S.track.range;
  return !r || (p.i >= r.first && p.i <= r.last);
}

export function timeScale() {
  const c = S.clip;
  if (!c) return 1;
  const cap = S.cal.captureFps || c.videoFps;
  return c.videoFps && cap ? c.videoFps / cap : 1;
}
