/* ═══════════════════════════════════════════════════════════
   سيفين ونخله — application controller
   State lives in localStorage so progress survives reloads.
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const CFG = window.HUNT_CONFIG;
  const STORE_KEY = 'hunt.state.v1';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const ITEM_META = {
    coffee: { label: 'كوب قهوة', icon: '#i-coffee' },
    map:    { label: 'خريطة',    icon: '#i-map' },
    sword:  { label: 'سيف ذهبي', icon: '#i-sword', gold: true },
    palm:   { label: 'نخلة ذهبية', icon: '#i-palm', gold: true },
  };

  /* ───────── State ───────── */
  const defaults = () => ({
    name: CFG.player.name,
    points: CFG.player.points,
    items: [...CFG.player.items],
    collected: [],            // stage ids
    owned: [],                // store item ids
    customDrops: [],
    claimed: false,
    sound: true,
    mapboxToken: CFG.mapbox.accessToken,
    targetSrc: CFG.ar.targetSrc,
    leaderboard: CFG.leaderboard.map((r) => ({ ...r })),
  });

  let state = load();
  let position = null;   // [lat, lng]
  let geoWatch = null;

  function load() {
    try { const raw = localStorage.getItem(STORE_KEY); return raw ? { ...defaults(), ...JSON.parse(raw) } : defaults(); }
    catch (_) { return defaults(); }
  }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) { /* private mode */ } }

  /* A stage is unlocked when every previous stage has been collected. */
  function stages() {
    return CFG.challenge.stages.map((s, i, arr) => {
      const collected = state.collected.includes(s.id);
      const prevDone = i === 0 || state.collected.includes(arr[i - 1].id);
      return { ...s, status: collected ? 'collected' : prevDone ? 'unlocked' : 'locked' };
    });
  }

  /* ───────── UI helpers ───────── */
  let toastTimer;
  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.classList.add('is-on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('is-on'), 2600);
  }

  function openModal(title, bodyHtml) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = bodyHtml;
    $('#modal').hidden = false;
  }
  function closeModal() { $('#modal').hidden = true; }

  function beep(freq = 880, dur = .12) {
    if (!state.sound) return;
    try {
      const ctx = beep.ctx || (beep.ctx = new (window.AudioContext || window.webkitAudioContext)());
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = freq; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(.15, ctx.currentTime); g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + dur);
      o.start(); o.stop(ctx.currentTime + dur);
    } catch (_) { /* no audio */ }
  }

  const fmt = (n) => new Intl.NumberFormat('en-US').format(n);
  const fmtDist = (m) => m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;

  /* ───────── Renderers ───────── */
  function renderHeader() {
    $('#headerPoints').textContent = `${state.points} نقطة`;
    $('#publicUrlChip').textContent = CFG.publicUrl.replace(/^https?:\/\//, '');
    $('#tagline').textContent = `${CFG.tagline} · العب مباشرة عبر المتصفح دون الحاجة لتحميل تطبيق`;
  }

  function renderStages() {
    const list = stages();
    $('#challengeTitle').textContent = CFG.challenge.title;
    $('#stages').innerHTML = list.map((s, i) => {
      const dist = position ? HuntMap.distance(position, s.coords) : null;
      const statusLabel = { unlocked: 'مفتوح', locked: 'مقفل', collected: 'تم الجمع' }[s.status];
      const statusIcon = { unlocked: '#i-pin', locked: '#i-lock', collected: '#i-check' }[s.status];
      return `
        <li class="stage stage--${s.status}" data-stage="${s.id}">
          <div class="stage__icon"><svg><use href="#i-${s.icon}"/></svg></div>
          <div>
            <div class="stage__title">${i + 1}. ${s.title}</div>
            <div class="stage__riddle">"${s.riddle}"</div>
            <div class="stage__meta">
              <span class="status status--${s.status}"><svg><use href="${statusIcon}"/></svg> ${statusLabel}</span>
              <span class="stage__pts">+${s.points} نقطة</span>
              ${dist != null && s.status !== 'collected' ? `<span class="stage__dist">📍 ${fmtDist(dist)}</span>` : ''}
              <span class="stage__pts">${s.type === 'indoor' ? 'هدف صورة' : 'GPS'}</span>
            </div>
          </div>
          <div class="stage__minimap ${s.status === 'locked' ? 'is-blur' : ''}" title="اعرض على الخريطة"></div>
        </li>`;
    }).join('');

    $$('.stage__minimap').forEach((el) => el.addEventListener('click', () => {
      const id = el.closest('.stage').dataset.stage;
      const s = list.find((x) => x.id === id);
      if (s.status === 'locked') return toast('هذه المرحلة مقفلة — أكمل المرحلة السابقة أولاً');
      navigate('map'); HuntMap.flyTo(s.coords, 15);
    }));

    HuntMap.renderStages(list);
    $('#statDrops').textContent = list.length + state.customDrops.length;
    $('#statUnlocked').textContent = list.filter((s) => s.status !== 'locked').length;
    updateNearest(list);
    renderIndoor(list);
  }

  function updateNearest(list) {
    const el = $('#statDistance');
    if (!position) return (el.textContent = '—');
    const open = list.filter((s) => s.status === 'unlocked');
    if (!open.length) return (el.textContent = '✓');
    const d = Math.min(...open.map((s) => HuntMap.distance(position, s.coords)));
    el.textContent = fmtDist(d);
  }

  function renderIndoor(list) {
    $('#indoorGrid').innerHTML = list.filter((s) => s.type === 'indoor').map((s) => `
      <div class="marker-card">
        <div class="marker-card__img"><svg><use href="#i-image"/></svg></div>
        <b>${s.title}</b>
        <span class="status status--${s.status}">${{ unlocked: 'مفتوح', locked: 'مقفل', collected: 'تم الجمع' }[s.status]}</span>
        <button class="btn btn--outline btn--sm" data-scan="${s.id}">مسح الهدف</button>
      </div>`).join('') || '<p class="muted small">لا توجد أهداف داخلية في هذا التحدي.</p>';
    $$('[data-scan]').forEach((b) => b.addEventListener('click', () => { navigate('ar'); startAR(); }));
  }

  function renderLeaderboard() {
    const rows = [...state.leaderboard, { handle: state.name, points: state.points, items: state.items.length, me: true }]
      .sort((a, b) => b.points - a.points);
    $('#leaderboard').innerHTML = rows.map((r, i) => `
      <li class="lb__row ${r.me ? 'is-me' : ''}" data-handle="${r.handle}">
        <span class="lb__rank">${i + 1}</span>
        <span class="avatar">${r.handle.charAt(0)}</span>
        <span class="lb__name">@${r.handle}<span>${r.items} قطع تم جمعها</span></span>
        <span class="lb__pts">${r.points} <small>pts</small></span>
      </li>`).join('');
    const myRank = rows.findIndex((r) => r.me) + 1;
    $('#meRank').textContent = `#${myRank}`;
  }

  function renderPortfolio() {
    $('#meName').textContent = state.name;
    $('#meAvatar').textContent = state.name.charAt(0);
    $('#mePoints').textContent = state.points;
    $('#meItemsCount').textContent = state.items.length;
    $('#meItems').innerHTML = state.items.map((id) => {
      const m = ITEM_META[id] || { label: id, icon: '#i-pin' };
      return `<span class="item ${m.gold ? 'item--gold' : ''}"><svg><use href="${m.icon}"/></svg>${m.label}</span>`;
    }).join('');
    $('#prizeAmount').innerHTML = `${fmt(CFG.prizePool.amount)} <small>${CFG.prizePool.currency}</small>`;
    $('#claimBtn').disabled = state.claimed;
    $('#claimBtn').innerHTML = state.claimed ? '<svg><use href="#i-check"/></svg> تم الاستلام' : '<svg><use href="#i-wallet"/></svg> استلام عبر المحفظة الرقمية';
  }

  function renderStore() {
    $('#store').innerHTML = CFG.store.map((it) => {
      const owned = state.owned.includes(it.id);
      return `
        <div class="store__item ${owned ? 'is-owned' : ''}">
          <div class="store__icon"><svg><use href="#i-${it.icon}"/></svg></div>
          <div><div class="store__name">${it.name}</div><div class="store__desc">${it.desc}</div></div>
          <div class="store__price">
            <span class="price">${it.price} <small>SAR</small></span>
            <button class="btn ${owned ? 'btn--ghost' : 'btn--gold'} btn--sm" data-buy="${it.id}" ${owned ? 'disabled' : ''}>${owned ? 'مُفعّل' : 'شراء'}</button>
          </div>
        </div>`;
    }).join('');
    $$('[data-buy]').forEach((b) => b.addEventListener('click', () => buy(b.dataset.buy)));
  }

  function renderAll() { renderHeader(); renderStages(); renderLeaderboard(); renderPortfolio(); renderStore(); }

  /* ───────── Actions ───────── */
  function collect(stageId, source) {
    const s = stages().find((x) => x.id === stageId);
    if (!s || s.status !== 'unlocked') return false;

    // Outdoor drops require proximity unless the player owns the radar or is simulating.
    if (s.type === 'outdoor' && position && source !== 'ar') {
      const d = HuntMap.distance(position, s.coords);
      const radius = CFG.map.unlockRadiusMeters * (state.owned.includes('radar') ? 3 : 1);
      if (d > radius) { toast(`أنت على بُعد ${fmtDist(d)} — اقترب أكثر لفتح الدروب`); return false; }
    }

    state.collected.push(s.id);
    state.points += s.points;
    state.items.push(s.icon);
    save(); renderAll(); beep(1046, .2);
    openModal('🎉 أحسنت!', `
      <div class="reward">
        <div class="big-check"><svg><use href="#i-${s.icon}"/></svg></div>
        <p>وجدت <b style="font-size:1rem">${s.title.replace('ابحث عن ', '')}</b></p>
        <b>+${s.points}</b><p class="muted small">نقطة أُضيفت إلى محفظتك</p>
      </div>`);
    return true;
  }

  function buy(id) {
    const it = CFG.store.find((x) => x.id === id);
    if (!it || state.owned.includes(id)) return;
    openModal(`شراء ${it.name}`, `
      <p>${it.desc}</p>
      <p>السعر: <b>${it.price} SAR</b> — سيتم الخصم من محفظتك الرقمية.</p>
      <div class="modal__actions">
        <button class="btn btn--gold" id="confirmBuy">تأكيد الشراء</button>
        <button class="btn btn--ghost" id="cancelBuy">إلغاء</button>
      </div>`);
    $('#cancelBuy').onclick = closeModal;
    $('#confirmBuy').onclick = () => {
      state.owned.push(id); save(); renderStore(); closeModal(); beep(660);
      toast(`تم تفعيل ${it.name} ✨`);
      if (id === 'radar') renderStages();
    };
  }

  function claim() {
    if (state.claimed) return;
    const wallets = [
      ['STC', 'stc pay', '#4f008c'], ['UR', 'urpay', '#0a7cff'], ['AP', 'Apple Pay', '#111'], ['MD', 'مدى', '#0b3d2e'],
    ];
    openModal('استلام الجائزة عبر المحفظة الرقمية', `
      <p>إجمالي الجوائز المتاحة: <b>${fmt(CFG.prizePool.amount)} ${CFG.prizePool.currency}</b>. اختر محفظتك لاستلام حصتك.</p>
      <div class="wallet-list">${wallets.map(([k, n, c]) => `<button class="wallet" data-wallet="${n}"><i style="background:${c}">${k}</i>${n}</button>`).join('')}</div>`);
    $$('[data-wallet]').forEach((b) => b.addEventListener('click', () => {
      const share = Math.round(CFG.prizePool.amount * Math.min(1, state.points / 300));
      state.claimed = true; save(); renderPortfolio(); beep(988, .25);
      openModal('تم إرسال طلب الاستلام', `
        <div class="reward">
          <div class="big-check"><svg><use href="#i-check"/></svg></div>
          <b>${fmt(share)} SAR</b>
          <p class="muted">سيصلك المبلغ إلى ${b.dataset.wallet} خلال دقائق.</p>
        </div>`);
    }));
  }

  function shareLink() {
    const url = new URL(CFG.publicUrl);
    url.searchParams.set('ref', CFG.player.handle);
    url.searchParams.set('c', btoa(unescape(encodeURIComponent(CFG.challenge.title))).slice(0, 10));
    const text = `🗡️🌴 ${CFG.appName} — ${CFG.challenge.title}\n${CFG.tagline}\nالعب مباشرة من المتصفح: ${url}`;
    $('#shareBox').hidden = false;
    $('#shareInput').value = url.toString();
    $('#waLink').href = `https://wa.me/?text=${encodeURIComponent(text)}`;
    if (navigator.share) {
      navigator.share({ title: CFG.appName, text, url: url.toString() }).catch(() => { /* user dismissed */ });
    }
    toast('تم توليد رابط التحدي');
  }

  async function copy() {
    try { await navigator.clipboard.writeText($('#shareInput').value); toast('تم نسخ الرابط 📋'); }
    catch (_) { $('#shareInput').select(); document.execCommand('copy'); toast('تم نسخ الرابط 📋'); }
  }

  /* ───────── Geolocation ───────── */
  function startGeo() {
    if (!navigator.geolocation) return $('#arGps').innerHTML = '<svg><use href="#i-gps"/></svg> GPS n/a';
    if (geoWatch != null) return;
    geoWatch = navigator.geolocation.watchPosition((p) => {
      position = [p.coords.latitude, p.coords.longitude];
      HuntMap.setPlayer(position[0], position[1], p.coords.accuracy);
      $('#arGps').innerHTML = `<svg><use href="#i-gps"/></svg> ${position[0].toFixed(4)}, ${position[1].toFixed(4)} ±${Math.round(p.coords.accuracy)}m`;
      renderStages();
    }, (err) => {
      $('#arGps').innerHTML = '<svg><use href="#i-gps"/></svg> GPS off';
      if (err.code === err.PERMISSION_DENIED) toast('تم رفض إذن الموقع — لن تُفتح الدروب الخارجية تلقائياً');
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
  }

  /* ───────── WebAR flow ───────── */
  async function startAR() {
    const ok = await HuntAR.askPermission();
    if (!ok) return toast('تم رفض الإذن — يمكنك استخدام "محاكاة التعرف" للتجربة');
    startGeo();
    const started = await HuntAR.start();
    $('#arStart').hidden = started; $('#arStop').hidden = !started;
  }

  function onTargetFound(info) {
    // The first unlocked stage is awarded when the image target is recognised.
    const next = stages().find((s) => s.status === 'unlocked');
    if (!next) return toast('أكملت كل المراحل! 🏆');
    if (collect(next.id, 'ar') && info && info.simulated) toast('محاكاة: تم التعرف على الهدف');
  }

  /* ───────── Navigation ───────── */
  const mq = window.matchMedia('(max-width: 900px)');
  function navigate(target) {
    $$('[data-nav]').forEach((b) => b.classList.toggle('is-active', b.dataset.nav === target));
    const main = $('#main');
    const sectionFor = { home: null, ar: 'ar', map: 'map', portfolio: 'portfolio', settings: 'settings' }[target];

    $('[data-section="settings"]').hidden = target !== 'settings';

    if (mq.matches) {
      main.classList.add('is-mobile');
      $$('.col').forEach((c) => c.classList.toggle('is-shown', target === 'home' ? c.dataset.section !== 'settings' : c.dataset.section === sectionFor));
    } else {
      main.classList.remove('is-mobile');
      $$('.col').forEach((c) => c.classList.remove('is-shown'));
      const el = sectionFor && $(`[data-section="${sectionFor}"]`);
      el && el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (target === 'settings') fillSettings();
    setTimeout(() => HuntMap.invalidate(), 250);
  }

  /* ───────── Settings ───────── */
  function fillSettings() {
    $('#setName').value = state.name;
    $('#setMapbox').value = state.mapboxToken || '';
    $('#setTarget').value = state.targetSrc || '';
    $('#setSound').checked = state.sound;
  }
  function saveSettings() {
    state.name = $('#setName').value.trim() || CFG.player.name;
    state.sound = $('#setSound').checked;
    const token = $('#setMapbox').value.trim();
    if (token !== state.mapboxToken) { state.mapboxToken = token; HuntMap.useMapbox(token); }
    const target = $('#setTarget').value.trim();
    if (target && target !== state.targetSrc) { state.targetSrc = target; CFG.ar.targetSrc = target; if (HuntAR.running) HuntAR.stop(); }
    save(); renderAll(); toast('تم حفظ الإعدادات');
  }
  function resetProgress() {
    if (!confirm('سيتم مسح تقدمك ونقاطك المحفوظة محلياً. متابعة؟')) return;
    localStorage.removeItem(STORE_KEY); state = defaults(); save(); renderAll(); toast('تمت إعادة الضبط');
  }

  /* ───────── Live leaderboard simulation ─────────
     Stands in for a websocket feed: nudges other players' scores so the
     board visibly reorders. Replace with a real subscription in production. */
  function liveTick() {
    if (document.hidden) return;
    const r = state.leaderboard[Math.floor(Math.random() * state.leaderboard.length)];
    const gain = [5, 5, 10, 10, 15][Math.floor(Math.random() * 5)];
    r.points += gain; if (Math.random() < .3) r.items += 1;
    save(); renderLeaderboard();
    const row = $(`.lb__row[data-handle="${r.handle}"]`);
    if (row) { row.classList.add('is-bump'); setTimeout(() => row.classList.remove('is-bump'), 900); }
  }

  /* ───────── Boot ───────── */
  function boot() {
    HuntMap.init({
      container: 'map', config: { ...CFG, mapbox: { ...CFG.mapbox, accessToken: state.mapboxToken } },
      onDropAdd(coords) {
        const label = `دروب مخصص ${state.customDrops.length + 1}`;
        state.customDrops.push({ coords, label }); save();
        HuntMap.addCustomDrop(coords, label); $('#statDrops').textContent = CFG.challenge.stages.length + state.customDrops.length;
        toast(`أُضيف ${label}`);
      },
      onDropRemove(coords) {
        state.customDrops = state.customDrops.filter((d) => d.coords[0] !== coords[0] || d.coords[1] !== coords[1]); save();
        $('#statDrops').textContent = CFG.challenge.stages.length + state.customDrops.length;
      },
    });
    state.customDrops.forEach((d) => HuntMap.addCustomDrop(d.coords, d.label));
    HuntMap.map && HuntMap.map.on('popupopen', (e) => {
      const btn = e.popup.getElement().querySelector('[data-collect]');
      if (btn) btn.onclick = () => { if (collect(btn.dataset.collect, 'map')) HuntMap.map.closePopup(); };
    });

    CFG.ar.targetSrc = state.targetSrc || CFG.ar.targetSrc;
    HuntAR.init({
      config: CFG,
      els: { box: $('#arBox'), permission: $('#arPermission'), allow: $('#arAllow'), deny: $('#arDeny'), scene: $('#arScene'), status: $('#arStatus') },
      found: onTargetFound,
      error: (msg) => { toast(msg); $('#arStart').hidden = false; $('#arStop').hidden = true; },
    });

    $('#arStart').addEventListener('click', startAR);
    $('#arStop').addEventListener('click', () => { HuntAR.stop(); $('#arStart').hidden = false; $('#arStop').hidden = true; });
    $('#arSimulate').addEventListener('click', () => HuntAR.simulate());
    $('#shareBtn').addEventListener('click', shareLink);
    $('#copyBtn').addEventListener('click', copy);
    $('#claimBtn').addEventListener('click', claim);
    $('#modalClose').addEventListener('click', closeModal);
    $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
    $('#setSave').addEventListener('click', saveSettings);
    $('#setReset').addEventListener('click', resetProgress);
    $$('[data-nav]').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.nav)));
    $$('.seg__btn').forEach((b) => b.addEventListener('click', () => {
      $$('.seg__btn').forEach((x) => x.classList.toggle('is-active', x === b));
      const indoor = b.dataset.mode === 'indoor';
      $('#indoorPanel').hidden = !indoor; HuntMap.setMode(b.dataset.mode);
    }));
    mq.addEventListener('change', () => navigate($('.nav__btn.is-active').dataset.nav));

    renderAll();
    navigate('home');
    setInterval(liveTick, 7000);
  }

  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot();
})();
