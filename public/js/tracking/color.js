// Color models for the game pieces and the per-pixel mask.
// A model is { hue (deg), tol (deg), sMin, vMin } in HSV space.

export const PRESETS = {
  yellow: { name: 'Yellow', swatch: '#f2d43a', hue: 54, tol: 20, sMin: 0.4, vMin: 0.4 },
  blue: { name: 'Blue', swatch: '#2f6fe0', hue: 216, tol: 24, sMin: 0.35, vMin: 0.22 },
  red: { name: 'Red', swatch: '#d8262c', hue: 356, tol: 16, sMin: 0.45, vMin: 0.25 },
  purple: { name: 'Purple', swatch: '#7b4bc4', hue: 272, tol: 26, sMin: 0.22, vMin: 0.15 },
};

export function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return [h, max ? d / max : 0, max / 255];
}

function hueDist(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// Binary mask of pixels that match the model. region: { data, width, height }.
export function colorMask(region, model) {
  const { data, width, height } = region;
  const n = width * height;
  const mask = new Uint8Array(n);
  const { hue, tol, sMin, vMin } = model;
  const vMin255 = vMin * 255;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const r = data[j];
    const g = data[j + 1];
    const b = data[j + 2];
    const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
    if (max < vMin255) continue;
    const min = r < g ? (r < b ? r : b) : (g < b ? g : b);
    const d = max - min;
    if (d < sMin * max || d === 0) continue;
    let h;
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
    if (hueDist(h, hue) <= tol) mask[i] = 1;
  }
  return mask;
}

// Build a model from the pixels around a click. Uses the most saturated half of
// the disc so the wiffle holes and background around the ball do not drag it down.
export function sampleModel(region, cx, cy, radius = 6) {
  const { data, width, height } = region;
  const px = [];
  for (let y = Math.max(0, Math.round(cy - radius)); y <= Math.min(height - 1, Math.round(cy + radius)); y++) {
    for (let x = Math.max(0, Math.round(cx - radius)); x <= Math.min(width - 1, Math.round(cx + radius)); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > radius * radius) continue;
      const j = 4 * (y * width + x);
      px.push(rgbToHsv(data[j], data[j + 1], data[j + 2]));
    }
  }
  if (!px.length) return null;
  px.sort((a, b) => b[1] - a[1]);
  const top = px.slice(0, Math.max(3, Math.ceil(px.length / 2)));
  // Circular mean of hue.
  let sx = 0;
  let sy = 0;
  for (const [h] of top) {
    sx += Math.cos((h * Math.PI) / 180);
    sy += Math.sin((h * Math.PI) / 180);
  }
  let hue = (Math.atan2(sy, sx) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  const spread = Math.max(...top.map(([h]) => hueDist(h, hue)));
  const sMed = top[top.length >> 1][1];
  const vs = top.map((p) => p[2]).sort((a, b) => a - b);
  const vLow = vs[Math.floor(vs.length * 0.1)];
  return {
    name: 'Sampled',
    hue,
    tol: Math.min(35, Math.max(12, spread + 8)),
    sMin: Math.max(0.15, sMed * 0.55),
    vMin: Math.max(0.1, vLow * 0.5),
  };
}

// Which preset is closest to a sampled model (for labelling).
export function nearestPreset(model) {
  let best = null;
  for (const [key, p] of Object.entries(PRESETS)) {
    const d = hueDist(p.hue, model.hue);
    if (!best || d < best.d) best = { key, d };
  }
  return best && best.d < 30 ? best.key : null;
}
