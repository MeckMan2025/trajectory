// Read t, x, y position data from another tool's CSV export (Vernier Video Analysis,
// the student tool, a spreadsheet, or this app's own shot format).

const UNIT = { m: 1, cm: 0.01, mm: 0.001, in: 0.0254, ft: 0.3048 };

function splitLine(line, sep) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
    } else if (c === sep && !q) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

function unitOf(name) {
  const m = name.match(/\(([a-z]+)\)|_([a-z]+)$|\[([a-z]+)\]/i);
  const u = m && (m[1] || m[2] || m[3]).toLowerCase();
  return u && UNIT[u] ? UNIT[u] : 1;
}

function findCol(names, re) {
  return names.findIndex((n) => re.test(n.replace(/^.*:\s*/, '')));
}

export function parsePositionCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  if (lines.length < 2) throw new Error('No data rows found.');
  const sep = [',', '\t', ';'].sort((a, b) => lines[0].split(b).length - lines[0].split(a).length)[0];
  const isNum = (s) => s !== '' && Number.isFinite(Number(s));

  // Use the last non-numeric row before the data as the header.
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const cells = splitLine(lines[i], sep);
    if (cells.some((c) => c && !isNum(c))) headerIdx = i;
    else if (headerIdx >= 0) break;
  }
  if (headerIdx < 0) throw new Error('No header row with column names was found.');
  const names = splitLine(lines[headerIdx], sep);

  const ti = findCol(names, /^(t|time)(\b|_)/i);
  const xi = findCol(names, /^(x|x position|position x)(\b|_)(?!\s*vel)/i);
  const yi = findCol(names, /^(y|y position|position y)(\b|_)(?!\s*vel)/i);
  if (ti < 0 || xi < 0 || yi < 0) throw new Error(`Could not find time, x and y columns in: ${names.join(', ')}`);
  const offi = names.findIndex((n) => /^excluded$/i.test(n));
  const confi = names.findIndex((n) => /^confidence$/i.test(n));
  const ux = unitOf(names[xi]);
  const uy = unitOf(names[yi]);
  const ut = /\(ms\)|_ms$/i.test(names[ti]) ? 0.001 : 1;

  const points = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const c = splitLine(lines[i], sep);
    if (![c[ti], c[xi], c[yi]].every(isNum)) continue;
    points.push({
      t: Number(c[ti]) * ut,
      x: Number(c[xi]) * ux,
      y: Number(c[yi]) * uy,
      off: offi >= 0 && c[offi] === '1',
      conf: confi >= 0 ? Number(c[confi]) : 1,
    });
  }
  if (points.length < 4) throw new Error('Fewer than 4 usable rows.');
  points.sort((a, b) => a.t - b.t);
  return { points, columns: { t: names[ti], x: names[xi], y: names[yi] } };
}
