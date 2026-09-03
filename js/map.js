/* ═══════════════════════════════════════════════════════════
   HuntMap — Leaflet map for city pieces.
   Players see zones (circles) for pieces hidden around town and
   their own position; the admin uses pick mode to place pieces.
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  if (typeof L === 'undefined') {
    const noop = () => {};
    window.HuntMap = {
      init(o) { const el = document.getElementById(o.container); if (el) el.innerHTML = '<div class="map__fallback">تعذر تحميل مكتبة الخريطة — تحقق من الاتصال ثم أعد التحميل</div>'; },
      useMapbox: noop, renderPieces: noop, setPlayer: noop, setPickMode: noop, flyTo: noop, invalidate: noop, fitPieces: noop, distance,
    };
    return;
  }

  let map, tileLayer, cfg, pieceLayer, playerMarker, playerCircle, handlers = {}, pickMode = false;

  function labelIcon(text, kind) {
    return L.divIcon({ className: '', html: `<div class="pin pin--${kind}"><span>${text}</span></div>`, iconSize: [36, 36], iconAnchor: [18, 36], popupAnchor: [0, -32] });
  }
  const playerIcon = L.divIcon({ className: '', html: '<div class="pin pin--player"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });

  function makeTiles(token) {
    if (token) {
      return L.tileLayer(`https://api.mapbox.com/styles/v1/${cfg.mapboxStyle}/tiles/{z}/{x}/{y}?access_token=${token}`,
        { tileSize: 512, zoomOffset: -1, maxZoom: 19, attribution: '© Mapbox © OpenStreetMap' });
    }
    return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' });
  }

  function init(options) {
    cfg = options.config; handlers = options;
    map = L.map(options.container, { zoomControl: true }).setView(cfg.center, cfg.zoom);
    map.zoomControl.setPosition('topleft');
    useMapbox(options.mapboxToken);
    pieceLayer = L.layerGroup().addTo(map);
    map.on('click', (e) => { if (pickMode && handlers.onPick) handlers.onPick([e.latlng.lat, e.latlng.lng]); });
    return map;
  }

  function useMapbox(token) {
    if (tileLayer) map.removeLayer(tileLayer);
    tileLayer = makeTiles(token).addTo(map);
    const badge = document.getElementById('mapProvider');
    if (badge) badge.textContent = token ? 'Mapbox' : 'OpenStreetMap';
    map.getContainer().classList.remove('map--offline');
    let failures = 0;
    tileLayer.on('tileerror', () => {
      if (++failures < 3 || !map.hasLayer(tileLayer)) return;
      map.removeLayer(tileLayer);
      map.getContainer().classList.add('map--offline');
      if (badge) badge.textContent = 'بدون اتصال';
    });
  }

  /** pieces: city pieces with lat/lng. found: Set of indices. admin: show exact points. */
  function renderPieces(pieces, found, admin) {
    pieceLayer.clearLayers();
    pieces.forEach((p) => {
      if (p.lat == null) return;
      const isFound = found.has(p.index);
      const kind = isFound ? 'found' : 'zone';
      L.circle([p.lat, p.lng], {
        radius: p.radius || 50, color: isFound ? '#d4af37' : '#146b4e', weight: 2,
        fillColor: isFound ? '#d4af37' : '#1d8a63', fillOpacity: isFound ? .18 : .14,
      }).addTo(pieceLayer);
      const m = L.marker([p.lat, p.lng], { icon: labelIcon(p.label, kind), draggable: !!admin }).addTo(pieceLayer);
      const hint = p.hint ? `<p>${p.hint}</p>` : '';
      m.bindPopup(`<div class="popup"><b>قطعة ${p.label}</b>${hint}<p>${isFound ? 'تم العثور عليها ✅' : `منطقة البحث: ${p.radius || 50} م`}</p></div>`, { closeButton: false });
      if (admin) m.on('dragend', (e) => { const ll = e.target.getLatLng(); handlers.onMove && handlers.onMove(p.index, [ll.lat, ll.lng]); });
    });
  }

  function fitPieces(pieces) {
    const pts = pieces.filter((p) => p.lat != null).map((p) => [p.lat, p.lng]);
    if (!pts.length) return;
    if (pts.length === 1) map.setView(pts[0], 16);
    else map.fitBounds(pts, { padding: [40, 40] });
  }

  function setPlayer(lat, lng, accuracy) {
    const ll = [lat, lng];
    if (!playerMarker) {
      playerMarker = L.marker(ll, { icon: playerIcon, zIndexOffset: 1000 }).addTo(map).bindTooltip('أنت هنا', { direction: 'top' });
      playerCircle = L.circle(ll, { radius: accuracy || 20, color: '#2f80ed', weight: 1, fillOpacity: .08 }).addTo(map);
      if (!pieceLayer.getLayers().length) map.setView(ll, 15);
    } else {
      playerMarker.setLatLng(ll);
      playerCircle.setLatLng(ll).setRadius(accuracy || 20);
    }
  }

  function setPickMode(on) { pickMode = on; map.getContainer().classList.toggle('map--pick', on); }
  function flyTo(coords, zoom) { map.flyTo(coords, zoom || 16, { duration: .8 }); }
  function invalidate() { map && map.invalidateSize(); }

  function distance(a, b) {
    const R = 6371000, toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(b[0] - a[0]), dLng = toRad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  window.HuntMap = { init, useMapbox, renderPieces, fitPieces, setPlayer, setPickMode, flyTo, invalidate, distance, get map() { return map; } };
})();
