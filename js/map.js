/* ═══════════════════════════════════════════════════════════
   HuntMap — Browser GPS map (Leaflet)
   Uses Mapbox tiles when a token is configured, otherwise
   OpenStreetMap, so the dashboard runs with zero setup.
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const ICONS = {
    sword: '#i-sword', palm: '#i-palm', coffee: '#i-coffee', map: '#i-map', pin: '#i-pin', lock: '#i-lock', check: '#i-check',
  };

  // Degrade gracefully if Leaflet failed to load: the rest of the dashboard keeps working.
  if (typeof L === 'undefined') {
    const noop = () => {};
    window.HuntMap = {
      init(o) { const el = document.getElementById(o.container); if (el) el.innerHTML = '<div class="map__fallback">تعذر تحميل مكتبة الخريطة — تحقق من الاتصال ثم أعد التحميل</div>'; },
      useMapbox: noop, renderStages: noop, addCustomDrop: noop, setPlayer: noop, setMode: noop, flyTo: noop, invalidate: noop,
      distance, get map() { return null; },
    };
    return;
  }

  let map, tileLayer, cfg, stageLayer, playerMarker, playerCircle, customLayer, mode = 'outdoor';
  let handlers = {};

  function pinIcon(kind, iconId) {
    return L.divIcon({
      className: '',
      html: `<div class="pin pin--${kind}"><svg><use href="${iconId}"/></svg></div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 34],
      popupAnchor: [0, -30],
    });
  }

  const playerIcon = L.divIcon({ className: '', html: '<div class="pin pin--player"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });

  function makeTiles(token) {
    if (token) {
      return L.tileLayer(
        `https://api.mapbox.com/styles/v1/${cfg.mapbox.styleId}/tiles/{z}/{x}/{y}?access_token=${token}`,
        { tileSize: 512, zoomOffset: -1, maxZoom: 19, attribution: '© Mapbox © OpenStreetMap' }
      );
    }
    return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap contributors',
    });
  }

  function init(options) {
    cfg = options.config;
    handlers = options;

    map = L.map(options.container, { zoomControl: true, attributionControl: true })
      .setView(cfg.map.center, cfg.map.zoom);

    // Keep zoom control on the left for RTL layouts.
    map.zoomControl.setPosition('topleft');

    useMapbox(cfg.mapbox.accessToken);

    stageLayer = L.layerGroup().addTo(map);
    customLayer = L.layerGroup().addTo(map);

    map.on('click', (e) => {
      if (mode !== 'outdoor') return;
      if (handlers.onDropAdd) handlers.onDropAdd([e.latlng.lat, e.latlng.lng]);
    });

    return map;
  }

  function useMapbox(token) {
    if (tileLayer) map.removeLayer(tileLayer);
    tileLayer = makeTiles(token).addTo(map);
    const badge = document.getElementById('mapProvider');
    if (badge) badge.textContent = token ? 'Mapbox' : 'OpenStreetMap';
  }

  function statusIcon(stage) {
    if (stage.status === 'collected') return ICONS.check;
    if (stage.status === 'locked') return ICONS.lock;
    return ICONS[stage.icon] || ICONS.pin;
  }

  function popupHtml(stage, idx) {
    const status = { unlocked: 'مفتوح', locked: 'مقفل', collected: 'تم جمعه' }[stage.status];
    const type = stage.type === 'indoor' ? 'هدف صورة داخلي' : 'دروب GPS خارجي';
    const action = stage.status === 'unlocked'
      ? `<button class="btn btn--gold btn--sm" data-collect="${stage.id}">التقاط القطعة (+${stage.points})</button>`
      : '';
    return `<div class="popup"><b>${idx + 1}. ${stage.title}</b><p>${stage.riddle}</p><p>${type} · ${status} · ${stage.points} نقطة</p>${action}</div>`;
  }

  function renderStages(stages) {
    stageLayer.clearLayers();
    stages.forEach((s, i) => {
      const kind = s.status;
      const m = L.marker(s.coords, { icon: pinIcon(kind, statusIcon(s)) }).addTo(stageLayer);
      m.bindPopup(popupHtml(s, i), { closeButton: false });
      m.on('click', () => handlers.onSelect && handlers.onSelect(s));

      // unlock radius ring
      L.circle(s.coords, {
        radius: cfg.map.unlockRadiusMeters,
        color: kind === 'locked' ? '#6f7f78' : '#d4af37',
        weight: 1.5, fillColor: kind === 'locked' ? '#6f7f78' : '#1d8a63', fillOpacity: .12, dashArray: kind === 'locked' ? '4 4' : null,
      }).addTo(stageLayer);
    });
  }

  function addCustomDrop(coords, label) {
    const m = L.marker(coords, { icon: pinIcon('custom', ICONS.pin) }).addTo(customLayer);
    m.bindPopup(`<div class="popup"><b>${label}</b><p>${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}</p><button class="btn btn--ghost btn--sm" data-remove-drop>حذف</button></div>`, { closeButton: false });
    m.on('popupopen', (e) => {
      const btn = e.popup.getElement().querySelector('[data-remove-drop]');
      if (btn) btn.onclick = () => { customLayer.removeLayer(m); handlers.onDropRemove && handlers.onDropRemove(coords); };
    });
    return m;
  }

  function setPlayer(lat, lng, accuracy) {
    const ll = [lat, lng];
    if (!playerMarker) {
      playerMarker = L.marker(ll, { icon: playerIcon, zIndexOffset: 1000 }).addTo(map).bindTooltip('أنت هنا', { direction: 'top' });
      playerCircle = L.circle(ll, { radius: accuracy || 20, color: '#2f80ed', weight: 1, fillOpacity: .08 }).addTo(map);
      map.flyTo(ll, Math.max(map.getZoom(), 14));
    } else {
      playerMarker.setLatLng(ll);
      playerCircle.setLatLng(ll).setRadius(accuracy || 20);
    }
  }

  function setMode(next) {
    mode = next;
    const hint = document.getElementById('mapHint');
    if (hint) hint.textContent = mode === 'outdoor'
      ? 'اضغط على الخريطة لإضافة دروب جديد · اضغط على الدبوس للتفاصيل'
      : 'وضع الأهداف الداخلية — يتم الفتح بالتعرف على الصورة وليس بالموقع';
  }

  function flyTo(coords, zoom) { map.flyTo(coords, zoom || 15, { duration: .8 }); }
  function invalidate() { map && map.invalidateSize(); }

  // haversine distance in meters
  function distance(a, b) {
    const R = 6371000, toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(b[0] - a[0]), dLng = toRad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  window.HuntMap = { init, useMapbox, renderStages, addCustomDrop, setPlayer, setMode, flyTo, invalidate, distance, get map() { return map; } };
})();
