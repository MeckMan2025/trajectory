// Session pages: Shot Log, Tune (consistency + lookup table), Compare (shootout).

import { S } from '../state.js';
import { h, fmt, pct, toast, download, copy, field, numInput } from './dom.js';
import { chart } from './charts.js';
import { groupShots } from '../tuning/consistency.js';
import { fitSpeedModels, buildTable, distances, speedFor } from '../tuning/lookup.js';
import { toFrcJava, toFtcJava, toCsv, toJson, shotToCsv } from '../tuning/exporters.js';
import { parsePositionCsv } from '../tuning/importcsv.js';
import { fitBallistic } from '../physics/fit.js';
import { fitDrag } from '../physics/drag.js';
import { newSession, listSessions, saveSession, deleteSession, DEFAULT_SETTINGS } from '../store.js';

const SERIES = ['#fff2cc', '#ffffff', '#8a8a8a', '#cccccc'];

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'session';
}

function activeShots() {
  return S.session.shots.filter((s) => !s.excluded && s.fit);
}

// ---------- Shot Log ----------

export async function renderLog(root, app) {
  const sess = S.session;
  const sessions = await listSessions();
  const importInput = h('input', {
    type: 'file', accept: '.json,application/json', hidden: true,
    onchange: async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!Array.isArray(data.shots)) throw new Error('Not a Trajectory session file.');
        data.id = data.id || `s${Date.now().toString(36)}`;
        data.settings = { ...DEFAULT_SETTINGS, ...data.settings };
        if (sessions.some((s) => s.id === data.id)) data.id = `${data.id}-${Date.now().toString(36)}`;
        S.session = data;
        await app.persist();
        toast(`Imported ${data.shots.length} shots.`);
        app.refresh();
      } catch (err) {
        toast(err.message);
      }
    },
  });

  const header = h('div', { class: 'stack', style: { gap: '1rem' } },
    h('div', { class: 'row spread' },
      h('h2', {}, 'Shot Log'),
      h('div', { class: 'row' },
        h('button', { class: 'btn small', onclick: async () => {
          S.session = newSession();
          await app.persist();
          app.refresh();
        } }, 'New Session'),
        h('button', { class: 'btn small', onclick: () => download(`${slug(sess.name)}.trajectory.json`, JSON.stringify(sess, null, 2), 'application/json') }, 'Export Session'),
        h('button', { class: 'btn small', onclick: () => importInput.click() }, 'Import Session'),
        importInput)),
    h('div', { class: 'fields' },
      field('Session name', h('input', { type: 'text', value: sess.name, onchange: async (e) => { sess.name = e.target.value.trim() || sess.name; await app.persist(); app.refresh(); } })),
      sessions.length > 1 ? field('Open session', h('select', {
        onchange: async (e) => {
          const next = sessions.find((s) => s.id === e.target.value);
          if (next) {
            next.settings = { ...DEFAULT_SETTINGS, ...next.settings };
            S.session = next;
            await saveSession(next);
            app.refresh();
          }
        },
      }, sessions.map((s) => h('option', { value: s.id, selected: s.id === sess.id }, `${s.name} (${s.shots.length})`)))) : null),
  );

  if (!sess.shots.length) {
    root.replaceChildren(header, h('div', { class: 'empty' }, 'No shots yet. Load a video, fit the arc, and press Save Shot.'));
    return;
  }

  const groups = groupShots(activeShots());
  const outliers = new Set(groups.flatMap((g) => g.outlierIds));
  const rows = sess.shots.map((s) => {
    const f = s.fit || {};
    const gErr = s.ballistic ? Math.abs(s.ballistic.gError) : NaN;
    return h('tr', { class: s.excluded ? 'excluded' : outliers.has(s.id) ? 'outlier' : '' },
      h('td', { class: 'num' }, String(s.n)),
      h('td', {}, s.clipName || ''),
      h('td', { class: 'num' }, s.setpoint ?? ''),
      h('td', { class: 'num' }, s.hood ?? ''),
      h('td', { class: 'num' }, `${fmt(f.v0, 2)} ± ${fmt(f.sigma?.v0, 2)}`),
      h('td', { class: 'num' }, `${fmt(f.angleDeg, 1)}°`),
      h('td', { class: 'num' }, Number.isFinite(gErr) ? `${fmt(s.ballistic.g, 2)} (${pct(gErr, 0)})` : ''),
      h('td', {}, f.model === 'drag' ? `drag k ${fmt(f.k, 3)}` : 'no drag'),
      h('td', { class: 'num' }, `${fmt(s.secondsToResult, 0)} s`),
      h('td', {}, h('div', { class: 'row', style: { flexWrap: 'nowrap' } },
        h('button', { class: 'btn small ghost', onclick: async () => { s.excluded = !s.excluded; await app.persist(); app.refresh(); } }, s.excluded ? 'Include' : 'Exclude'),
        h('button', { class: 'btn small ghost', onclick: () => download(`shot-${s.n}.csv`, shotToCsv(s), 'text/csv') }, 'CSV'),
        h('button', { class: 'btn small ghost', onclick: async () => {
          if (!confirmInline(s)) return;
          sess.shots = sess.shots.filter((x) => x !== s);
          await app.persist();
          app.refresh();
        } }, s.pendingDelete ? 'Confirm' : 'Delete'))));
  });

  root.replaceChildren(header,
    h('div', { class: 'tablewrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['#', 'Clip', `Setpoint (${sess.settings.setpointUnit})`, 'Hood', 'Exit speed m/s', 'Angle', 'Fitted g', 'Model', 'Time', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows))),
    h('p', { class: 'dim', style: { fontSize: '0.85rem' } }, 'Tan rows are outliers within their setpoint group. Excluded shots stay in the log but are left out of tuning. Time is from loading the clip to saving the shot.'),
    sessions.length > 1 ? h('div', {}, h('button', { class: 'btn small ghost', onclick: async () => {
      if (!sess.pendingDelete) {
        sess.pendingDelete = true;
        toast('Press Delete Session again to remove it from this device.');
        app.refresh();
        return;
      }
      await deleteSession(sess.id);
      const rest = (await listSessions())[0];
      S.session = rest || newSession();
      app.refresh();
    } }, sess.pendingDelete ? 'Confirm Delete Session' : 'Delete Session')) : null,
  );
}

// Two-tap delete without a browser dialog.
function confirmInline(shot) {
  if (shot.pendingDelete) return true;
  shot.pendingDelete = true;
  setTimeout(() => { delete shot.pendingDelete; }, 4000);
  toast('Press Confirm to delete the shot.');
  document.dispatchEvent(new Event('trajectory:rerender'));
  return false;
}

// ---------- Tune ----------

export function renderTune(root, app) {
  const st = S.session.settings;
  const shots = activeShots();
  if (!shots.length) {
    root.replaceChildren(h('h2', {}, 'Tune'), h('div', { class: 'empty' }, 'Save a few shots at two or more setpoints, then build the table here.'));
    return;
  }
  const groups = groupShots(shots);
  const groupTable = h('div', { class: 'tablewrap' }, h('table', {},
    h('thead', {}, h('tr', {}, [`Setpoint (${st.setpointUnit})`, 'Hood', 'Shots', 'Exit speed m/s', 'Speed SD', 'Spread', 'Angle', 'Angle SD', 'Outliers'].map((t) => h('th', {}, t)))),
    h('tbody', {}, groups.map((g) => h('tr', {},
      h('td', { class: 'num' }, g.setpoint ?? ''),
      h('td', { class: 'num' }, g.hood ?? ''),
      h('td', { class: 'num' }, String(g.v0.n)),
      h('td', { class: 'num' }, fmt(g.v0.mean, 2)),
      h('td', { class: 'num' }, g.v0.n > 1 ? `${fmt(g.v0.sd, 3)} (${pct(g.v0.cv)})` : '\u00b7'),
      h('td', { class: 'num' }, g.v0.n > 1 ? fmt(g.v0.spread, 2) : '\u00b7'),
      h('td', { class: 'num' }, `${fmt(g.angle.mean, 1)}°`),
      h('td', { class: 'num' }, g.v0.n > 1 ? `${fmt(g.angle.sd, 2)}°` : '\u00b7'),
      h('td', { class: 'num' }, g.outlierIds.length ? g.outlierIds.map((id) => S.session.shots.find((s) => s.id === id)?.n).join(', ') : ''))))));

  const worst = groups.filter((g) => g.v0.n > 1).sort((a, b) => b.v0.cv - a.v0.cv)[0];
  const consistencyNote = worst
    ? h('p', { class: 'note' }, h('strong', {}, 'Consistency: '), `the widest group is ${worst.setpoint} ${st.setpointUnit}, with exit speed varying ${pct(worst.v0.cv)} shot to shot. Under 2% is good for a flywheel; more usually means uneven compression, worn wheels or a sagging supply voltage.`)
    : h('p', { class: 'note' }, 'Save two or more shots at the same setpoint to measure consistency.');

  const models = fitSpeedModels(shots, { degree: st.degree });
  const modelLines = models.map((m) => {
    const eq = m.degree === 2
      ? `v = ${fmt(m.coef[0], 3)} + ${fmt(m.coef[1], 6)} s + ${m.coef[2].toExponential(3)} s²`
      : m.degree === 1 ? `v = ${fmt(m.coef[0], 3)} + ${fmt(m.coef[1], 6)} s` : `v = ${fmt(m.coef[0], 3)} (one setpoint only)`;
    return h('li', {}, `${m.hood != null ? `Hood ${m.hood}: ` : ''}${eq}, R² ${fmt(m.r2, 4)}, angle ${fmt(m.angleDeg, 1)}°, drag k ${fmt(m.k, 3)}${m.kMeasured ? '' : ' (default)'}, from ${m.n} shots.`);
  });

  const series = [];
  models.forEach((m, k) => {
    const mine = shots.filter((s) => (s.hood ?? null) === m.hood);
    const color = SERIES[k % SERIES.length];
    series.push({ label: `Shots${m.hood != null ? ` hood ${m.hood}` : ''}`, x: mine.map((s) => s.setpoint), y: mine.map((s) => s.fit.v0), color, points: true, line: false, size: 5 });
    const [a, b] = m.range;
    const xs = Array.from({ length: 30 }, (_, i) => a + ((b - a) * i) / 29);
    if (b > a) series.push({ label: 'Model', x: xs, y: xs.map((x) => speedFor(m, x)), color, width: 1.5, dash: [5, 4] });
  });

  const rows = buildTable(models, {
    distances: distances(st.distMin, st.distMax, st.distStep),
    goalHeight: st.goalHeight,
    launchHeight: st.launchHeight,
    requireDescending: st.requireDescending,
  });
  const anyHood = models.some((m) => m.hood != null);
  const table = h('div', { class: 'tablewrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ['Distance m', anyHood ? 'Hood' : null, `Setpoint (${st.setpointUnit})`, 'Exit speed m/s', 'Entry angle', 'Flight time', ''].filter(Boolean).map((t) => h('th', {}, t)))),
    h('tbody', {}, rows.map((r) => h('tr', {},
      h('td', { class: 'num' }, fmt(r.distance, 2)),
      anyHood ? h('td', { class: 'num' }, r.ok ? String(r.hood ?? '') : '') : null,
      h('td', { class: 'num' }, r.ok ? fmt(r.setpoint, 0) : 'out of reach'),
      h('td', { class: 'num' }, r.ok ? fmt(r.v0, 2) : ''),
      h('td', { class: 'num' }, r.ok ? `${fmt(Math.abs(r.entryAngleDeg), 1)}° ${r.descending ? 'down' : 'up'}` : ''),
      h('td', { class: 'num' }, r.ok ? `${fmt(r.flightTime, 2)} s` : ''),
      h('td', { class: 'dim' }, r.ok && r.extrapolated ? 'extrapolated' : ''))))));

  const meta = {
    date: new Date().toISOString().slice(0, 10),
    shots: shots.length,
    goalHeight: st.goalHeight,
    launchHeight: st.launchHeight,
    setpointUnit: st.setpointUnit,
  };
  const exportsOut = {
    frc: () => toFrcJava(rows, meta, { unit: st.exportUnit }),
    ftc: () => toFtcJava(rows, meta, { unit: st.exportUnit }),
    csv: () => toCsv(rows, { unit: st.exportUnit }),
    json: () => toJson(rows, meta),
  };
  const pre = h('pre', { class: 'code' }, exportsOut.frc());
  let current = 'frc';
  const tabBtn = (key, label) => h('button', {
    class: 'btn small', 'aria-pressed': String(key === 'frc'),
    onclick: (e) => {
      current = key;
      pre.textContent = exportsOut[key]();
      for (const b of e.target.parentElement.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === e.target));
    },
  }, label);

  const set = (key, cast = Number) => (e) => {
    st[key] = e.target.type === 'checkbox' ? e.target.checked : cast(e.target.value);
    app.persist();
    app.refresh();
  };

  root.replaceChildren(
    h('h2', {}, 'Tune'),
    h('div', { class: 'stack' }, h('h3', {}, 'Consistency by setpoint'), groupTable, consistencyNote),
    h('div', { class: 'charts' },
      chart('Exit speed vs setpoint', series, { xLabel: st.setpointUnit, yLabel: 'm/s', height: 260 }),
      h('div', { class: 'panel stack', style: { gap: '0.75rem' } },
        h('h3', {}, 'Speed model'),
        field('Fit', h('select', { onchange: set('degree') },
          h('option', { value: 1, selected: st.degree === 1 }, 'Linear (2+ setpoints)'),
          h('option', { value: 2, selected: st.degree === 2 }, 'Quadratic (3+ setpoints)'))),
        h('ul', { class: 'prose', style: { paddingLeft: '1.1rem', color: 'var(--gray)', fontSize: '0.9rem' } }, modelLines))),
    h('div', { class: 'panel stack' },
      h('h3', {}, 'Shot table'),
      h('div', { class: 'fields' },
        field('Goal height m', numInput(st.goalHeight, { step: '0.01', onchange: set('goalHeight') })),
        field('Launch height m', numInput(st.launchHeight, { step: '0.01', onchange: set('launchHeight') })),
        field('From m', numInput(st.distMin, { step: '0.05', onchange: set('distMin') })),
        field('To m', numInput(st.distMax, { step: '0.05', onchange: set('distMax') })),
        field('Step m', numInput(st.distStep, { step: '0.05', min: '0.05', onchange: set('distStep') })),
        field('Export units', h('select', { onchange: set('exportUnit', String) },
          h('option', { value: 'm', selected: st.exportUnit === 'm' }, 'meters'),
          h('option', { value: 'in', selected: st.exportUnit === 'in' }, 'inches')))),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.requireDescending, onchange: set('requireDescending') }), 'Ball must be falling at the goal (top-entry goals)'),
      table,
      h('p', { class: 'dim', style: { fontSize: '0.85rem' } }, 'Each row is solved with the drag model at the average launch angle measured for that hood setting, then mapped to a setpoint with the speed model. Rows outside the setpoints you tested are marked extrapolated; test those on the field.')),
    h('div', { class: 'stack' },
      h('div', { class: 'row spread' },
        h('h3', {}, 'Export'),
        h('div', { class: 'row' }, tabBtn('frc', 'FRC Java'), tabBtn('ftc', 'FTC Java'), tabBtn('csv', 'CSV'), tabBtn('json', 'JSON'))),
      pre,
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: () => copy(exportsOut[current]()) }, 'Copy'),
        h('button', { class: 'btn', onclick: () => {
          const ext = { frc: 'java', ftc: 'java', csv: 'csv', json: 'json' }[current];
          download(current === 'frc' || current === 'ftc' ? 'ShotTable.java' : `shot-table.${ext}`, exportsOut[current]());
        } }, 'Download'))),
  );
}

// ---------- Compare ----------

function summarize(points) {
  const b = fitBallistic(points);
  const d = fitDrag(points);
  return { b, d, n: points.filter((p) => !p.off).length };
}

export function renderCompare(root, app) {
  const sess = S.session;
  sess.compare = sess.compare || { shotId: null, sources: [] };
  const cmp = sess.compare;
  const shots = sess.shots.filter((s) => s.points?.length);
  const ref = shots.find((s) => s.id === cmp.shotId) || shots[shots.length - 1];

  const name = h('input', { type: 'text', placeholder: 'Vernier, Student tool...', value: '' });
  const secs = numInput('', { step: '1', min: '0' });
  const fileIn = h('input', {
    type: 'file', accept: '.csv,.txt,text/csv', hidden: true,
    onchange: async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const { points, columns } = parsePositionCsv(await file.text());
        cmp.sources.push({
          id: `c${Date.now().toString(36)}`,
          name: name.value.trim() || file.name.replace(/\.[^.]+$/, ''),
          file: file.name,
          seconds: secs.value === '' ? null : Number(secs.value),
          points,
          columns,
        });
        await app.persist();
        toast(`Read ${points.length} rows using ${columns.t}, ${columns.x}, ${columns.y}.`);
        app.refresh();
      } catch (err) {
        toast(err.message);
      }
    },
  });

  const entries = [];
  if (ref) {
    entries.push({ name: `Trajectory (shot ${ref.n})`, points: ref.points, seconds: ref.secondsToResult, mine: true });
  }
  for (const s of cmp.sources) entries.push({ ...s });
  const results = entries.map((e) => ({ ...e, ...summarize(e.points) }));
  const base = results.find((r) => r.mine);

  const table = h('div', { class: 'tablewrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ['Source', 'Points', 'Exit speed (drag)', 'Angle', 'No-drag v0', 'Fitted g', 'Fit error', 'Time to result', 'vs Trajectory', ''].map((t) => h('th', {}, t)))),
    h('tbody', {}, results.map((r) => {
      const f = r.d || r.b;
      return h('tr', {},
        h('td', {}, r.name),
        h('td', { class: 'num' }, String(r.n)),
        h('td', { class: 'num' }, f ? `${fmt(f.v0, 3)} m/s` : 'too few points'),
        h('td', { class: 'num' }, f ? `${fmt(f.angleDeg, 2)}°` : ''),
        h('td', { class: 'num' }, r.b ? fmt(r.b.v0, 3) : ''),
        h('td', { class: 'num' }, r.b ? `${fmt(r.b.g, 2)} (${pct(Math.abs(r.b.gError), 1)})` : ''),
        h('td', { class: 'num' }, f ? `${fmt(f.rmse * 1000, 1)} mm` : ''),
        h('td', { class: 'num' }, r.seconds != null ? `${fmt(r.seconds, 0)} s` : ''),
        h('td', { class: 'num' }, base && !r.mine && f && (base.d || base.b) ? `${(f.v0 - (base.d || base.b).v0) >= 0 ? '+' : ''}${fmt(f.v0 - (base.d || base.b).v0, 3)} m/s` : ''),
        h('td', {}, r.mine ? '' : h('button', { class: 'btn small ghost', onclick: async () => {
          cmp.sources = cmp.sources.filter((s) => s.id !== r.id);
          await app.persist();
          app.refresh();
        } }, 'Remove')));
    }))));

  // Overlay, aligned at each source's first point so different origins line up.
  const series = results.map((r, k) => {
    const pts = r.points.filter((p) => !p.off);
    if (!pts.length) return null;
    const dirX = pts[pts.length - 1].x < pts[0].x ? -1 : 1;
    return { label: r.name, x: pts.map((p) => dirX * (p.x - pts[0].x)), y: pts.map((p) => p.y - pts[0].y), color: SERIES[k % SERIES.length], points: true, line: false, size: k ? 4 : 3 };
  }).filter(Boolean);

  root.replaceChildren(
    h('h2', {}, 'Compare'),
    h('p', { class: 'muted' }, 'Run the same clip through each tool, export t, x, y as CSV, and add it here. Every source is fit with the same models, so the differences come from the tracking and scaling alone.'),
    h('div', { class: 'panel stack', style: { gap: '0.75rem' } },
      h('h3', {}, 'Add a source'),
      h('div', { class: 'fields' },
        shots.length ? field('Trajectory shot', h('select', { onchange: async (e) => { cmp.shotId = e.target.value; await app.persist(); app.refresh(); } },
          shots.map((s) => h('option', { value: s.id, selected: ref && s.id === ref.id }, `Shot ${s.n}: ${s.clipName}`)))) : null,
        field('Source name', name),
        field('Seconds to result', secs)),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: () => fileIn.click() }, 'Add CSV'),
        ref ? h('button', { class: 'btn', onclick: () => download(`shot-${ref.n}.csv`, shotToCsv(ref), 'text/csv') }, 'Download This Shot as CSV') : null,
        fileIn),
      h('p', { class: 'dim', style: { fontSize: '0.85rem' } }, 'Reads Vernier Video Analysis exports (Time, X, Y columns), spreadsheets with t, x, y columns in m, cm, mm, in or ft, and this app\'s own shot CSV.')),
    results.length ? table : h('div', { class: 'empty' }, 'Save a shot or add a CSV to start comparing.'),
    series.length ? h('div', { class: 'charts' }, chart('Tracked paths, aligned at the first point', series, { xLabel: 'x (m)', yLabel: 'y (m)', height: 300 })) : null,
  );
}
