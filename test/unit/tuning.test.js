import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stats, outliers, groupShots } from '../../public/js/tuning/consistency.js';
import { fitSpeedModels, setpointFor, speedFor, buildTable, distances } from '../../public/js/tuning/lookup.js';
import { toFrcJava, toFtcJava, toCsv, shotToCsv } from '../../public/js/tuning/exporters.js';
import { parsePositionCsv } from '../../public/js/tuning/importcsv.js';
import { crossingAt } from '../../public/js/physics/solve.js';

// A launcher where exit speed = 0.002 * RPM + 1, at a 50 degree hood.
function fakeShots(hood = 50, slope = 0.002) {
  const out = [];
  let id = 0;
  for (const rpm of [2000, 3000, 4000, 5000]) {
    for (const j of [-0.03, 0, 0.03]) {
      out.push({ id: `s${id++}`, setpoint: rpm, hood, fit: { v0: slope * rpm + 1 + j, angleDeg: hood + j * 10, model: 'drag', k: 0.04, dragResolved: true } });
    }
  }
  return out;
}

test('stats and robust outliers', () => {
  const s = stats([1, 2, 3, 4]);
  assert.equal(s.mean, 2.5);
  assert.ok(Math.abs(s.sd - 1.29099) < 1e-4);
  assert.deepEqual(outliers([10, 10.1, 9.9, 10, 14]), [false, false, false, false, true]);
});

test('groups shots by setpoint and hood', () => {
  const g = groupShots(fakeShots());
  assert.equal(g.length, 4);
  assert.equal(g[0].setpoint, 2000);
  assert.equal(g[0].v0.n, 3);
  assert.ok(Math.abs(g[0].v0.mean - 5) < 1e-9);
});

test('speed model fits and inverts', () => {
  const [m] = fitSpeedModels(fakeShots());
  assert.ok(Math.abs(m.coef[1] - 0.002) < 1e-6);
  assert.ok(Math.abs(setpointFor(m, speedFor(m, 3500)) - 3500) < 1e-6);
  assert.ok(Math.abs(m.k - 0.04) < 1e-12);
  const [q] = fitSpeedModels(fakeShots(), { degree: 2 });
  assert.ok(Math.abs(setpointFor(q, speedFor(q, 3500)) - 3500) < 1e-3);
});

test('lookup table rows actually hit the goal', () => {
  const models = fitSpeedModels(fakeShots());
  const rows = buildTable(models, { distances: distances(1.5, 4, 0.5), goalHeight: 2.0, launchHeight: 0.4 });
  assert.equal(rows.length, 6);
  for (const r of rows.filter((x) => x.ok)) {
    const v = speedFor(models[0], r.setpoint);
    const c = crossingAt(v, models[0].angleDeg, r.distance, { k: models[0].k, launchHeight: 0.4 });
    assert.ok(Math.abs(c.y - 2.0) < 0.005, `row ${r.distance}: ${c.y}`);
  }
  assert.ok(rows.some((r) => r.ok));
});

test('auto hood picks the steeper entry when both reach', () => {
  const models = fitSpeedModels([...fakeShots(40), ...fakeShots(60)]);
  const [row] = buildTable(models, { distances: [3], goalHeight: 2.0, launchHeight: 0.4 });
  assert.ok(row.ok);
  assert.equal(row.hood, 60);
});

function hasJavac() {
  try {
    execFileSync('javac', ['-version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

test('FTC export compiles and interpolates', { skip: !hasJavac() && 'no JDK' }, () => {
  const models = fitSpeedModels(fakeShots());
  const rows = buildTable(models, { distances: distances(1.5, 4, 0.5), goalHeight: 2.0, launchHeight: 0.4 });
  const meta = { date: '2026-10-11', shots: 12, goalHeight: 2, launchHeight: 0.4, setpointUnit: 'RPM' };
  const src = toFtcJava(rows, meta, { unit: 'm' });
  assert.ok(!/[\u2013\u2014]/.test(src));
  const dir = mkdtempSync(join(tmpdir(), 'ftc-'));
  const pkg = join(dir, 'org/firstinspires/ftc/teamcode');
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, 'ShotTable.java'), src);
  writeFileSync(join(dir, 'Main.java'), 'import org.firstinspires.ftc.teamcode.ShotTable;\npublic class Main { public static void main(String[] a) { System.out.println(ShotTable.setpointForMeters(Double.parseDouble(a[0]))); } }\n');
  execFileSync('javac', ['-d', dir, join(pkg, 'ShotTable.java'), join(dir, 'Main.java')], { stdio: 'pipe' });
  const ok = rows.filter((r) => r.ok);
  const mid = (ok[0].distance + ok[1].distance) / 2;
  const out = Number(execFileSync('java', ['-cp', dir, 'Main', String(mid)]).toString());
  assert.ok(Math.abs(out - (ok[0].setpoint + ok[1].setpoint) / 2) < 0.2);
});

test('FRC export has the WPILib map and one put per row', () => {
  const models = fitSpeedModels(fakeShots());
  const rows = buildTable(models, { distances: distances(1.5, 4, 0.5), goalHeight: 2.0, launchHeight: 0.4 });
  const src = toFrcJava(rows, { date: 'x', shots: 12, goalHeight: 2, launchHeight: 0.4, setpointUnit: 'RPM' });
  assert.match(src, /import edu\.wpi\.first\.math\.interpolation\.InterpolatingDoubleTreeMap;/);
  assert.equal((src.match(/SETPOINT\.put/g) || []).length, rows.filter((r) => r.ok).length);
  assert.match(toCsv(rows), /^distance_m,hood,setpoint/);
});

test('CSV import reads Vernier style, inches, and our own shot format', () => {
  const vernier = 'Time (s),X (m),Y (m),X Velocity (m/s)\n0,0,0,1\n0.1,0.5,0.4,1\n0.2,1.0,0.7,1\n0.3,1.5,0.9,1\n';
  const a = parsePositionCsv(vernier);
  assert.equal(a.points.length, 4);
  assert.equal(a.points[2].x, 1.0);

  const inches = 't,x (in),y (in)\n0,0,0\n1,10,20\n2,20,30\n3,30,35\n';
  const b = parsePositionCsv(inches);
  assert.ok(Math.abs(b.points[1].x - 0.254) < 1e-9);

  const ours = shotToCsv({ id: 'a', points: [0, 1, 2, 3].map((i) => ({ t: i / 10, x: i, y: i * 2, conf: 0.9, off: i === 2 })), fit: {} });
  const c = parsePositionCsv(ours);
  assert.equal(c.points.length, 4);
  assert.equal(c.points[2].off, true);
  assert.equal(c.points[3].y, 6);
});
