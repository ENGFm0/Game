/* ═══════════════════════════════════════════════════════════
   Store — local persistence.
   Player state + hunt config live in localStorage; the compiled
   recognition data (large) lives in IndexedDB.
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const KEY = 'abhath.state.v1';
  const HUNT_KEY = 'abhath.hunt.v1';

  const defaults = () => ({ name: '', role: 'player', sound: true, syncUrl: '', mapboxToken: '', progress: {} });

  let state = defaults();
  try { const raw = localStorage.getItem(KEY); if (raw) state = { ...defaults(), ...JSON.parse(raw) }; } catch (_) { /* fresh */ }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) { /* private mode */ } }

  let hunt = null;
  try { const raw = localStorage.getItem(HUNT_KEY); if (raw) hunt = JSON.parse(raw); } catch (_) { /* none */ }

  /* ── tiny IndexedDB key/value ── */
  function open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('abhath', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function kv(mode, fn) {
    const d = await open();
    return new Promise((res, rej) => {
      const tx = d.transaction('kv', mode);
      const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => res(req && req.result);
      tx.onerror = () => rej(tx.error);
    });
  }
  const idb = {
    get: (k) => kv('readonly', (s) => s.get(k)).catch(() => undefined),
    set: (k, v) => kv('readwrite', (s) => s.put(v, k)).catch(() => {}),
    del: (k) => kv('readwrite', (s) => s.delete(k)).catch(() => {}),
  };

  const mindKey = (h) => `mind:${h.id}:${h.version}`;
  const progressKey = (h) => `${h.id}:${h.version}`;

  /** Per-hunt progress for the signed-in player on this device. */
  function progress(h = hunt) {
    if (!h) return { found: [], points: 0, completedAt: null };
    const k = progressKey(h);
    return state.progress[k] || (state.progress[k] = { found: [], points: 0, completedAt: null });
  }

  /** Saves a hunt. `mind` (base64 of the compiled targets) is kept in IndexedDB. */
  async function setHunt(h, mind) {
    const { mind: inline, ...plain } = h;
    try { localStorage.setItem(HUNT_KEY, JSON.stringify(plain)); }
    catch (_) { throw new Error('الصورة كبيرة جداً على ذاكرة المتصفح — جرّب صورة أصغر'); }
    hunt = plain;
    const data = mind || inline;
    if (data) await idb.set(mindKey(plain), data);
  }

  async function clearHunt() {
    if (hunt) await idb.del(mindKey(hunt));
    localStorage.removeItem(HUNT_KEY);
    hunt = null;
  }

  window.Store = {
    get state() { return state; },
    save,
    get hunt() { return hunt; },
    setHunt,
    clearHunt,
    progress,
    progressKey,
    getMind: (h) => idb.get(mindKey(h || hunt)),
    reset() { state = defaults(); save(); },
  };
})();
