// Shot-to-shot consistency statistics, grouped by launcher setpoint.

export function stats(values) {
  const v = values.filter((x) => Number.isFinite(x));
  const n = v.length;
  if (!n) return { n: 0, mean: NaN, sd: NaN, min: NaN, max: NaN, spread: NaN };
  const mean = v.reduce((s, x) => s + x, 0) / n;
  const sd = n > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0;
  const min = Math.min(...v);
  const max = Math.max(...v);
  return { n, mean, sd, min, max, spread: max - min, cv: mean ? sd / Math.abs(mean) : NaN };
}

function median(v) {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
}

// Robust outlier test using the median absolute deviation.
// A shot is flagged when it sits more than `cut` robust sigmas from the median.
export function outliers(values, cut = 3) {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 4) return values.map(() => false);
  const med = median(v);
  const mad = median(v.map((x) => Math.abs(x - med))) * 1.4826;
  if (mad === 0) return values.map((x) => x !== med);
  return values.map((x) => Number.isFinite(x) && Math.abs(x - med) / mad > cut);
}

export function groupKey(shot) {
  return `${shot.setpoint ?? ''}|${shot.hood ?? ''}`;
}

// shots: [{ id, setpoint, hood, fit: { v0, angleDeg } }]
export function groupShots(shots) {
  const groups = new Map();
  for (const s of shots) {
    if (!s.fit) continue;
    const key = groupKey(s);
    if (!groups.has(key)) groups.set(key, { setpoint: s.setpoint, hood: s.hood, shots: [] });
    groups.get(key).shots.push(s);
  }
  return [...groups.values()].map((g) => {
    const v0 = g.shots.map((s) => s.fit.v0);
    const ang = g.shots.map((s) => s.fit.angleDeg);
    const ov = outliers(v0);
    const oa = outliers(ang);
    return {
      ...g,
      v0: stats(v0),
      angle: stats(ang),
      outlierIds: g.shots.filter((_, i) => ov[i] || oa[i]).map((s) => s.id),
    };
  }).sort((a, b) => (a.hood ?? 0) - (b.hood ?? 0) || (a.setpoint ?? 0) - (b.setpoint ?? 0));
}
