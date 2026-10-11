// Video frame canvas with overlays, click placement, draggable handles and a loupe.

export const INK = {
  tan: '#fff2cc',
  tan20: 'rgba(255,242,204,0.35)',
  red: '#cc0000',
  white: '#ffffff',
  gray: '#8a8a8a',
};

export class Viewer {
  constructor({ canvas, loupe, hint, viewer }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.loupe = loupe;
    this.lctx = loupe.getContext('2d');
    this.hintEl = hint;
    this.box = viewer;
    this.frames = null;
    this.index = 0;
    this.bitmap = null;
    this.overlay = null;
    this.handles = [];
    this.onClick = null;
    this.onHandleMove = null;
    this.clickable = false;
    this.drag = null;
    this.pointer = null;
    this.token = 0;
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointerleave', () => {
      this.pointer = null;
      this.loupe.hidden = true;
    });
  }

  get unit() {
    return Math.max(1, this.canvas.width / 640);
  }

  setFrames(frames) {
    this.frames = frames;
    this.canvas.width = frames.width;
    this.canvas.height = frames.height;
    this.index = 0;
  }

  setHint(text) {
    this.hintEl.hidden = !text;
    this.hintEl.textContent = text || '';
  }

  setClickable(on) {
    this.clickable = on;
    this.box.classList.toggle('clickable', on);
  }

  async show(i) {
    if (!this.frames) return;
    const idx = Math.max(0, Math.min(this.frames.count - 1, i));
    this.index = idx;
    const token = ++this.token;
    const bmp = await this.frames.bitmap(idx);
    if (token !== this.token) return;
    this.bitmap = bmp;
    this.draw();
  }

  draw() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (this.bitmap) ctx.drawImage(this.bitmap, 0, 0, canvas.width, canvas.height);
    if (this.overlay) {
      ctx.save();
      this.overlay(ctx, this);
      ctx.restore();
    }
    for (const hd of this.handles) this.drawHandle(hd);
    this.drawLoupe();
  }

  drawHandle(hd) {
    const { ctx } = this;
    const u = this.unit;
    ctx.save();
    ctx.strokeStyle = INK.tan;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1.5 * u;
    ctx.beginPath();
    ctx.arc(hd.x, hd.y, 7 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(hd.x - 4 * u, hd.y);
    ctx.lineTo(hd.x + 4 * u, hd.y);
    ctx.moveTo(hd.x, hd.y - 4 * u);
    ctx.lineTo(hd.x, hd.y + 4 * u);
    ctx.stroke();
    if (hd.label) {
      ctx.font = `${12 * u}px -apple-system, sans-serif`;
      ctx.fillStyle = INK.tan;
      ctx.fillText(hd.label, hd.x + 10 * u, hd.y - 10 * u);
    }
    ctx.restore();
  }

  toFrame(e) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * this.canvas.width) / r.width,
      y: ((e.clientY - r.top) * this.canvas.height) / r.height,
    };
  }

  hitHandle(p) {
    const lim = 14 * this.unit;
    let best = null;
    for (const hd of this.handles) {
      const d = Math.hypot(hd.x - p.x, hd.y - p.y);
      if (d < lim && (!best || d < best.d)) best = { hd, d };
    }
    return best && best.hd;
  }

  down(e) {
    const p = this.toFrame(e);
    const hd = this.hitHandle(p);
    if (hd && this.onHandleMove) {
      this.drag = hd;
      this.canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (this.clickable && this.onClick) {
      this.pointerDownAt = p;
      this.canvas.setPointerCapture(e.pointerId);
    }
  }

  move(e) {
    const p = this.toFrame(e);
    this.pointer = p;
    if (this.drag) {
      this.drag.x = p.x;
      this.drag.y = p.y;
      this.onHandleMove(this.drag.id, p, false);
      this.draw();
      return;
    }
    if (this.clickable || this.handles.length) this.drawLoupe();
  }

  up(e) {
    const p = this.toFrame(e);
    if (this.drag) {
      this.onHandleMove(this.drag.id, p, true);
      this.drag = null;
      this.draw();
      return;
    }
    if (this.pointerDownAt && this.onClick) {
      // Pointer up is the placement, so a touch can be nudged before lifting.
      this.onClick(p);
    }
    this.pointerDownAt = null;
  }

  // 4x magnifier around the pointer, for placing marks on a small ball precisely.
  drawLoupe() {
    const p = this.pointer;
    const show = p && this.bitmap && (this.clickable || this.drag);
    this.loupe.hidden = !show;
    if (!show) return;
    const L = this.loupe.width;
    const zoom = 4;
    const src = L / zoom;
    const { lctx } = this;
    lctx.save();
    lctx.fillStyle = '#000';
    lctx.fillRect(0, 0, L, L);
    lctx.beginPath();
    lctx.arc(L / 2, L / 2, L / 2, 0, Math.PI * 2);
    lctx.clip();
    lctx.imageSmoothingEnabled = false;
    lctx.drawImage(this.canvas, p.x - src / 2, p.y - src / 2, src, src, 0, 0, L, L);
    lctx.strokeStyle = INK.red;
    lctx.lineWidth = 2;
    lctx.beginPath();
    lctx.moveTo(L / 2 - 14, L / 2);
    lctx.lineTo(L / 2 + 14, L / 2);
    lctx.moveTo(L / 2, L / 2 - 14);
    lctx.lineTo(L / 2, L / 2 + 14);
    lctx.stroke();
    lctx.restore();
    // Keep the loupe out from under the pointer.
    const r = this.canvas.getBoundingClientRect();
    const onRight = (p.x / this.canvas.width) * r.width > r.width - 170 && (p.y / this.canvas.height) * r.height < 170;
    this.loupe.style.right = onRight ? 'auto' : '0.75rem';
    this.loupe.style.left = onRight ? '0.75rem' : 'auto';
    this.loupe.style.top = onRight ? 'auto' : '0.75rem';
    this.loupe.style.bottom = onRight ? '0.75rem' : 'auto';
  }
}
