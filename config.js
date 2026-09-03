// ─────────────────────────────────────────────────────────────
//  ابحث عني — إعدادات اللعبة
//  Edit this file to change names, defaults, and the map centre.
// ─────────────────────────────────────────────────────────────
window.APP_CONFIG = {
  appName: 'ابحث عني',
  tagline: 'قسّم صورة، خبّئ قطعها، ومن يجمعها كلها يفوز',

  // Whoever signs in with one of these names becomes the admin (can build hunts).
  adminNames: ['فهد', 'fahad', 'fahd'],

  defaults: {
    rows: 3,
    cols: 3,
    pointsPerPiece: 10,
    completionBonus: 50,
    radiusMeters: 50,     // GPS zone around a city piece
    strictGps: true,      // city pieces only count when scanned inside their zone
  },

  // Largest side of the stored photo (px). Bigger = sharper prints, more storage.
  imageMaxSide: 1600,

  map: {
    center: [24.7136, 46.6753],   // Riyadh
    zoom: 11,
    mapboxStyle: 'mapbox/streets-v12',
  },

  // Image-recognition engine (MindAR, vendored — no CDN needed).
  mindarUrl: './vendor/mindar/mindar-image.prod.js',
};
