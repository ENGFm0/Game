// ─────────────────────────────────────────────────────────────
//  سيفين ونخله — إعدادات المنصة
//  Edit this file to configure the hunt without touching app code.
// ─────────────────────────────────────────────────────────────
window.HUNT_CONFIG = {
  appName: 'سيفين ونخله',
  tagline: 'ما تجمعه هو الهدية',
  publicUrl: 'https://hunt.sa/national-day',

  // Mapbox is used when a token is present; otherwise the map falls back
  // to OpenStreetMap tiles so the dashboard works out of the box.
  mapbox: {
    accessToken: '',                 // e.g. 'pk.eyJ1Ijo...'
    styleId: 'mapbox/dark-v11',
  },

  map: {
    center: [24.7136, 46.6753],      // Riyadh
    zoom: 11,
    unlockRadiusMeters: 60,          // how close a player must be to unlock a drop
  },

  // WebAR image target (compiled with the MindAR image-target compiler).
  // Replace with your own .mind file, e.g. 'assets/targets/coffee-cup.mind'.
  ar: {
    targetSrc: 'https://cdn.jsdelivr.net/gh/hiukim/mind-ar-js@1.2.5/examples/image-tracking/assets/card-example/card.mind',
    targetLabel: 'كوب القهوة',
  },

  prizePool: { amount: 1000, currency: 'SAR' },

  challenge: {
    title: 'تحدي اليوم الوطني السعودي',
    stages: [
      {
        id: 'sword-1',
        title: 'ابحث عن السيف الأول',
        riddle: 'بين الحجر المنقوش والرمل القديم، اتبع صرير الباب',
        type: 'outdoor',
        coords: [24.7341, 46.5726],   // Diriyah
        points: 50,
        icon: 'sword',
      },
      {
        id: 'palm',
        title: 'ابحث عن النخلة الذهبية',
        riddle: 'حيث الشمس تغرب خلف الحور',
        type: 'indoor',
        coords: [24.6522, 46.6088],   // Wadi Hanifah
        points: 40,
        icon: 'palm',
      },
      {
        id: 'sword-2',
        title: 'ابحث عن السيف الثاني',
        riddle: 'فوق المدينة، حيث يلمع الزجاج عند الغروب',
        type: 'outdoor',
        coords: [24.7114, 46.6744],   // Kingdom Centre
        points: 60,
        icon: 'sword',
      },
    ],
  },

  player: { name: 'فواز', handle: 'fawaz', points: 75, items: ['coffee', 'map'] },

  leaderboard: [
    { handle: 'محمد',    points: 145, items: 4 },
    { handle: 'سارة',    points: 130, items: 3 },
    { handle: 'خالد',    points: 110, items: 3 },
    { handle: 'نورا',    points: 95,  items: 2 },
    { handle: 'عبدالله', points: 80,  items: 2 },
  ],

  store: [
    { id: 'magnet', name: 'مغناطيس القطع', desc: 'يجذب القطع القريبة تلقائياً', price: 20, icon: 'magnet' },
    { id: 'radar',  name: 'رادار موسع',    desc: 'يوسّع نطاق الكشف عن الدروب',   price: 10, icon: 'radar' },
  ],
};
