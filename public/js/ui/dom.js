// Tiny DOM helpers so the screens read like markup.

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export function $(sel, root = document) {
  return root.querySelector(sel);
}

export function fmt(x, d = 2) {
  return Number.isFinite(x) ? Number(x).toFixed(d) : '·';
}

export function pct(x, d = 1) {
  return Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : '·';
}

let toastTimer = null;
export function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, ms);
}

// Show a modal; content is a node. Returns a close function.
export function modal(title, content, { actions = [] } = {}) {
  const wrap = $('#modal');
  const box = $('#modalBox');
  const close = () => {
    wrap.hidden = true;
    box.replaceChildren();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  box.replaceChildren(
    h('h3', { id: 'modalTitle', style: { fontSize: '1.25rem', fontWeight: 500 } }, title),
    content,
    h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
      ...actions.map((a) => h('button', { class: `btn${a.primary ? ' primary' : ''}`, onclick: () => { if (a.run?.() !== false) close(); } }, a.label)),
      h('button', { class: 'btn', onclick: close }, 'Close')),
  );
  wrap.hidden = false;
  wrap.onclick = (e) => {
    if (e.target === wrap) close();
  };
  document.addEventListener('keydown', onKey);
  return close;
}

export function download(name, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard.');
  } catch {
    toast('Copy failed. Select the text and copy it by hand.');
  }
}

export function field(label, input, hint) {
  return h('div', { class: 'field' }, h('label', {}, label), input, hint ? h('span', { class: 'dim', style: { fontSize: '0.8rem' } }, hint) : null);
}

export function numInput(value, { step = 'any', min, max, id, oninput } = {}) {
  return h('input', { type: 'number', inputmode: 'decimal', value: value ?? '', step, min, max, id, oninput });
}
