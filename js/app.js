/* ═══════════════════════════════════════════════════════════
   ابحث عني — application controller
   Screens: login · home · camera · map · admin · settings
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const CFG = window.APP_CONFIG, S = window.Store;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  let position = null, accuracy = 0, geoWatch = null;
  let players = [], pollTimer = null, versionTimer = null, boardImg = null;
  let screen = 'login';

  /* ───────── UI helpers ───────── */
  let toastTimer;
  function toast(msg, ms = 2800) {
    const el = $('#toast'); el.textContent = msg; el.classList.add('is-on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('is-on'), ms);
  }
  function openModal(title, html) { $('#modalTitle').textContent = title; $('#modalBody').innerHTML = html; $('#modal').hidden = false; }
  function closeModal() { $('#modal').hidden = true; }
  function beep(freq = 880, dur = .14) {
    if (!S.state.sound) return;
    try {
      const ctx = beep.ctx || (beep.ctx = new (window.AudioContext || window.webkitAudioContext)());
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = freq; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(.15, ctx.currentTime); g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + dur);
      o.start(); o.stop(ctx.currentTime + dur);
    } catch (_) { /* no audio */ }
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDist = (m) => m < 1000 ? `${Math.round(m)} م` : `${(m / 1000).toFixed(1)} كم`;
  const isAdmin = () => S.state.role === 'admin';
  const foundSet = () => new Set(S.progress().found);
  const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);

  /* ───────── Screens & navigation ───────── */
  function show(next) {
    if (screen === 'camera' && next !== 'camera') stopCamera();
    screen = next;
    $$('[data-screen]').forEach((el) => { el.hidden = el.dataset.screen !== next; });
    $$('[data-nav]').forEach((b) => b.classList.toggle('is-active', b.dataset.nav === next));
    const signedIn = !!S.state.name;
    $('.nav').hidden = !signedIn; $('.tabbar').hidden = !signedIn;
    document.body.classList.toggle('is-login', !signedIn);
    if (next === 'map' || next === 'camera') startGeo();
    if (next === 'map') setTimeout(() => { HuntMap.invalidate(); renderMap(); }, 200);
    if (next === 'settings') fillSettings();
    if (next === 'admin') renderAdmin();
    window.scrollTo({ top: 0 });
  }

  /* ───────── Login ───────── */
  function roleFor(name) {
    const n = name.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/\s+/g, '');
    return CFG.adminNames.some((a) => a.toLowerCase().replace(/[أإآ]/g, 'ا') === n) ? 'admin' : 'player';
  }
  function login() {
    const name = $('#loginName').value.trim().replace(/\s+/g, ' ');
    if (name.length < 2) return toast('اكتب اسمك (حرفان على الأقل)');
    S.state.name = name; S.state.role = roleFor(name); S.save();
    renderAll();
    if (isAdmin()) { toast('أهلاً فهد — أنت مسؤول اللعبة 👑'); show(S.hunt ? 'home' : 'admin'); }
    else { toast(`أهلاً ${name} 👋`); show('home'); }
    pushPlayer();
  }
  function logout() {
    stopCamera(); stopPolling();
    S.state.name = ''; S.state.role = 'player'; S.save();
    $('#loginName').value = '';
    show('login');
  }

  /* ───────── Header ───────── */
  function renderHeader() {
    const h = S.hunt, prog = S.progress();
    $('#hdrName').textContent = S.state.name || '';
    $('#hdrRole').hidden = !isAdmin();
    $('#hdrPoints').textContent = `${prog.points} نقطة`;
    $('#hdrPoints').hidden = !h;
    $('#hdrSync').hidden = !Sync.enabled;
    $$('.only-admin').forEach((el) => { el.hidden = !isAdmin(); });
  }

  /* ───────── Home ───────── */
  async function renderHome() {
    const h = S.hunt, prog = S.progress();
    $('#homeEmpty').hidden = !!h;
    $('#homeHunt').hidden = !h;
    $('#emptyAdmin').hidden = !isAdmin();
    $('#emptyPlayer').hidden = isAdmin();
    if (!h) { renderLeaderboard(); return; }

    $('#huntTitle').textContent = h.title || CFG.appName;
    $('#huntMeta').textContent = `${h.pieces.length} قطع · ${h.pointsPerPiece} نقاط للقطعة · مكافأة الإكمال ${h.completionBonus} · بواسطة ${h.createdBy}`;
    $('#statFound').textContent = prog.found.length;
    $('#statTotal').textContent = h.pieces.length;
    $('#statPoints').textContent = prog.points;
    const done = prog.found.length === h.pieces.length;
    $('#homeDone').hidden = !done;

    if (!boardImg || boardImg.src !== h.image) boardImg = await Puzzle.load(h.image);
    Puzzle.drawBoard($('#board'), boardImg, h.rows, h.cols, foundSet());

    const fs = foundSet();
    $('#pieces').innerHTML = h.pieces.map((p) => {
      const found = fs.has(p.index);
      const dist = p.mode === 'city' && position && p.lat != null ? HuntMap.distance(position, [p.lat, p.lng]) : null;
      return `
        <li class="piece ${found ? 'is-found' : ''}">
          <div class="piece__thumb">${found ? `<img src="${pieceThumb(p)}" alt="">` : '<span>?</span>'}</div>
          <div class="piece__body">
            <div class="piece__head"><b>قطعة ${p.label}</b>
              <span class="tag tag--${p.mode}">${p.mode === 'city' ? '🏙️ مدينة' : '🏠 بيت'}</span>
              ${found ? '<span class="tag tag--ok">✅ وجدتها</span>' : ''}
            </div>
            ${p.hint ? `<div class="piece__hint">💡 ${esc(p.hint)}</div>` : ''}
            ${dist != null && !found ? `<div class="piece__dist">📍 تبعد عنك ${fmtDist(dist)}</div>` : ''}
          </div>
        </li>`;
    }).join('');
    renderLeaderboard();
  }

  /* piece thumbnails are cut from the stored photo on demand and cached */
  const thumbCache = {};
  function pieceThumb(p) {
    const h = S.hunt, key = `${S.progressKey(h)}:${p.index}`;
    if (thumbCache[key]) return thumbCache[key];
    if (!boardImg) return '';
    const W = boardImg.naturalWidth, H = boardImg.naturalHeight;
    const x0 = Math.round(p.c * W / h.cols), x1 = Math.round((p.c + 1) * W / h.cols);
    const y0 = Math.round(p.r * H / h.rows), y1 = Math.round((p.r + 1) * H / h.rows);
    const cv = document.createElement('canvas'); const s = Math.min(1, 240 / Math.max(x1 - x0, y1 - y0));
    cv.width = Math.round((x1 - x0) * s); cv.height = Math.round((y1 - y0) * s);
    cv.getContext('2d').drawImage(boardImg, x0, y0, x1 - x0, y1 - y0, 0, 0, cv.width, cv.height);
    return (thumbCache[key] = cv.toDataURL('image/jpeg', .8));
  }

  function renderLeaderboard() {
    const h = S.hunt, prog = S.progress();
    const me = { name: S.state.name, points: prog.points, found: prog.found.length, me: true, updatedAt: Date.now() };
    const others = Sync.enabled ? players.filter((p) => p.name !== me.name) : [];
    const rows = [me, ...others].sort((a, b) => b.points - a.points || (a.completedAt || Infinity) - (b.completedAt || Infinity));
    $('#leaderboard').innerHTML = rows.map((r, i) => `
      <li class="lb__row ${r.me ? 'is-me' : ''}">
        <span class="lb__rank">${i + 1}</span>
        <span class="avatar">${esc(r.name.charAt(0))}</span>
        <span class="lb__name">${esc(r.name)}${r.me ? ' <small>(أنت)</small>' : ''}<span>${r.found} من ${h ? h.pieces.length : 0} قطع</span></span>
        <span class="lb__pts">${r.points} <small>نقطة</small></span>
      </li>`).join('');
    $('#statRank').textContent = `#${rows.findIndex((r) => r.me) + 1}`;
    $('#lbNote').textContent = Sync.enabled
      ? (others.length ? 'يتحدث تلقائياً كل بضع ثوانٍ' : 'لم ينضم لاعبون آخرون بعد — شارك رابط التحدي')
      : 'لعرض نتائج بقية اللاعبين فعّل المزامنة من الإعدادات';
  }

  function renderAll() { renderHeader(); renderHome(); if (screen === 'map') renderMap(); }

  /* ───────── Collecting pieces ───────── */
  function collect(index, source) {
    const h = S.hunt; if (!h) return false;
    const p = h.pieces[index]; if (!p) return false;
    const prog = S.progress();
    if (prog.found.includes(index)) { toast(`قطعة ${p.label} وجدتها من قبل ✅`); return false; }

    if (p.mode === 'city' && h.strictGps && p.lat != null) {
      if (!position) { toast('نحتاج موقعك للتأكد أنك عند القطعة — فعّل تحديد الموقع', 4000); startGeo(); return false; }
      const d = HuntMap.distance(position, [p.lat, p.lng]);
      if (d > (p.radius || CFG.defaults.radiusMeters) + Math.min(accuracy, 30)) {
        toast(`أنت على بُعد ${fmtDist(d)} من منطقة القطعة ${p.label} — اقترب أكثر`, 4000); return false;
      }
    }

    prog.found.push(index);
    prog.points += h.pointsPerPiece;
    let bonus = 0;
    const complete = prog.found.length === h.pieces.length;
    if (complete) { bonus = h.completionBonus; prog.points += bonus; prog.completedAt = Date.now(); }
    S.save(); beep(complete ? 1318 : 1046, complete ? .35 : .2);
    renderAll(); pushPlayer();

    openModal(complete ? '🏆 جمعت كل القطع!' : '🎉 وجدت قطعة!', `
      <div class="reward">
        <img class="reward__img" src="${pieceThumb(p)}" alt="">
        <p>قطعة <b>${p.label}</b>${source === 'camera' ? ' — تم التعرف عليها بالكاميرا' : ''}</p>
        <b>+${h.pointsPerPiece}${bonus ? ` +${bonus} مكافأة` : ''}</b>
        <p class="muted small">${complete ? 'اكتملت الصورة! شاهدها في الرئيسية' : `بقي ${h.pieces.length - prog.found.length} قطع`}</p>
      </div>`);
    return true;
  }

  /* ───────── Sync: players & hunt updates ───────── */
  async function pushPlayer() {
    if (!Sync.enabled || !S.hunt || !S.state.name) return;
    const prog = S.progress();
    try {
      await Sync.putPlayer(S.hunt.id, { name: S.state.name, points: prog.points, found: prog.found.length, foundList: prog.found, completedAt: prog.completedAt, updatedAt: Date.now() });
    } catch (e) { if (!pushPlayer.warned) { pushPlayer.warned = true; toast(e.message, 4000); } }
  }
  async function pullPlayers() {
    if (!Sync.enabled || !S.hunt || document.hidden) return;
    try { players = await Sync.listPlayers(S.hunt.id); renderLeaderboard(); } catch (_) { /* transient */ }
  }
  async function checkHuntVersion() {
    if (!Sync.enabled || !S.hunt || document.hidden || isAdmin()) return;
    try {
      const v = await Sync.getHuntVersion(S.hunt.id);
      if (v == null) return;
      if (v > S.hunt.version) { await loadRemoteHunt(S.hunt.id, true); }
    } catch (_) { /* transient */ }
  }
  function startPolling() {
    stopPolling();
    if (!Sync.enabled) return;
    pullPlayers(); pollTimer = setInterval(pullPlayers, 6000);
    versionTimer = setInterval(checkHuntVersion, 30000);
  }
  function stopPolling() { clearInterval(pollTimer); clearInterval(versionTimer); pollTimer = versionTimer = null; }

  async function loadRemoteHunt(id, silent) {
    if (!Sync.enabled) return false;
    if (!silent) toast('جارٍ تحميل التحدي…');
    try {
      const data = await Sync.getHunt(id);
      if (!data) { toast('لم يتم العثور على هذا التحدي'); return false; }
      await S.setHunt(data);
      thumbCache && Object.keys(thumbCache).forEach((k) => delete thumbCache[k]);
      renderAll(); startPolling();
      toast(silent ? 'تم تحديث التحدي إلى أحدث نسخة' : `تم تحميل التحدي: ${data.title}`);
      return true;
    } catch (e) { toast(e.message, 4000); return false; }
  }

  /* ───────── Geolocation ───────── */
  function startGeo() {
    if (!navigator.geolocation || geoWatch != null) return;
    geoWatch = navigator.geolocation.watchPosition((p) => {
      position = [p.coords.latitude, p.coords.longitude]; accuracy = p.coords.accuracy || 0;
      HuntMap.setPlayer(position[0], position[1], accuracy);
      $('#camGps').textContent = `GPS ±${Math.round(accuracy)}م`;
      if (screen === 'home') renderHome();
      if (screen === 'map') renderNearest();
    }, (err) => {
      $('#camGps').textContent = 'GPS متوقف';
      if (err.code === err.PERMISSION_DENIED) toast('تم رفض إذن الموقع — قطع المدينة تحتاج تحديد الموقع', 4000);
    }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
  }

  /* ───────── Camera ───────── */
  async function startCamera() {
    const h = S.hunt;
    if (!h) return toast('لا يوجد تحدي بعد');
    $('#camStart').disabled = true;
    try {
      let mind = await S.getMind(h);
      if (!mind) {
        // Compile on this device (hunts shared without recognition data).
        setCamStatus('تجهيز القطع على جهازك لأول مرة… قد يستغرق دقيقة');
        const img = await Puzzle.load(h.image);
        const pieces = Puzzle.slice(img, h.rows, h.cols);
        const buf = await HuntAR.compile(pieces.map((p) => p.dataURL), (pct) => setCamStatus(`تجهيز القطع… ${Math.round(pct)}%`));
        mind = await HuntAR.toBase64(buf);
        await S.setHunt(h, mind);
      }
      const buffer = await HuntAR.fromBase64(mind);
      await HuntAR.start({
        video: $('#camVideo'), buffer,
        onStatus: setCamStatus,
        onFound: (i) => onPieceSeen(i),
        onLost: () => { $('#camFound').hidden = true; setCamStatus('وجّه الكاميرا نحو إحدى القطع'); },
      });
      $('#camStage').classList.add('is-live');
      $('#camStart').hidden = true; $('#camStop').hidden = false;
    } catch (e) {
      setCamStatus('لم تعمل الكاميرا');
      toast(e.message || 'تعذر تشغيل الكاميرا', 4500);
    } finally { $('#camStart').disabled = false; }
  }
  function stopCamera() {
    HuntAR.stop();
    $('#camStage').classList.remove('is-live', 'is-found');
    $('#camFound').hidden = true;
    $('#camStart').hidden = false; $('#camStop').hidden = true;
    setCamStatus('الكاميرا متوقفة');
  }
  function setCamStatus(t) { $('#camStatus').textContent = t; }

  function onPieceSeen(i) {
    const h = S.hunt, p = h.pieces[i];
    if (!p) return;
    $('#camStage').classList.add('is-found');
    setTimeout(() => $('#camStage').classList.remove('is-found'), 900);
    if (S.progress().found.includes(i)) {
      $('#camFoundText').textContent = `قطعة ${p.label} — وجدتها من قبل ✅`;
      $('#camFound').hidden = false;
      return;
    }
    $('#camFoundText').textContent = `تم التعرف على قطعة ${p.label}!`;
    $('#camFound').hidden = false;
    collect(i, 'camera');
  }

  /* ───────── Map ───────── */
  function cityPieces() { return S.hunt ? S.hunt.pieces.filter((p) => p.mode === 'city') : []; }
  function renderMap() {
    const cps = cityPieces();
    HuntMap.renderPieces(cps, foundSet(), isAdmin() && $('#pickBar').hidden === false);
    $('#mapEmpty').hidden = cps.length > 0;
    if (!renderMap.fitted && cps.some((p) => p.lat != null)) { HuntMap.fitPieces(cps); renderMap.fitted = true; }
    renderNearest();
  }
  function renderNearest() {
    const el = $('#mapNearest');
    const open = cityPieces().filter((p) => p.lat != null && !foundSet().has(p.index));
    if (!open.length) return (el.textContent = cityPieces().length ? 'وجدت كل قطع المدينة 🏆' : '');
    if (!position) return (el.textContent = 'بانتظار تحديد موقعك…');
    const best = open.map((p) => ({ p, d: HuntMap.distance(position, [p.lat, p.lng]) })).sort((a, b) => a.d - b.d)[0];
    el.textContent = `أقرب قطعة: ${best.p.label} — ${fmtDist(best.d)}`;
  }

  /* ───────── Admin builder ───────── */
  const B = { img: null, dataURL: '', rows: CFG.defaults.rows, cols: CFG.defaults.cols, pieces: [], selected: -1, editingId: null, version: 0 };

  function renderAdmin() {
    if (!isAdmin()) return;
    const h = S.hunt;
    $('#bExisting').hidden = !h;
    if (h && !B.dataURL && !B.loadedFrom) loadBuilderFrom(h);
    $('#bRows').value = B.rows; $('#bCols').value = B.cols;
    if (!$('#bTitle').value) $('#bTitle').value = (h && h.title) || CFG.appName;
    if (!$('#bPoints').value) $('#bPoints').value = (h && h.pointsPerPiece) || CFG.defaults.pointsPerPiece;
    if (!$('#bBonus').value) $('#bBonus').value = (h && h.completionBonus) || CFG.defaults.completionBonus;
    renderBuilder();
    renderAdminPlayers();
  }

  async function loadBuilderFrom(h) {
    B.loadedFrom = h.id;
    B.dataURL = h.image; B.img = await Puzzle.load(h.image);
    B.rows = h.rows; B.cols = h.cols; B.editingId = h.id; B.version = h.version;
    B.pieces = h.pieces.map((p) => ({ ...p }));
    $('#bTitle').value = h.title; $('#bPoints').value = h.pointsPerPiece; $('#bBonus').value = h.completionBonus; $('#bStrict').checked = !!h.strictGps;
    $('#bRows').value = B.rows; $('#bCols').value = B.cols;
    renderBuilder();
  }

  function rebuildPieces() {
    const prev = B.pieces;
    B.pieces = [];
    for (let r = 0; r < B.rows; r++) for (let c = 0; c < B.cols; c++) {
      const old = prev.find((p) => p.r === r && p.c === c) || {};
      B.pieces.push({ index: B.pieces.length, r, c, label: Puzzle.label(r, c), mode: old.mode || 'home', hint: old.hint || '', lat: old.lat ?? null, lng: old.lng ?? null, radius: old.radius || CFG.defaults.radiusMeters });
    }
  }

  function renderBuilder() {
    const has = !!B.img;
    $('#bStep2').hidden = !has; $('#bStep3').hidden = !has; $('#bStep4').hidden = !has; $('#bBuild').hidden = !has;
    $('#bDrop').classList.toggle('has-image', has);
    if (!has) return;
    if (B.pieces.length !== B.rows * B.cols) rebuildPieces();
    Puzzle.drawBoard($('#bPreview'), B.img, B.rows, B.cols, null, { grid: true, selected: B.selected, maxWidth: 700 });
    $('#bCount').textContent = `${B.rows * B.cols} قطع`;

    const thumbs = Puzzle.slice(B.img, B.rows, B.cols);
    $('#bPieces').innerHTML = B.pieces.map((p) => `
      <li class="bpiece ${B.selected === p.index ? 'is-selected' : ''} ${p.mode === 'city' && p.lat == null ? 'needs-pin' : ''}" data-i="${p.index}">
        <img class="bpiece__thumb" src="${thumbs[p.index].dataURL}" alt="قطعة ${p.label}">
        <div class="bpiece__body">
          <div class="bpiece__head">
            <b>قطعة ${p.label}</b>
            <span class="seg seg--sm">
              <button type="button" data-mode="home" class="${p.mode === 'home' ? 'is-active' : ''}">🏠 في البيت</button>
              <button type="button" data-mode="city" class="${p.mode === 'city' ? 'is-active' : ''}">🏙️ في المدينة</button>
            </span>
          </div>
          <input class="bpiece__hint" data-hint placeholder="تلميح للاعبين (اختياري): مثلاً تحت الطاولة…" value="${esc(p.hint)}">
          <div class="bpiece__city" ${p.mode === 'city' ? '' : 'hidden'}>
            <button type="button" class="btn btn--outline btn--sm" data-pick>📍 حدد الموقع على الخريطة</button>
            <span class="bpiece__coords">${p.lat != null ? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : 'لم يُحدد الموقع بعد'}</span>
            <label class="bpiece__radius">نطاق البحث <input type="number" data-radius min="10" max="2000" step="10" value="${p.radius}"> م</label>
          </div>
        </div>
      </li>`).join('');

    $$('#bPieces .bpiece').forEach((li) => {
      const i = +li.dataset.i, p = B.pieces[i];
      $$('[data-mode]', li).forEach((b) => b.addEventListener('click', () => { p.mode = b.dataset.mode; renderBuilder(); }));
      $('[data-hint]', li).addEventListener('input', (e) => { p.hint = e.target.value; });
      $('[data-radius]', li).addEventListener('change', (e) => { p.radius = Math.max(10, +e.target.value || CFG.defaults.radiusMeters); });
      $('[data-pick]', li).addEventListener('click', () => beginPick(i));
      li.addEventListener('click', (e) => { if (e.target === li || e.target.classList.contains('bpiece__thumb')) { B.selected = i; renderBuilder(); } });
    });
  }

  async function onImagePicked(file) {
    if (!file) return;
    try {
      toast('جارٍ تجهيز الصورة…');
      const { img, dataURL } = await Puzzle.fileToImage(file, CFG.imageMaxSide);
      B.img = img; B.dataURL = dataURL; B.pieces = []; B.selected = -1;
      renderBuilder();
      toast('تم تحميل الصورة — اختر طريقة التقسيم');
    } catch (e) { toast(e.message); }
  }

  /* pick a city piece location on the map */
  function beginPick(i) {
    B.selected = i;
    show('map');
    $('#pickBar').hidden = false;
    const sel = $('#pickPiece');
    sel.innerHTML = B.pieces.filter((p) => p.mode === 'city').map((p) => `<option value="${p.index}" ${p.index === i ? 'selected' : ''}>قطعة ${p.label}${p.lat != null ? ' ✓' : ''}</option>`).join('');
    HuntMap.setPickMode(true);
    HuntMap.renderPieces(B.pieces.filter((p) => p.mode === 'city'), new Set(), true);
    HuntMap.fitPieces(B.pieces.filter((p) => p.mode === 'city'));
    if (position && !B.pieces.some((p) => p.lat != null)) HuntMap.flyTo(position, 16);
    toast(`اضغط على الخريطة لتحديد مكان القطعة ${B.pieces[i].label}`, 3500);
  }
  function onPick(coords) {
    const i = +$('#pickPiece').value; const p = B.pieces[i]; if (!p) return;
    p.lat = coords[0]; p.lng = coords[1];
    HuntMap.renderPieces(B.pieces.filter((x) => x.mode === 'city'), new Set(), true);
    toast(`تم تحديد موقع القطعة ${p.label} ✓`);
    // advance to the next city piece without a location
    const next = B.pieces.find((x) => x.mode === 'city' && x.lat == null);
    const sel = $('#pickPiece');
    sel.innerHTML = B.pieces.filter((x) => x.mode === 'city').map((x) => `<option value="${x.index}" ${(next ? x.index === next.index : x.index === i) ? 'selected' : ''}>قطعة ${x.label}${x.lat != null ? ' ✓' : ''}</option>`).join('');
  }
  function onMove(i, coords) { const p = B.pieces[i]; if (p) { p.lat = coords[0]; p.lng = coords[1]; } }
  function endPick() {
    $('#pickBar').hidden = true; HuntMap.setPickMode(false);
    show('admin'); renderBuilder();
    setTimeout(() => { const el = $(`#bPieces .bpiece[data-i="${B.selected}"]`); el && el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 100);
  }

  /* compile + save */
  async function buildHunt() {
    if (!B.img) return toast('اختر صورة أولاً');
    const missing = B.pieces.filter((p) => p.mode === 'city' && p.lat == null);
    if (missing.length) return toast(`حدد موقع قطع المدينة على الخريطة أولاً: ${missing.map((p) => p.label).join('، ')}`, 4500);

    const btn = $('#bBuild'); btn.disabled = true;
    const prog = $('#bProgress'), txt = $('#bProgressText'); prog.hidden = false; prog.value = 0; txt.textContent = 'تقطيع الصورة…';
    try {
      const pieces = Puzzle.slice(B.img, B.rows, B.cols);
      txt.textContent = 'تجهيز القطع للتعرف بالكاميرا… (قد يستغرق دقيقة)';
      const buf = await HuntAR.compile(pieces.map((p) => p.dataURL), (pct) => { prog.value = pct; txt.textContent = `تجهيز القطع للتعرف بالكاميرا… ${Math.round(pct)}%`; });
      const mind = await HuntAR.toBase64(buf);

      const hunt = {
        id: B.editingId || 'h_' + uid(),
        version: (B.version || 0) + 1,
        title: $('#bTitle').value.trim() || CFG.appName,
        createdBy: S.state.name, createdAt: Date.now(),
        image: B.dataURL, rows: B.rows, cols: B.cols,
        pointsPerPiece: Math.max(1, +$('#bPoints').value || CFG.defaults.pointsPerPiece),
        completionBonus: Math.max(0, +$('#bBonus').value || 0),
        strictGps: $('#bStrict').checked,
        pieces: B.pieces.map((p) => ({ index: p.index, r: p.r, c: p.c, label: p.label, mode: p.mode, hint: p.hint || '', lat: p.mode === 'city' ? p.lat : null, lng: p.mode === 'city' ? p.lng : null, radius: p.radius })),
      };
      txt.textContent = 'حفظ التحدي…';
      await S.setHunt(hunt, mind);
      B.editingId = hunt.id; B.version = hunt.version; B.loadedFrom = hunt.id;
      boardImg = null; Object.keys(thumbCache).forEach((k) => delete thumbCache[k]);
      renderMap.fitted = false;

      if (Sync.enabled) {
        txt.textContent = 'رفع التحدي إلى قاعدة البيانات…';
        try { await Sync.putHunt({ ...hunt, mind }); await Sync.clearPlayers(hunt.id); players = []; }
        catch (e) { toast('حُفظ محلياً لكن تعذر الرفع: ' + e.message, 5000); }
      }
      prog.hidden = true; txt.textContent = '';
      renderAll(); renderAdmin(); startPolling();
      beep(1046, .2);
      openModal('✅ التحدي جاهز', `
        <p>تم تجهيز <b>${hunt.pieces.length}</b> قطع. الخطوة التالية: اطبع القطع وخبّئها، ثم شارك التحدي مع اللاعبين.</p>
        <div class="modal__actions">
          <button class="btn btn--gold" id="mPrint">🖨️ طباعة القطع</button>
          <button class="btn btn--green" id="mShare">🔗 مشاركة التحدي</button>
        </div>`);
      $('#mPrint').onclick = () => { closeModal(); printPieces(); };
      $('#mShare').onclick = () => { closeModal(); shareHunt(); };
    } catch (e) {
      prog.hidden = true; txt.textContent = '';
      toast('تعذر تجهيز التحدي: ' + (e.message || e), 5000);
    } finally { btn.disabled = false; }
  }

  async function printPieces() {
    const h = S.hunt; if (!h) return;
    const img = await Puzzle.load(h.image);
    const pieces = Puzzle.slice(img, h.rows, h.cols);
    $('#printSheet').innerHTML = `
      <div class="print__head"><b>${esc(h.title)}</b> · ${CFG.appName} · ${h.pieces.length} قطع — اقطع على الخطوط وخبّئ كل قطعة</div>
      <div class="print__grid">${pieces.map((p) => {
        const meta = h.pieces[p.index];
        return `<figure class="print__piece"><img src="${p.dataURL}" alt=""><figcaption>قطعة ${p.label} · ${meta.mode === 'city' ? 'مدينة' : 'بيت'}${meta.hint ? ` · ${esc(meta.hint)}` : ''}</figcaption></figure>`;
      }).join('')}</div>`;
    setTimeout(() => window.print(), 150);
  }

  function shareHunt() {
    const h = S.hunt; if (!h) return;
    if (Sync.enabled) {
      const url = new URL(location.href.split('?')[0].split('#')[0]);
      url.searchParams.set('db', Sync.url); url.searchParams.set('hunt', h.id);
      const text = `🧩 ${CFG.appName} — ${h.title}\nسجّل باسمك وابدأ البحث عن القطع:\n${url}`;
      openModal('مشاركة التحدي', `
        <p>أرسل هذا الرابط للاعبين — يفتح مباشرة في المتصفح ويحمّل التحدي.</p>
        <div class="share"><input class="share__input" id="shareInput" readonly dir="ltr" value="${esc(url.toString())}"><button class="btn btn--ghost btn--icon" id="copyBtn" title="نسخ"><svg><use href="#i-copy"/></svg></button></div>
        <div class="modal__actions">
          <a class="btn btn--whatsapp" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text)}"><svg><use href="#i-whatsapp"/></svg> إرسال عبر واتساب</a>
          ${navigator.share ? '<button class="btn btn--ghost" id="nativeShare">مشاركة…</button>' : ''}
        </div>`);
      $('#copyBtn').onclick = async () => { try { await navigator.clipboard.writeText(url.toString()); toast('تم نسخ الرابط 📋'); } catch (_) { $('#shareInput').select(); document.execCommand('copy'); toast('تم نسخ الرابط 📋'); } };
      const ns = $('#nativeShare'); if (ns) ns.onclick = () => navigator.share({ title: CFG.appName, text, url: url.toString() }).catch(() => {});
    } else {
      openModal('مشاركة التحدي', `
        <p>المزامنة غير مفعّلة، لذلك يُشارك التحدي كملف: نزّله وأرسله للاعبين (واتساب/تيليجرام) وهم يستوردونه من <b>الإعدادات ← استيراد تحدي</b>.</p>
        <p class="muted small">لرابط مباشر ولوحة نتائج مشتركة بين الجميع، فعّل المزامنة من الإعدادات.</p>
        <div class="modal__actions"><button class="btn btn--gold" id="mExport">⬇️ تنزيل ملف التحدي</button></div>`);
      $('#mExport').onclick = () => { closeModal(); exportHunt(); };
    }
  }

  async function exportHunt() {
    const h = S.hunt; if (!h) return;
    const mind = await S.getMind(h);
    const blob = new Blob([JSON.stringify({ app: 'abhath-anni', exportedAt: Date.now(), hunt: { ...h, mind } })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `ابحث-عني-${h.title}.json`.replace(/[\\/:*?"<>|]/g, '-');
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('تم تنزيل ملف التحدي');
  }
  async function importHunt(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const h = data.hunt || data;
      if (!h || !h.pieces || !h.image) throw new Error('الملف ليس ملف تحدي صالح');
      await S.setHunt(h);
      boardImg = null; Object.keys(thumbCache).forEach((k) => delete thumbCache[k]); renderMap.fitted = false;
      renderAll(); toast(`تم استيراد التحدي: ${h.title}`); show('home');
    } catch (e) { toast(e.message || 'تعذر استيراد الملف', 4000); }
  }

  async function deleteHunt() {
    const h = S.hunt; if (!h) return;
    if (!confirm('سيتم حذف التحدي الحالي ونتائجه. متابعة؟')) return;
    if (Sync.enabled) { try { await Sync.deleteHunt(h.id); await Sync.clearPlayers(h.id); } catch (e) { toast(e.message); } }
    await S.clearHunt();
    delete S.state.progress[S.progressKey(h)]; S.save();
    B.img = null; B.dataURL = ''; B.pieces = []; B.editingId = null; B.version = 0; B.loadedFrom = null; players = [];
    $('#bImage').value = '';
    renderAll(); renderAdmin(); toast('تم حذف التحدي');
  }
  async function resetPlayers() {
    const h = S.hunt; if (!h) return;
    if (!confirm('سيتم تصفير نتائج كل اللاعبين لهذا التحدي. متابعة؟')) return;
    delete S.state.progress[S.progressKey(h)]; S.save();
    if (Sync.enabled) { try { await Sync.clearPlayers(h.id); } catch (e) { toast(e.message); } }
    players = []; renderAll(); renderAdminPlayers(); toast('تم تصفير النتائج');
  }
  function renderAdminPlayers() {
    const el = $('#adminPlayers'); if (!el) return;
    if (!Sync.enabled) { el.innerHTML = '<p class="muted small">فعّل المزامنة من الإعدادات لمتابعة كل اللاعبين من هنا.</p>'; return; }
    const rows = [...players].sort((a, b) => b.points - a.points);
    el.innerHTML = rows.length ? `<ol class="lb">${rows.map((r, i) => `<li class="lb__row"><span class="lb__rank">${i + 1}</span><span class="avatar">${esc(r.name.charAt(0))}</span><span class="lb__name">${esc(r.name)}<span>${r.found} قطع · آخر نشاط ${new Date(r.updatedAt).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}</span></span><span class="lb__pts">${r.points}</span></li>`).join('')}</ol>`
      : '<p class="muted small">لم ينضم أحد بعد.</p>';
  }

  /* ───────── Settings ───────── */
  function fillSettings() {
    $('#setSync').value = S.state.syncUrl || '';
    $('#setMapbox').value = S.state.mapboxToken || '';
    $('#setSound').checked = S.state.sound;
    $('#setWho').textContent = `${S.state.name} — ${isAdmin() ? 'مسؤول اللعبة' : 'لاعب'}`;
  }
  async function saveSettings() {
    const url = $('#setSync').value.trim().replace(/\/+$/, '');
    if (url && !Sync.isValidUrl(url)) return toast('رابط قاعدة البيانات غير صحيح — يجب أن يكون مثل https://xxx-default-rtdb.firebaseio.com', 5000);
    const changedSync = url !== (S.state.syncUrl || '');
    S.state.syncUrl = url; S.state.sound = $('#setSound').checked;
    const token = $('#setMapbox').value.trim();
    if (token !== (S.state.mapboxToken || '')) { S.state.mapboxToken = token; HuntMap.useMapbox(token); }
    S.save();
    if (changedSync && url) {
      try { await Sync.test(); toast('تم الاتصال بقاعدة البيانات ✅'); if (S.hunt && isAdmin()) { const mind = await S.getMind(S.hunt); await Sync.putHunt({ ...S.hunt, mind }); } pushPlayer(); startPolling(); }
      catch (e) { toast(e.message, 5000); }
    } else if (changedSync) { stopPolling(); players = []; }
    renderAll(); toast('تم حفظ الإعدادات');
  }
  function resetEverything() {
    if (!confirm('سيتم مسح كل البيانات المحفوظة على هذا الجهاز (التحدي، التقدم، الإعدادات). متابعة؟')) return;
    S.clearHunt().then(() => { S.reset(); location.href = location.pathname; });
  }

  /* ───────── Boot ───────── */
  async function boot() {
    HuntMap.init({ container: 'map', config: CFG.map, mapboxToken: S.state.mapboxToken, onPick, onMove });

    // wiring
    $('#loginBtn').addEventListener('click', login);
    $('#loginName').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
    $$('[data-nav]').forEach((b) => b.addEventListener('click', () => show(b.dataset.nav)));
    $$('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));
    $('#camStart').addEventListener('click', startCamera);
    $('#camStop').addEventListener('click', stopCamera);
    $('#pickDone').addEventListener('click', endPick);
    $('#bImage').addEventListener('change', (e) => onImagePicked(e.target.files[0]));
    $('#bDrop').addEventListener('dragover', (e) => { e.preventDefault(); $('#bDrop').classList.add('is-over'); });
    $('#bDrop').addEventListener('dragleave', () => $('#bDrop').classList.remove('is-over'));
    $('#bDrop').addEventListener('drop', (e) => { e.preventDefault(); $('#bDrop').classList.remove('is-over'); onImagePicked(e.dataTransfer.files[0]); });
    $('#bRows').addEventListener('change', (e) => { B.rows = +e.target.value; rebuildPieces(); renderBuilder(); });
    $('#bCols').addEventListener('change', (e) => { B.cols = +e.target.value; rebuildPieces(); renderBuilder(); });
    $('#bBuild').addEventListener('click', buildHunt);
    $('#bPrint').addEventListener('click', printPieces);
    $('#bShare').addEventListener('click', shareHunt);
    $('#bExport').addEventListener('click', exportHunt);
    $('#bDelete').addEventListener('click', deleteHunt);
    $('#bResetPlayers').addEventListener('click', resetPlayers);
    $('#bRefreshPlayers').addEventListener('click', async () => { await pullPlayers(); renderAdminPlayers(); toast('تم التحديث'); });
    $('#setImport').addEventListener('change', (e) => importHunt(e.target.files[0]));
    $('#emptyImport').addEventListener('change', (e) => importHunt(e.target.files[0]));
    $('#setSave').addEventListener('click', saveSettings);
    $('#setLogout').addEventListener('click', logout);
    $('#setReset').addEventListener('click', resetEverything);
    $('#modalClose').addEventListener('click', closeModal);
    $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && screen === 'camera') stopCamera(); });

    // deep link: ?db=<firebase url>&hunt=<id>
    const params = new URLSearchParams(location.search);
    const db = params.get('db'), huntId = params.get('hunt');
    if (db && Sync.isValidUrl(db)) { S.state.syncUrl = db.replace(/\/+$/, ''); S.save(); }
    if (params.has('db') || params.has('hunt')) history.replaceState(null, '', location.pathname);

    renderAll();
    show(S.state.name ? 'home' : 'login');
    if (huntId && Sync.enabled) await loadRemoteHunt(huntId);
    startPolling();
  }

  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot();
})();
