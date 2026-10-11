// Pixel to world conversion for one clip.
// World frame: origin at the launch point, x along the shot, y up, meters.
// Time: media time from the file times videoFps / captureFps, which undoes
// slow-motion re-timing when a 240 fps capture was exported as a 30 fps file.

export function scaleFromStick(a, b, lengthM) {
  const px = Math.hypot(b.x - a.x, b.y - a.y);
  return px > 0 && lengthM > 0 ? lengthM / px : null;
}

// Scale from the tracked ball size. Uses the median radius of confident color
// detections, which resists motion blur and partial frames.
export function scaleFromBall(points, diameterM) {
  const rs = points.filter((p) => p.source === 'color' && p.conf > 0.5 && p.r > 0).map((p) => p.r).sort((x, y) => x - y);
  if (rs.length < 3 || !(diameterM > 0)) return null;
  const r = rs[rs.length >> 1];
  return diameterM / (2 * r);
}

// cal: { mPerPx, origin: {x,y}, level: { a, b } | null, mirror, timeScale }
export function levelAngle(level) {
  if (!level || !level.a || !level.b) return 0;
  // Image y points down, so negate dy to get a standard angle.
  return Math.atan2(-(level.b.y - level.a.y), level.b.x - level.a.x);
}

export function toWorld(p, cal) {
  const th = levelAngle(cal.level);
  const dx = p.x - cal.origin.x;
  const dy = cal.origin.y - p.y;
  const c = Math.cos(th);
  const s = Math.sin(th);
  let x = (dx * c + dy * s) * cal.mPerPx;
  const y = (-dx * s + dy * c) * cal.mPerPx;
  if (cal.mirror) x = -x;
  return { x, y };
}

export function toPixel(w, cal) {
  const th = levelAngle(cal.level);
  const x = (cal.mirror ? -w.x : w.x) / cal.mPerPx;
  const y = w.y / cal.mPerPx;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const dx = x * c - y * s;
  const dy = x * s + y * c;
  return { x: cal.origin.x + dx, y: cal.origin.y - dy };
}

// Shots that travel right to left are mirrored so launch angles read naturally.
export function detectMirror(points, cal) {
  if (points.length < 2) return false;
  const a = toWorld(points[0], { ...cal, mirror: false });
  const b = toWorld(points[points.length - 1], { ...cal, mirror: false });
  return b.x < a.x;
}

// Convert tracked pixel points to world points for fitting.
export function worldPoints(points, cal, mediaTime) {
  return points.map((p) => ({
    i: p.i,
    t: mediaTime(p.i) * cal.timeScale,
    ...toWorld(p, cal),
    conf: p.conf,
    off: p.off,
  }));
}
