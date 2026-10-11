// Side panels for the clip steps: Set Scale, Track Motion, Fit Arc.

import { S, sortedPoints, inRange, timeScale } from '../state.js';
import { h, fmt, pct, toast, field, numInput } from './dom.js';
import { chart } from './charts.js';
import { PRESETS, sampleModel, nearestPreset } from '../tracking/color.js';
import { trackClip, detectInRegion, findBall } from '../tracking/tracker.js';
import { flightRange } from '../tracking/segment.js';
import { metersPerPixel } from '../analyze.js';
import { velocities, G } from '../physics/fit.js';
import { setPref } from '../store.js';

const FT = 3.28084;

// ---------- Canvas handles and clicks ----------

export function handlesFor(view) {
  if (view !== 'scale') return [];
  const c = S.cal;
  const out = [];
  if (c.scaleMode === 'stick') {
    if (c.stickA) out.push({ id: 'stickA', label: 'A', ...c.stickA });
    if (c.stickB) out.push({ id: 'stickB', label: 'B', ...c.stickB });
  }
  if (c.origin) out.push({ id: 'origin', label: 'Launch', ...c.origin });
  if (c.levelA) out.push({ id: 'levelA', label: 'Level', ...c.levelA });
  if (c.levelB) out.push({ id: 'levelB', ...c.levelB });
  return out;
}

export function onHandleMove(id, p, done, app) {
  S.cal[id] = { x: p.x, y: p.y };
  S.fit = null;
  if (done) app.refresh();
}

const NEXT = {
  stickA: ['stickB', 'Click the other end of the reference length.'],
  levelA: ['levelB', 'Click a second point on the same level line.'],
};

export async function onCanvasClick(p, app) {
  const m = S.mode;
  if (['stickA', 'stickB', 'origin', 'levelA', 'levelB'].includes(m)) {
    S.cal[m] = { x: p.x, y: p.y };
    S.fit = null;
    const nx = NEXT[m];
    if (nx) app.setMode(nx[0], nx[1]);
    else app.setMode('done');
    app.refresh();
    if (!nx) app.setMode(null);
    return;
  }
  if (m === 'ball') {
    await startFromClick(p, app);
    return;
  }
  if (m === 'edit') {
    const i = app.frame();
    const old = S.track.points.get(i);
    S.track.points.set(i, { i, x: p.x, y: p.y, r: old?.r || medianR(), conf: 1, source: 'manual', off: false });
    S.fit = null;
    app.refresh();
    app.showFrame(i);
  }
}

function medianR() {
  const rs = sortedPoints().map((p) => p.r).filter((r) => r > 0).sort((a, b) => a - b);
  return rs.length ? rs[rs.length >> 1] : 6;
}

// ---------- Set Scale ----------

export function renderScale(side, below, app) {
  const c = S.cal;
  const st = S.session.settings;
  const mpp = metersPerPixel();
  const clip = S.clip;

  const modeBtn = (key, label) => h('button', {
    class: 'btn small', 'aria-pressed': String(c.scaleMode === key),
    onclick: () => {
      c.scaleMode = key;
      S.fit = null;
      app.refresh();
    },
  }, label);

  const scalePanel = h('div', { class: 'panel stack', style: { gap: '0.75rem' } },
    h('h3', {}, 'Reference length'),
    h('div', { class: 'row' }, modeBtn('stick', 'Meter stick'), modeBtn('ball', 'Ball size')),
    c.scaleMode === 'stick'
      ? [
        h('p', {}, c.stickA && c.stickB
          ? `Set: ${fmt(c.stickLen, 3)} m is ${fmt(Math.hypot(c.stickB.x - c.stickA.x, c.stickB.y - c.stickA.y), 1)} px. Drag the A and B marks to adjust.`
          : 'Click both ends of something with a known length in the plane of the shot.'),
        h('div', { class: 'fields' },
          field('Length (m)', numInput(c.stickLen, { step: '0.001', min: '0.01', oninput: (e) => { c.stickLen = Number(e.target.value) || 1; S.fit = null; } }))),
        h('button', { class: 'btn', onclick: () => app.setMode('stickA', 'Click one end of the reference length.') }, c.stickA ? 'Place Again' : 'Place Stick Ends'),
      ]
      : [
        h('p', {}, 'Scale comes from the tracked ball size. Measure the ball with calipers for best results; a baseball-size wiffle ball is about 72 mm.'),
        h('div', { class: 'fields' },
          field('Ball diameter (m)', numInput(st.ballDiameter, { step: '0.001', min: '0.01', oninput: (e) => { st.ballDiameter = Number(e.target.value) || 0.072; app.persist(); S.fit = null; } }))),
      ],
  );

  const originPanel = h('div', { class: 'panel stack', style: { gap: '0.6rem' } },
    h('h3', {}, 'Launch point'),
    h('p', {}, c.origin ? 'Set. Heights and distances are measured from here.' : 'Auto: the first tracked flight point. Place it by hand to measure from the launcher exit.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => app.setMode('origin', 'Click where the ball leaves the launcher.') }, 'Place Launch Point'),
      c.origin ? h('button', { class: 'btn ghost', onclick: () => { c.origin = null; S.fit = null; app.refresh(); } }, 'Use Auto') : null),
  );

  const levelPanel = h('div', { class: 'panel stack', style: { gap: '0.6rem' } },
    h('h3', {}, 'Level line (optional)'),
    h('p', {}, c.levelA && c.levelB ? 'Set. The frame is rotated so this line is horizontal.' : 'Skip if the phone was level. Otherwise click two points on the floor or a level edge.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => app.setMode('levelA', 'Click a point on a level line, like the floor.') }, 'Place Level Line'),
      c.levelA ? h('button', { class: 'btn ghost', onclick: () => { c.levelA = null; c.levelB = null; S.fit = null; app.refresh(); } }, 'Clear') : null),
  );

  const fpsOptions = [...new Set([Math.round(clip.videoFps || 30), 30, 60, 120, 240, 480, 960])].sort((a, b) => a - b);
  const cur = Math.round(c.captureFps || clip.videoFps || 30);
  const timingPanel = h('div', { class: 'panel stack', style: { gap: '0.6rem' } },
    h('h3', {}, 'Timing'),
    h('p', {}, `The file plays at ${fmt(clip.videoFps, 2)} fps (${clip.method === 'webcodecs' ? 'exact frame timestamps' : clip.method === 'sample' ? 'sample clip' : 'browser player estimate'}). If your phone re-timed a slow-motion clip, pick the rate it was filmed at.`),
    field('Captured at (fps)', h('select', {
      onchange: (e) => {
        const v = Number(e.target.value);
        c.captureFps = v === Math.round(clip.videoFps) ? null : v;
        S.fit = null;
        app.refresh();
      },
    }, fpsOptions.map((f) => h('option', { value: f, selected: f === cur }, f === Math.round(clip.videoFps) ? `${f} (same as file)` : String(f))))),
  );

  const ready = c.scaleMode === 'ball' || (c.stickA && c.stickB);
  side.replaceChildren(
    scalePanel, originPanel, levelPanel, timingPanel,
    h('button', { class: 'btn primary', disabled: !ready, onclick: () => app.go('track') }, 'Next: Track Motion'),
    !ready ? h('p', { class: 'dim', style: { fontSize: '0.85rem' } }, 'Set a reference length first, or switch to ball size.') : null,
  );
  below.replaceChildren(mpp ? h('p', { class: 'dim num', style: { fontSize: '0.85rem' } }, `Scale ${fmt(1 / mpp, 1)} px per meter · time scale ${fmt(timeScale(), 4)}`) : '');
  if (!S.mode && c.scaleMode === 'stick' && !c.stickA) app.setMode('stickA', 'Click one end of the reference length.');
}

// ---------- Track Motion ----------

function modelFor() {
  return S.track.model || PRESETS[S.track.colorKey];
}

async function startFromClick(p, app) {
  const f = S.clip.frames;
  const i = app.frame();
  const R = 80;
  const x0 = Math.max(0, Math.floor(p.x - R));
  const y0 = Math.max(0, Math.floor(p.y - R));
  const w = Math.min(f.width, Math.ceil(p.x + R)) - x0;
  const hh = Math.min(f.height, Math.ceil(p.y + R)) - y0;
  const region = await f.region(i, x0, y0, w, hh);
  const sampled = sampleModel(region, p.x - x0, p.y - y0, 4);
  const tryModel = (model) => detectInRegion(region, model, { ox: x0, oy: y0, pred: p, searchR: 30 })
    .find((c) => Math.hypot(c.x - p.x, c.y - p.y) < 30);
  let model = sampled;
  let hit = sampled && tryModel(sampled);
  if (!hit) {
    model = PRESETS[S.track.colorKey];
    hit = tryModel(model);
  } else {
    const near = nearestPreset(sampled);
    if (near && near !== S.track.colorKey) {
      S.track.colorKey = near;
      toast(`That looks like a ${PRESETS[near].name.toLowerCase()} ball. Using the sampled color.`);
    }
  }
  if (!hit) {
    toast('No ball found at that spot. Pick the ball color and click the center of the ball.');
    return;
  }
  S.track.model = { ...model };
  await runTracking({ i, x: hit.x, y: hit.y, r: hit.r }, app);
}

async function runTracking(start, app, { forwardOnly = false } = {}) {
  const f = S.clip.frames;
  S.track.running = true;
  S.track.stop = false;
  app.setMode(null, 'Tracking...');
  app.refresh();
  const keep = forwardOnly ? sortedPoints().filter((p) => p.i < start.i) : [];
  const pts = await trackClip({
    getRegion: (i, x, y, w, hh) => f.region(i, x, y, w, hh),
    frameWidth: f.width,
    frameHeight: f.height,
    lastIndex: f.count - 1,
    start,
    model: S.track.model,
    directions: forwardOnly ? [1] : [1, -1],
    shouldStop: () => S.track.stop,
    onProgress: (n) => {
      const el = document.getElementById('trackCount');
      if (el) el.textContent = `${n} points`;
    },
  });
  S.track.points = new Map([...keep, ...pts].map((p) => [p.i, { ...p, off: false }]));
  S.track.running = false;
  autoRange();
  S.fit = null;
  app.setMode(null);
  app.refresh();
  const r = S.track.range;
  await app.showFrame(r ? r.first : start.i);
  const flagged = flagList().length;
  toast(`Tracked ${S.track.points.size} frames${flagged ? `, ${flagged} flagged for a look` : ''}.`);
}

function autoRange() {
  const r = flightRange(sortedPoints().filter((p) => !p.off));
  S.track.range = r ? { first: r.first, last: r.last } : null;
}

function flagList() {
  return sortedPoints().filter((p) => inRange(p) && !p.off && (p.conf < 0.45 || p.source === 'motion'));
}

export function renderTrack(side, below, app) {
  const t = S.track;
  const pts = sortedPoints();
  const has = pts.length > 1;
  const model = modelFor();

  if (!t.running) {
    if (has) app.setMode('edit', 'Click to move this frame\'s point. Delete removes it, X excludes it.');
    else app.setMode('ball', 'Find a frame with the ball in flight, then click the ball.');
  }

  const chips = h('div', { class: 'chips' }, Object.entries(PRESETS).map(([key, p]) => h('button', {
    class: 'chip', 'aria-pressed': String(t.colorKey === key),
    onclick: () => {
      t.colorKey = key;
      t.model = null;
      setPref('color', key);
      app.refresh();
    },
  }, h('span', { class: 'dot', style: { background: p.swatch } }), p.name)));

  const colorPanel = h('div', { class: 'panel stack', style: { gap: '0.7rem' } },
    h('h3', {}, 'Ball color'),
    chips,
    h('p', {}, t.model?.name === 'Sampled' ? 'Using the color sampled from your click.' : 'Clicking the ball samples its exact color under your lighting.'),
    S.mentor ? mentorSliders(app) : null,
  );

  const flagged = flagList();
  const r = t.range;
  const trackPanel = h('div', { class: 'panel stack', style: { gap: '0.7rem' } },
    h('h3', {}, 'Track motion'),
    t.running
      ? [h('p', { id: 'trackCount', class: 'num' }, 'Starting...'), h('button', { class: 'btn', onclick: () => { t.stop = true; } }, 'Stop')]
      : [
        h('p', {}, has
          ? `${pts.length} frames tracked. Fit uses frames ${r ? r.first + 1 : 1} to ${r ? r.last + 1 : pts[pts.length - 1].i + 1}. ${flagged.length ? `${flagged.length} flagged.` : 'Nothing flagged.'}`
          : 'Click the ball in any in-flight frame to track it both ways, or let the app look for it.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: async () => {
            const fr = S.clip.frames;
            const i = app.frame();
            const img = await fr.imageData(i);
            // Copy before loading neighbours: the pixel cache may evict this frame.
            const cur = { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
            const nb = [];
            for (const j of [i - 3, i + 3]) if (j >= 0 && j < fr.count) nb.push(await fr.imageData(j));
            const b = findBall(cur, model, nb);
            if (!b) {
              toast('No moving ball of that color in this frame. Try a frame mid-flight, or click the ball.');
              return;
            }
            t.model = { ...model };
            await runTracking({ i: app.frame(), x: b.x, y: b.y, r: b.r }, app);
          } }, 'Find Ball'),
          has ? h('button', { class: 'btn ghost', onclick: () => { t.points = new Map(); t.range = null; S.fit = null; app.refresh(); } }, 'Clear') : null),
      ],
  );

  const editPanel = has && !t.running ? h('div', { class: 'panel stack', style: { gap: '0.7rem' } },
    h('h3', {}, 'Fix and trim'),
    h('div', { class: 'row' },
      h('button', { class: 'btn small', disabled: !flagged.length, onclick: () => {
        const cur = app.frame();
        const next = flagged.find((p) => p.i > cur) || flagged[0];
        if (next) app.showFrame(next.i);
      } }, 'Next Flagged'),
      h('button', { class: 'btn small', onclick: () => {
        if (t.points.delete(app.frame())) { S.fit = null; app.refresh(); app.showFrame(app.frame()); }
      } }, 'Delete Point'),
      h('button', { class: 'btn small', onclick: () => {
        const p = t.points.get(app.frame());
        if (p) { p.off = !p.off; S.fit = null; app.refresh(); app.showFrame(app.frame()); }
      } }, 'Exclude Point')),
    h('div', { class: 'row' },
      h('button', { class: 'btn small', onclick: () => { t.range = { first: app.frame(), last: t.range?.last ?? pts[pts.length - 1].i }; S.fit = null; app.refresh(); } }, 'Set Start Here'),
      h('button', { class: 'btn small', onclick: () => { t.range = { first: t.range?.first ?? pts[0].i, last: app.frame() }; S.fit = null; app.refresh(); } }, 'Set End Here'),
      h('button', { class: 'btn small ghost', onclick: () => { autoRange(); S.fit = null; app.refresh(); } }, 'Auto Range')),
    h('button', { class: 'btn small', onclick: () => {
      const p = t.points.get(app.frame());
      if (!p) { toast('Place the ball in this frame first, then track again from it.'); return; }
      runTracking({ i: p.i, x: p.x, y: p.y, r: p.r || medianR() }, app, { forwardOnly: true });
    } }, 'Track Again From Here'),
    h('p', { class: 'dim', style: { fontSize: '0.82rem' } }, 'Keys: ', h('kbd', {}, '←'), ' ', h('kbd', {}, '→'), ' step, ', h('kbd', {}, 'Shift'), ' x10, ', h('kbd', {}, 'Del'), ' delete, ', h('kbd', {}, 'X'), ' exclude.'),
  ) : null;

  const inFit = t.range ? pts.filter((p) => inRange(p) && !p.off).length : 0;
  const stuck = has && !t.range && !t.running;
  side.replaceChildren(colorPanel, trackPanel,
    stuck ? h('p', { class: 'note warn' }, h('strong', {}, 'No flight found. '), 'The tracked spot never moves, so it is probably not the ball. Press Clear, find a frame mid-flight, and click the ball.') : null,
    editPanel || '',
    h('button', { class: 'btn primary', disabled: inFit < 6 || t.running, onclick: () => app.go('fit') }, 'Next: Fit Arc'));

  below.replaceChildren(flagged.length && !t.running
    ? h('div', { class: 'stack', style: { gap: '0.5rem' } },
      h('div', { class: 'label' }, 'Flagged frames'),
      h('div', { class: 'row' }, flagged.slice(0, 40).map((p) => h('button', { class: 'btn small ghost', onclick: () => app.showFrame(p.i) }, String(p.i + 1)))))
    : '');
}

function mentorSliders(app) {
  const m = { ...modelFor() };
  const slider = (label, key, min, max, step) => field(`${label}: ${fmt(m[key], 2)}`, h('input', {
    type: 'range', min, max, step, value: m[key],
    oninput: (e) => {
      m[key] = Number(e.target.value);
      S.track.model = { ...m, name: 'Sampled' };
      e.target.previousElementSibling.textContent = `${label}: ${fmt(m[key], 2)}`;
    },
  }));
  return h('div', { class: 'stack', style: { gap: '0.4rem' } },
    h('div', { class: 'label' }, `Mentor: color model, hue ${fmt(m.hue, 0)}°`),
    slider('Hue tolerance', 'tol', 5, 60, 1),
    slider('Min saturation', 'sMin', 0.05, 0.9, 0.01),
    slider('Min brightness', 'vMin', 0.05, 0.9, 0.01));
}

// ---------- Fit Arc ----------

function stat(n, l, s) {
  return h('div', { class: 'stat' }, h('div', { class: 'n' }, n), h('div', { class: 'l' }, l), s ? h('div', { class: 's' }, s) : null);
}

function gCheck(fit, app) {
  const b = fit.ballistic;
  const err = Math.abs(b.gError);
  if (fit.suggestFps) {
    return h('div', { class: 'note warn stack', style: { gap: '0.5rem' } },
      h('span', {}, h('strong', {}, 'Timing looks off. '), `Fitted gravity is ${fmt(b.g, 2)} m/s². This clip was probably filmed at ${fit.suggestFps} fps and re-timed on export.`),
      h('button', { class: 'btn small', onclick: () => { S.cal.captureFps = fit.suggestFps; S.fit = null; app.refresh(); } }, `Use ${fit.suggestFps} fps`));
  }
  if (err <= 0.05) {
    return h('p', { class: 'note ok' }, h('strong', {}, 'Scale and timing check out. '), `The no-drag fit finds g = ${fmt(b.g, 2)} m/s², ${pct(err)} from 9.81. A light ball with drag reads a little high.`);
  }
  return h('p', { class: 'note warn' }, h('strong', {}, 'Check scale and timing. '), `The no-drag fit finds g = ${fmt(b.g, 2)} m/s², ${pct(err)} from 9.81. Check the reference length, the frame rate, and that the camera is square to the shot.`);
}

export function renderFit(side, below, app) {
  app.setMode(null);
  const fit = S.fit || app.analyzeNow();
  if (!fit) {
    side.replaceChildren(h('p', { class: 'note warn' }, 'Not enough tracked points or no scale yet. Go back to Set Scale or Track Motion.'));
    below.replaceChildren();
    return;
  }
  const c = fit.chosen;
  const st = S.session.settings;
  const drag = fit.drag;

  const modelRow = h('div', { class: 'row' },
    h('button', { class: 'btn small', 'aria-pressed': String(c.model === 'drag'), disabled: !drag, onclick: () => { S.fit = { prefer: 'drag' }; app.analyzeNow(); app.refresh(); } }, 'Drag model'),
    h('button', { class: 'btn small', 'aria-pressed': String(c.model === 'ballistic'), onclick: () => { S.fit = { prefer: 'ballistic' }; app.analyzeNow(); app.refresh(); } }, 'No drag'));

  const tiles = h('div', { class: 'stats tight' },
    stat(fmt(c.v0, 2), 'Exit speed m/s', `±${fmt(c.sigma.v0, 3)} · ${fmt(c.v0 * FT, 1)} ft/s`),
    stat(`${fmt(c.angleDeg, 1)}°`, 'Launch angle', `±${fmt(c.sigma.angleDeg, 2)}°`),
    stat(fmt(fit.ballistic.g, 2), 'Fitted g m/s²', 'no-drag check'),
    stat(c.model === 'drag' ? fmt(c.k, 3) : '·', 'Drag k 1/m', c.model === 'drag' ? (c.dragResolved ? 'resolved' : 'weak, short arc') : 'off'),
    stat(fmt(fit.arc.apex.y, 2), 'Apex m', 'above launch'),
    stat(fmt(c.rmse * 1000, 1), 'Fit error mm', `${c.n} points`),
  );

  const goal = fit.goal;
  const goalPanel = h('div', { class: 'panel stack', style: { gap: '0.6rem' } },
    h('h3', {}, 'At the goal'),
    h('div', { class: 'fields' },
      field('Launch height m', numInput(st.launchHeight, { step: '0.01', oninput: (e) => { st.launchHeight = Number(e.target.value) || 0; } })),
      field('Goal height m', numInput(st.goalHeight, { step: '0.01', oninput: (e) => { st.goalHeight = Number(e.target.value) || 0; } })),
      field('Goal distance m', numInput(st.goalDistance, { step: '0.01', oninput: (e) => { st.goalDistance = Number(e.target.value) || 0; } }))),
    h('div', { class: 'row spread' },
      h('p', { class: 'num' }, goal
        ? `At ${fmt(st.goalDistance, 2)} m the ball is ${fmt(goal.y, 2)} m high, ${goal.descending ? 'falling' : 'still rising'} at ${fmt(Math.abs(goal.entryAngleDeg), 1)}°. ${goal.y >= st.goalHeight ? `${fmt(goal.y - st.goalHeight, 2)} m over` : `${fmt(st.goalHeight - goal.y, 2)} m under`} the goal.`
        : 'This shot lands before the goal distance.'),
      h('button', { class: 'btn small', onclick: () => { app.persist(); S.fit = null; app.refresh(); } }, 'Update')),
  );

  const saved = S.clip.saved;
  const setpoint = numInput(S.clip.tag?.setpoint ?? S.clip.truth?.rpm ?? '', { step: 'any', id: 'tagSetpoint' });
  const unit = h('input', { type: 'text', value: st.setpointUnit, style: { width: '84px' }, 'aria-label': 'Setpoint unit' });
  const hood = numInput(S.clip.tag?.hood ?? '', { step: 'any' });
  const dist = numInput(S.clip.tag?.distance ?? '', { step: 'any' });
  const notes = h('input', { type: 'text', value: S.clip.tag?.notes ?? '', placeholder: 'Ball 3, new belt...' });
  const savePanel = h('div', { class: 'panel stack', style: { gap: '0.7rem' } },
    h('h3', {}, saved ? `Saved as shot ${saved.n}` : 'Save shot'),
    saved
      ? [
        h('p', {}, `Result in ${fmt(saved.seconds, 0)} s from loading the clip.`),
        h('div', { class: 'row' },
          h('label', { class: 'btn primary', for: 'fileInput' }, 'Load Next Video'),
          h('button', { class: 'btn', onclick: () => app.go('log') }, 'Shot Log')),
      ]
      : [
        h('div', { class: 'fields' },
          h('div', { class: 'wide' }, field('Setpoint', h('div', { class: 'inline-unit' }, setpoint, unit))),
          field('Hood (optional)', hood),
          field('Robot distance m (optional)', dist)),
        field('Notes', notes),
        h('button', { class: 'btn primary', onclick: () => saveShot({ setpoint, unit, hood, dist, notes }, app) }, 'Save Shot'),
      ],
  );

  const truth = S.clip.truth;
  side.replaceChildren(
    h('div', { class: 'panel stack', style: { gap: '0.75rem' } }, h('div', { class: 'row spread' }, h('h3', {}, 'Result'), modelRow), tiles, gCheck(fit, app)),
    truth ? h('p', { class: 'note' }, h('strong', {}, 'Sample truth: '), `${fmt(truth.v0, 3)} m/s at ${fmt(truth.angleDeg, 2)}°, k ${truth.k}. Compare with the tiles above.`) : null,
    goalPanel,
    savePanel,
  );

  // Charts below the video.
  const w = fit.world.filter((p) => !p.off);
  const t0 = c.t0;
  const arcIn = fit.arc.points.filter((p) => p.t <= w[w.length - 1].t + 1e-9);
  const vel = velocities(w);
  const charts = [
    chart('Trajectory', [
      { label: 'Tracked', x: w.map((p) => p.x), y: w.map((p) => p.y), color: '#ffffff', points: true, line: false, size: 3 },
      { label: 'Fit', x: fit.arc.points.map((p) => p.x), y: fit.arc.points.map((p) => p.y), color: '#fff2cc', width: 2 },
    ], { xLabel: 'x (m)', yLabel: 'y (m)' }),
    chart('Speed', [
      { label: 'From points', x: vel.map((p) => p.t - t0), y: vel.map((p) => Math.hypot(p.vx, p.vy)), color: '#8a8a8a', points: true, line: false, size: 3 },
      { label: 'Fit', x: arcIn.map((p) => p.t - t0), y: arcIn.map((p) => Math.hypot(p.vx, p.vy)), color: '#fff2cc', width: 2 },
    ], { xLabel: 't (s)', yLabel: 'speed (m/s)' }),
  ];
  if (S.mentor) {
    charts.push(chart('Residuals (mentor)', [
      { label: 'dx', x: c.residuals.map((r) => r.t - t0), y: c.residuals.map((r) => r.dx * 1000), color: '#fff2cc', points: true, line: false, size: 3 },
      { label: 'dy', x: c.residuals.map((r) => r.t - t0), y: c.residuals.map((r) => r.dy * 1000), color: '#8a8a8a', points: true, line: false, size: 3 },
    ], { xLabel: 't (s)', yLabel: 'mm' }));
    charts.push(h('div', { class: 'panel' }, h('dl', { class: 'specs' },
      h('dt', {}, 'No-drag v0'), h('dd', {}, `${fmt(fit.ballistic.v0, 3)} m/s at ${fmt(fit.ballistic.angleDeg, 2)}°`),
      h('dt', {}, 'Drag v0'), h('dd', {}, drag ? `${fmt(drag.v0, 3)} m/s at ${fmt(drag.angleDeg, 2)}°, k ${fmt(drag.k, 4)} ± ${fmt(drag.sigma.k, 4)}` : 'n/a'),
      h('dt', {}, 'Frame rate'), h('dd', {}, `${fmt(fit.effFps, 2)} fps effective`),
      h('dt', {}, 'Scale'), h('dd', {}, `${fmt(1 / fit.cal.mPerPx, 2)} px/m, ${S.cal.scaleMode}${fit.cal.mirror ? ', mirrored' : ''}`),
      h('dt', {}, 'Gravity used'), h('dd', {}, `${G} m/s² in the drag model`))));
  }
  below.replaceChildren(h('div', { class: 'charts' }, charts));
}

async function saveShot({ setpoint, unit, hood, dist, notes }, app) {
  const fit = S.fit;
  const sp = setpoint.value === '' ? null : Number(setpoint.value);
  if (sp == null) {
    toast('Enter the launcher setpoint for this shot so it can go in the table.');
    setpoint.focus();
    return;
  }
  const st = S.session.settings;
  st.setpointUnit = unit.value.trim() || 'RPM';
  const strip = (f) => f && { ...f, residuals: undefined };
  const seconds = (performance.now() - S.clip.loadedAt) / 1000;
  const shot = {
    id: `shot${Date.now().toString(36)}`,
    n: S.session.shots.length + 1,
    savedAt: new Date().toISOString(),
    clipName: S.clip.name,
    setpoint: sp,
    hood: hood.value === '' ? null : Number(hood.value),
    distance: dist.value === '' ? null : Number(dist.value),
    notes: notes.value.trim(),
    videoFps: S.clip.videoFps,
    effFps: fit.effFps,
    scaleMode: S.cal.scaleMode,
    mPerPx: fit.cal.mPerPx,
    method: S.clip.method,
    fit: strip(fit.chosen),
    ballistic: strip(fit.ballistic),
    drag: strip(fit.drag),
    points: fit.world.map((p) => ({ t: p.t, x: p.x, y: p.y, conf: p.conf, off: !!p.off })),
    secondsToResult: seconds,
    truth: S.clip.truth ? { v0: S.clip.truth.v0, angleDeg: S.clip.truth.angleDeg } : undefined,
  };
  S.session.shots.push(shot);
  S.clip.saved = { n: shot.n, seconds };
  S.clip.tag = { setpoint: sp, hood: shot.hood, distance: shot.distance, notes: shot.notes };
  await app.persist();
  toast(`Shot ${shot.n} saved.`);
  app.refresh();
}
