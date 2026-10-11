// Trajectory: launcher tuning from slow-motion video. A Meckman Lab experiment.

import { S, sortedPoints, inRange } from './js/state.js';
import { $, h, toast, modal } from './js/ui/dom.js';
import { Viewer, INK } from './js/ui/viewer.js';
import { FrameStore } from './js/video/frames.js';
import { decodeVideo } from './js/video/decoder.js';
import { loadCurrentSession, saveSession, getPref, setPref } from './js/store.js';
import { renderScale, renderTrack, renderFit, onCanvasClick, onHandleMove, handlesFor } from './js/ui/steps.js';
import { renderLog, renderTune, renderCompare } from './js/ui/pages.js';
import { analyze, calibration } from './js/analyze.js';
import { toPixel } from './js/calibration.js';

const viewer = new Viewer({ canvas: $('#canvas'), loupe: $('#loupe'), hint: $('#hint'), viewer: $('#viewer') });

export const app = {
  viewer,
  go,
  redraw,
  refresh,
  persist,
  loadFile,
  loadSample,
  analyzeNow,
  setMode,
  frame: () => viewer.index,
  showFrame: (i) => showFrame(i),
};

const CLIP_VIEWS = ['scale', 'track', 'fit'];

// ---------- Navigation ----------

function go(view) {
  if (CLIP_VIEWS.includes(view) && !S.clip) view = 'load';
  S.view = view;
  if (S.track.running && view !== 'track') S.track.stop = true;
  setMode(null);
  for (const b of document.querySelectorAll('#steps button')) {
    const v = b.dataset.view;
    b.toggleAttribute('aria-current', v === view);
    if (v === view) b.setAttribute('aria-current', 'step');
    if (CLIP_VIEWS.includes(v)) b.disabled = !S.clip;
  }
  $('#view-load').hidden = view !== 'load';
  $('#view-work').hidden = !CLIP_VIEWS.includes(view);
  $('#view-log').hidden = view !== 'log';
  $('#view-tune').hidden = view !== 'tune';
  $('#view-compare').hidden = view !== 'compare';
  refresh();
  window.scrollTo({ top: 0 });
}

function refresh() {
  const v = S.view;
  $('#shotCount').textContent = S.session?.shots.length ? `(${S.session.shots.length})` : '';
  $('#sessionName').textContent = S.session?.name || '';
  if (v === 'scale') renderScale($('#side'), $('#workBelow'), app);
  if (v === 'track') renderTrack($('#side'), $('#workBelow'), app);
  if (v === 'fit') renderFit($('#side'), $('#workBelow'), app);
  if (v === 'log') renderLog($('#logPage'), app);
  if (v === 'tune') renderTune($('#tunePage'), app);
  if (v === 'compare') renderCompare($('#comparePage'), app);
  if (CLIP_VIEWS.includes(v)) {
    viewer.handles = handlesFor(v);
    redraw();
  }
}

function setMode(mode, hint) {
  S.mode = mode;
  viewer.setClickable(!!mode);
  viewer.setHint(hint || '');
}

async function persist() {
  const ok = await saveSession(S.session);
  if (!ok) toast('Could not save to this browser. Export the session to keep it.');
}

function analyzeNow() {
  S.fit = analyze();
  return S.fit;
}

// ---------- Frames and overlay ----------

async function showFrame(i) {
  if (!S.clip) return;
  await viewer.show(i);
  $('#scrub').value = String(viewer.index);
  const t = S.clip.frames.mediaTime(viewer.index);
  const p = S.track.points.get(viewer.index);
  const ptxt = p ? ` · ball ${p.source}${p.off ? ' (excluded)' : ''} ${Math.round(p.conf * 100)}%` : '';
  $('#frameReadout').textContent = `Frame ${viewer.index + 1} / ${S.clip.frames.count} · ${t.toFixed(4)} s file time${ptxt}`;
}

function redraw() {
  viewer.draw();
}

viewer.overlay = (ctx, v) => {
  const u = v.unit;
  const view = S.view;
  const cal = S.clip ? calibration() : null;

  // Reference stick and level line.
  const line = (a, b, color, dash = []) => {
    if (!a || !b) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 * u;
    ctx.setLineDash(dash.map((d) => d * u));
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  };
  if (S.cal.scaleMode === 'stick') line(S.cal.stickA, S.cal.stickB, INK.tan);
  line(S.cal.levelA, S.cal.levelB, INK.tan20, [6, 4]);

  // Axes at the launch point.
  if (cal && view !== 'scale') {
    const o = cal.origin;
    const xEnd = toPixel({ x: 0.5, y: 0 }, cal);
    const yEnd = toPixel({ x: 0, y: 0.5 }, cal);
    line(o, xEnd, INK.tan20);
    line(o, yEnd, INK.tan20);
    ctx.fillStyle = INK.tan;
    ctx.font = `${11 * u}px -apple-system, sans-serif`;
    ctx.fillText('x', xEnd.x + 4 * u, xEnd.y + 4 * u);
    ctx.fillText('y', yEnd.x + 4 * u, yEnd.y - 4 * u);
  }

  // Tracked points.
  const pts = sortedPoints();
  for (const p of pts) {
    const flight = inRange(p) && !p.off;
    const weak = p.conf < 0.45 || p.source === 'motion';
    ctx.beginPath();
    ctx.arc(p.x, p.y, (flight ? 2.4 : 1.6) * u, 0, Math.PI * 2);
    if (!flight) {
      ctx.strokeStyle = INK.gray;
      ctx.lineWidth = 1 * u;
      ctx.stroke();
    } else if (weak) {
      ctx.strokeStyle = INK.tan;
      ctx.lineWidth = 1.2 * u;
      ctx.stroke();
    } else {
      ctx.fillStyle = INK.tan;
      ctx.fill();
    }
  }

  // Fitted and predicted arc: the one red element in this view.
  if (view === 'fit' && S.fit && cal) {
    ctx.save();
    ctx.strokeStyle = INK.red;
    ctx.lineWidth = 2 * u;
    ctx.beginPath();
    S.fit.arc.points.forEach((w, k) => {
      const p = toPixel(w, cal);
      if (k) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
    });
    ctx.stroke();
    const apex = toPixel(S.fit.arc.apex, cal);
    ctx.fillStyle = INK.white;
    ctx.font = `${11 * u}px -apple-system, sans-serif`;
    ctx.fillText(`apex ${S.fit.arc.apex.y.toFixed(2)} m`, apex.x + 6 * u, apex.y - 6 * u);
    ctx.restore();
  }

  // Current frame's point gets a white ring.
  const cur = S.track.points.get(v.index);
  if (cur) {
    ctx.strokeStyle = INK.white;
    ctx.lineWidth = 1.5 * u;
    ctx.beginPath();
    ctx.arc(cur.x, cur.y, Math.max(6 * u, (cur.r || 4) + 4 * u), 0, Math.PI * 2);
    ctx.stroke();
  }
};

viewer.onClick = (p) => onCanvasClick(p, app);
viewer.onHandleMove = (id, p, done) => onHandleMove(id, p, done, app);

// ---------- Loading ----------

function progress(f) {
  const bar = $('#loadProgress');
  bar.hidden = f == null;
  bar.firstElementChild.style.width = `${Math.round((f || 0) * 100)}%`;
}

function status(msg, warn = false) {
  const el = $('#loadStatus');
  el.hidden = !msg;
  el.textContent = msg || '';
  el.className = `note${warn ? ' warn' : ''}`;
}

function sameSetup(clip) {
  return S.cal.width === clip.width && S.cal.height === clip.height;
}

async function adoptClip(clip, name, extra = {}) {
  const frames = new FrameStore(clip);
  const keepCal = sameSetup(clip) && (S.cal.stickA || S.cal.scaleMode === 'ball');
  if (!keepCal) {
    Object.assign(S.cal, { stickA: null, stickB: null, origin: null, levelA: null, levelB: null, captureFps: null });
  }
  S.cal.width = clip.width;
  S.cal.height = clip.height;
  S.clip = { ...clip, name, frames, loadedAt: extra.startedAt || performance.now(), ...extra };
  S.track.points = new Map();
  S.track.range = null;
  S.fit = null;
  viewer.setFrames(frames);
  $('#scrub').max = String(frames.count - 1);
  progress(null);
  status('');
  await showFrame(0);
  go(keepCal ? 'track' : 'scale');
  if (keepCal) toast('Same camera setup: scale and timing kept from the last clip.');
}

async function loadFile(file) {
  if (!file) return;
  const startedAt = performance.now();
  status(`Decoding ${file.name}...`);
  progress(0);
  try {
    const clip = await decodeVideo(file, {
      maxWidth: getPref('cacheWidth', 1280),
      onProgress: (f) => progress(f),
      onFallback: () => status('Using the browser player to step through frames. Confirm the frame rate on the next screen.', true),
    });
    await adoptClip(clip, file.name, { startedAt });
  } catch (e) {
    progress(null);
    status(e.message || String(e), true);
  }
}

async function loadSample() {
  const startedAt = performance.now();
  status('Rendering a sample shot...');
  progress(0);
  const { sampleClip } = await import('./js/demo/sample.js');
  const { clip, truth } = await sampleClip({ onProgress: progress });
  await adoptClip(clip, `sample-${truth.rpm}rpm`, { truth, startedAt });
  if (S.view === 'scale' && !S.cal.stickA) {
    toast('Sample clip: the light stick on the floor is exactly 1 m. Click both ends.');
  }
}

// ---------- Wiring ----------

$('#fileInput').addEventListener('change', (e) => {
  loadFile(e.target.files[0]);
  e.target.value = '';
});
$('#sampleBtn').addEventListener('click', () => loadSample());
const dz = $('#dropzone');
dz.addEventListener('dragover', (e) => {
  e.preventDefault();
  dz.classList.add('over');
});
dz.addEventListener('dragleave', () => dz.classList.remove('over'));
dz.addEventListener('drop', (e) => {
  e.preventDefault();
  dz.classList.remove('over');
  loadFile(e.dataTransfer.files[0]);
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer.files[0]?.type.startsWith('video')) loadFile(e.dataTransfer.files[0]);
});

document.addEventListener('trajectory:rerender', () => refresh());

$('#steps').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (b && !b.disabled) go(b.dataset.view);
});

$('#scrub').addEventListener('input', (e) => showFrame(Number(e.target.value)));
$('#prevFrame').addEventListener('click', () => showFrame(viewer.index - 1));
$('#nextFrame').addEventListener('click', () => showFrame(viewer.index + 1));

let playing = null;
$('#playBtn').addEventListener('click', () => {
  if (playing) {
    cancelAnimationFrame(playing);
    playing = null;
    $('#playBtn').textContent = 'Play';
    return;
  }
  $('#playBtn').textContent = 'Pause';
  let last = 0;
  const step = async (now) => {
    // Show about 30 frames a second, so slow motion stays slow enough to watch.
    if (now - last > 33) {
      last = now;
      await showFrame(viewer.index + 1 >= S.clip.frames.count ? 0 : viewer.index + 1);
    }
    if (playing) playing = requestAnimationFrame(step);
  };
  playing = requestAnimationFrame(step);
});

document.addEventListener('keydown', (e) => {
  if (!CLIP_VIEWS.includes(S.view) || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
  const big = e.shiftKey ? 10 : 1;
  if (e.key === 'ArrowRight') {
    showFrame(viewer.index + big);
    e.preventDefault();
  } else if (e.key === 'ArrowLeft') {
    showFrame(viewer.index - big);
    e.preventDefault();
  } else if (S.view === 'track' && (e.key === 'Delete' || e.key === 'Backspace')) {
    if (S.track.points.delete(viewer.index)) {
      S.fit = null;
      refresh();
      showFrame(viewer.index);
    }
    e.preventDefault();
  } else if (S.view === 'track' && e.key.toLowerCase() === 'x') {
    const p = S.track.points.get(viewer.index);
    if (p) {
      p.off = !p.off;
      refresh();
      showFrame(viewer.index);
    }
  }
});

const mentorBtn = $('#mentorToggle');
mentorBtn.addEventListener('click', () => {
  S.mentor = !S.mentor;
  setPref('mentor', S.mentor);
  mentorBtn.setAttribute('aria-pressed', String(S.mentor));
  refresh();
});

$('#helpLink').addEventListener('click', (e) => {
  e.preventDefault();
  modal('Filming tips', h('div', { class: 'prose' },
    h('ul', {},
      h('li', {}, 'Use slow motion: 240 fps is best, 120 fps is fine. Normal 30 fps video works but gives rougher speeds.'),
      h('li', {}, 'Put the phone on a tripod, level, and square to the flight path. The ball should fly across the frame, not toward the camera.'),
      h('li', {}, 'Stand back and zoom in a little so the whole arc fits. Less lens distortion that way.'),
      h('li', {}, 'Lay a meter stick or a taped 1 m mark in the same plane as the shot, ideally under the launcher.'),
      h('li', {}, 'A plain background helps. Avoid anything the same color as the ball near the flight path.'),
      h('li', {}, 'Bright light means a faster shutter and less blur.'),
      h('li', {}, 'Share the original slow-motion file. If the app says the fitted gravity is way off, it will suggest the right frame rate.'),
    )));
});

// ---------- Start ----------

(async () => {
  S.mentor = getPref('mentor', false);
  S.track.colorKey = getPref('color', 'yellow');
  mentorBtn.setAttribute('aria-pressed', String(S.mentor));
  S.session = await loadCurrentSession();
  go('load');
})();

window.addEventListener('beforeunload', (e) => {
  if (S.clip && S.fit && !S.clip.saved) {
    e.preventDefault();
  }
});
