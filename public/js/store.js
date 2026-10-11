// Session storage in IndexedDB. Everything stays in this browser; sharing is
// done by exporting and importing a session JSON file.

const DB = 'trajectory';
const STORE = 'sessions';
const CURRENT = 'trajectory.currentSession';

export const DEFAULT_SETTINGS = {
  setpointUnit: 'RPM',
  launchHeight: 0.5,
  goalHeight: 2.0,
  goalDistance: 3.0,
  ballDiameter: 0.072,
  degree: 1,
  distMin: 1.5,
  distMax: 5,
  distStep: 0.25,
  exportUnit: 'm',
  requireDescending: false,
};

export function newSession(name) {
  const now = new Date();
  return {
    id: `s${now.getTime().toString(36)}`,
    name: name || `Session ${now.toLocaleDateString()}`,
    created: now.toISOString(),
    settings: { ...DEFAULT_SETTINGS },
    shots: [],
  };
}

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

function safeLocal(fn, fallback = null) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export async function saveSession(session) {
  try {
    await tx('readwrite', (s) => s.put(session));
    safeLocal(() => localStorage.setItem(CURRENT, session.id));
    return true;
  } catch {
    return false;
  }
}

export async function listSessions() {
  try {
    const all = await tx('readonly', (s) => s.getAll());
    return (all || []).sort((a, b) => (b.created || '').localeCompare(a.created || ''));
  } catch {
    return [];
  }
}

export async function deleteSession(id) {
  try {
    await tx('readwrite', (s) => s.delete(id));
  } catch {
    // Nothing to clean up when storage is unavailable.
  }
}

export async function loadCurrentSession() {
  const id = safeLocal(() => localStorage.getItem(CURRENT));
  const all = await listSessions();
  const found = all.find((s) => s.id === id) || all[0];
  if (found) {
    found.settings = { ...DEFAULT_SETTINGS, ...found.settings };
    return found;
  }
  return newSession();
}

export function setCurrentId(id) {
  safeLocal(() => localStorage.setItem(CURRENT, id));
}

export function getPref(key, fallback) {
  return safeLocal(() => {
    const v = localStorage.getItem(`trajectory.${key}`);
    return v == null ? fallback : JSON.parse(v);
  }, fallback);
}

export function setPref(key, value) {
  safeLocal(() => localStorage.setItem(`trajectory.${key}`, JSON.stringify(value)));
}
