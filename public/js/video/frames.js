// Random access to decoded frames, with a small cache of decoded pixels.

export class FrameStore {
  constructor(clip, { keep = 10 } = {}) {
    this.clip = clip;
    this.width = clip.width;
    this.height = clip.height;
    this.keep = keep;
    this.bitmaps = new Map();
    this.pixels = new Map();
    this.canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(this.width, this.height)
      : Object.assign(document.createElement('canvas'), { width: this.width, height: this.height });
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  get count() {
    return this.clip.frames.length;
  }

  // Media time of frame i in seconds (from the file, before any slow-motion correction).
  mediaTime(i) {
    return this.clip.frames[i].t;
  }

  static touch(map, key, value, keep) {
    map.delete(key);
    map.set(key, value);
    // Evicted bitmaps are left to garbage collection rather than closed, because
    // the viewer may still be drawing the one it showed last.
    while (map.size > keep) map.delete(map.keys().next().value);
  }

  async bitmap(i) {
    const hit = this.bitmaps.get(i);
    if (hit) {
      FrameStore.touch(this.bitmaps, i, hit, this.keep);
      return hit;
    }
    const bmp = await createImageBitmap(this.clip.frames[i].blob);
    FrameStore.touch(this.bitmaps, i, bmp, this.keep);
    return bmp;
  }

  // Full-frame RGBA pixels for frame i.
  async imageData(i) {
    const hit = this.pixels.get(i);
    if (hit) {
      FrameStore.touch(this.pixels, i, hit, this.keep);
      return hit;
    }
    const bmp = await this.bitmap(i);
    this.ctx.drawImage(bmp, 0, 0);
    const img = this.ctx.getImageData(0, 0, this.width, this.height);
    FrameStore.touch(this.pixels, i, img, this.keep);
    return img;
  }

  // Sub-rectangle of frame i, in the { data, width, height } shape the tracker expects.
  async region(i, x0, y0, w, h) {
    const img = await this.imageData(i);
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      const src = 4 * ((y0 + y) * img.width + x0);
      data.set(img.data.subarray(src, src + 4 * w), 4 * y * w);
    }
    return { data, width: w, height: h };
  }
}
