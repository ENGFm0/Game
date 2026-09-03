/* ═══════════════════════════════════════════════════════════
   Sync — optional shared backend (Firebase Realtime Database
   via its REST API). Off by default: the game is fully playable
   on one device without it; with it, every phone sees the same
   hunt and one live leaderboard.
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const clean = (u) => (u || '').trim().replace(/\/+$/, '');
  // Firebase keys may not contain . # $ [ ] /
  const keyFor = (name) => encodeURIComponent(name.trim()).replace(/\./g, '%2E');

  async function req(path, method, body) {
    const base = clean(Store.state.syncUrl);
    if (!base) throw new Error('المزامنة غير مفعّلة');
    let r;
    try {
      r = await fetch(`${base}/${path}.json`, {
        method, headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (_) { throw new Error('تعذر الوصول إلى قاعدة البيانات — تحقق من الرابط والاتصال'); }
    if (!r.ok) {
      throw new Error(r.status === 401 || r.status === 403
        ? 'قاعدة البيانات ترفض الوصول — فعّل قواعد القراءة والكتابة (وضع الاختبار)'
        : `خطأ في المزامنة (${r.status})`);
    }
    return r.json();
  }

  window.Sync = {
    get enabled() { return !!clean(Store.state.syncUrl); },
    get url() { return clean(Store.state.syncUrl); },
    keyFor,
    isValidUrl: (u) => /^https:\/\/[a-z0-9.-]+\.(firebaseio\.com|firebasedatabase\.app)\/?$/i.test(clean(u)),
    test: () => req('meta', 'PUT', { ok: true, at: Date.now() }),
    getHunt: (id) => req(`hunts/${id}`, 'GET'),
    getHuntVersion: (id) => req(`hunts/${id}/version`, 'GET'),
    putHunt: (h) => req(`hunts/${h.id}`, 'PUT', h),
    deleteHunt: (id) => req(`hunts/${id}`, 'DELETE'),
    putPlayer: (huntId, p) => req(`players/${huntId}/${keyFor(p.name)}`, 'PUT', p),
    listPlayers: async (huntId) => Object.values((await req(`players/${huntId}`, 'GET')) || {}),
    clearPlayers: (huntId) => req(`players/${huntId}`, 'DELETE'),
  };
})();
