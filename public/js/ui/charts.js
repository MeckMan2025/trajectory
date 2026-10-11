// uPlot charts styled with the V4 tokens. Each series may have its own x values;
// they are merged with uPlot.join and gaps are spanned for lines.

import uPlot from 'uplot';
import { h } from './dom.js';

const AXIS = {
  stroke: '#8a8a8a',
  grid: { stroke: 'rgba(255,242,204,0.08)', width: 1 },
  ticks: { stroke: 'rgba(255,242,204,0.15)', width: 1 },
  font: '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  labelFont: '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};

const live = new Set();
let observer = null;

function watch(plot, el) {
  live.add({ plot, el });
  if (!observer) {
    observer = new ResizeObserver(() => {
      for (const item of [...live]) {
        if (!item.el.isConnected) {
          item.plot.destroy();
          live.delete(item);
          continue;
        }
        const w = item.el.clientWidth;
        if (w && Math.abs(w - item.plot.width) > 2) item.plot.setSize({ width: w, height: item.plot.height });
      }
    });
  }
  observer.observe(el);
}

/**
 * series: [{ label, x: [], y: [], color, points: bool, line: bool, dash: [] }]
 */
export function chart(title, series, { xLabel = '', yLabel = '', height = 240, equal = false } = {}) {
  const el = h('div', { class: 'chart' }, h('h4', {}, title));
  const body = h('div');
  el.append(body);
  const clean = series.filter((s) => s.x.length);
  if (!clean.length) {
    body.append(h('p', { class: 'dim', style: { padding: '1rem' } }, 'No data yet.'));
    return el;
  }
  const tables = clean.map((s) => {
    const idx = s.x.map((_, i) => i).sort((a, b) => s.x[a] - s.x[b]);
    return [idx.map((i) => s.x[i]), idx.map((i) => s.y[i])];
  });
  const data = uPlot.join(tables);
  const opts = {
    width: 400,
    height,
    legend: { show: clean.length > 1, live: false },
    cursor: { drag: { x: false, y: false }, points: { show: false } },
    scales: { x: { time: false }, y: equal ? { range: (u, min, max) => [Math.min(0, min), max + 0.1 * (max - min || 1)] } : {} },
    axes: [
      { ...AXIS, label: xLabel, labelSize: 18, size: 36 },
      { ...AXIS, label: yLabel, labelSize: 18, size: 50 },
    ],
    series: [
      {},
      ...clean.map((s) => ({
        label: s.label,
        stroke: s.color,
        width: s.line === false ? 0 : (s.width || 1.5),
        dash: s.dash,
        spanGaps: true,
        paths: s.line === false ? () => null : undefined,
        points: s.points
          ? { show: true, size: s.size || 4, stroke: s.color, fill: s.fill || s.color, width: 1 }
          : { show: false },
      })),
    ],
  };
  requestAnimationFrame(() => {
    opts.width = Math.max(240, body.clientWidth || 400);
    const plot = new uPlot(opts, data, body);
    watch(plot, body);
  });
  return el;
}
