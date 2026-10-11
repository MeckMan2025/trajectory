// Binary morphology and connected components on Uint8Array masks.

// Square dilation or erosion with radius r, done as two separable 1D passes.
function morph(mask, w, h, r, dilate) {
  if (r <= 0) return mask.slice();
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  // Horizontal pass: count set pixels in the window with a running sum.
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let count = 0;
    for (let x = 0; x < Math.min(r, w); x++) count += mask[row + x];
    for (let x = 0; x < w; x++) {
      if (x + r < w) count += mask[row + x + r];
      if (x - r - 1 >= 0) count -= mask[row + x - r - 1];
      const span = Math.min(w - 1, x + r) - Math.max(0, x - r) + 1;
      tmp[row + x] = dilate ? (count > 0 ? 1 : 0) : (count === span ? 1 : 0);
    }
  }
  for (let x = 0; x < w; x++) {
    let count = 0;
    for (let y = 0; y < Math.min(r, h); y++) count += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      if (y + r < h) count += tmp[(y + r) * w + x];
      if (y - r - 1 >= 0) count -= tmp[(y - r - 1) * w + x];
      const span = Math.min(h - 1, y + r) - Math.max(0, y - r) + 1;
      out[y * w + x] = dilate ? (count > 0 ? 1 : 0) : (count === span ? 1 : 0);
    }
  }
  return out;
}

export const dilate = (m, w, h, r) => morph(m, w, h, r, true);
export const erode = (m, w, h, r) => morph(m, w, h, r, false);

// Closing fills the wiffle ball holes and the gaps motion blur leaves.
export function close(mask, w, h, r) {
  return erode(dilate(mask, w, h, r), w, h, r);
}

// 8-connected components. Returns blob stats; minArea filters out specks.
export function components(mask, w, h, { minArea = 4 } = {}) {
  const labels = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const blobs = [];
  let next = 1;
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || labels[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = next;
    let area = 0;
    let sx = 0;
    let sy = 0;
    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    while (sp) {
      const p = stack[--sp];
      const x = p % w;
      const y = (p - x) / w;
      area++;
      sx += x;
      sy += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (mask[q] && !labels[q]) {
            labels[q] = next;
            stack[sp++] = q;
          }
        }
      }
    }
    if (area >= minArea) {
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      blobs.push({
        label: next,
        area,
        // +0.5 puts the centroid at pixel centers, matching canvas coordinates.
        x: sx / area + 0.5,
        y: sy / area + 0.5,
        bw,
        bh,
        r: Math.sqrt(area / Math.PI),
        aspect: Math.min(bw, bh) / Math.max(bw, bh),
        fill: area / ((Math.PI / 4) * bw * bh),
      });
    }
    next++;
  }
  return blobs;
}
