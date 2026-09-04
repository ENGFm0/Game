/* Solo-play test: a human seeker vs a bot hider, then a human hider vs a bot seeker. */
'use strict';
const assert = require('assert');
const { server } = require('../server');
const { io } = require('socket.io-client');

const latest = new Map();
function track(sock) { sock.on('room:state', (s) => latest.set(sock, s)); return sock; }
function once(sock, ev) { return new Promise((res) => sock.once(ev, res)); }
function stateWhere(sock, pred, timeout = 30000) {
  const cur = latest.get(sock);
  if (cur && pred(cur)) return Promise.resolve(cur);
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout waiting for state')), timeout);
    const h = (s) => { if (pred(s)) { clearTimeout(t); sock.off('room:state', h); res(s); } };
    sock.on('room:state', h);
  });
}
const call = (sock, ev, payload) => new Promise((res) => sock.emit(ev, payload, res));

(async () => {
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;

  /* ── 1. human seeker, bot hider ── */
  let me = track(io(url, { transports: ['websocket'] }));
  await once(me, 'connect');
  me.emit('room:create', { name: 'Fahad', role: 'seeker' });
  await once(me, 'room:joined');
  const add = await call(me, 'room:addBot', { role: 'hider' });
  assert.strictEqual(add.ok, true);
  let s = await stateWhere(me, (st) => st.players.length === 2);
  assert.strictEqual(s.players[1].bot, true);
  await call(me, 'room:settings', { hideSeconds: 30, seekSeconds: 30 });
  const t0 = Date.now();
  await call(me, 'game:start');
  s = await stateWhere(me, (st) => st.phase === 'seek', 15000);          // bot readies within 3–9 s
  const bot = s.players.find((p) => p.bot);
  assert.ok(Date.now() - t0 < 12000, 'bot hid quickly');
  assert.ok(bot.hidden && bot.hidden.position.length === 3, 'bot has a spot');
  const [x, y, z] = bot.hidden.position;
  const dist = Math.hypot(x, z);
  assert.ok(dist >= 1.5 && dist <= 3.01, 'bot 1.5–3 m from origin, got ' + dist);
  assert.strictEqual(y, -1.45);
  assert.ok(z < 0, 'bot roughly in front of the origin');
  const found = await call(me, 'seeker:found', { targetId: bot.id });
  assert.strictEqual(found.ok, true);
  s = await stateWhere(me, (st) => st.phase === 'results');
  console.log('✔ human seeker found the bot hider');
  me.disconnect();

  /* ── 2. human hider, bot seeker (skill 1 → guaranteed find) ── */
  me = track(io(url, { transports: ['websocket'] }));
  await once(me, 'connect');
  me.emit('room:create', { name: 'Fahad', role: 'hider' });
  await once(me, 'room:joined');
  await call(me, 'room:addBot', { role: 'seeker' });
  await call(me, 'room:settings', { hideSeconds: 30, seekSeconds: 20, botSkill: 1 });
  await call(me, 'game:start');
  await stateWhere(me, (st) => st.phase === 'hide');
  const foundEvt = once(me, 'player:found');
  const hintEvt = once(me, 'bot:hint');
  await call(me, 'hider:ready', { position: [0.5, -1.4, -2], rotationY: 0, scale: 1, color: '#556677' });
  await stateWhere(me, (st) => st.phase === 'seek');
  const t1 = Date.now();
  const f = await foundEvt;
  assert.strictEqual(f.targetId, me.id);
  assert.match(f.seekerName, /Bot/);
  assert.ok(Date.now() - t1 >= 5000 && Date.now() - t1 <= 19000, 'found between 30% and 90% of seek time');
  const hint = await hintEvt;
  assert.match(hint.text, /\S/);
  s = await stateWhere(me, (st) => st.phase === 'results');
  assert.strictEqual(s.players.find((p) => !p.bot).found, true);

  // bots are removable in the lobby and never become host
  await call(me, 'game:reset');
  await stateWhere(me, (st) => st.phase === 'lobby');
  await call(me, 'room:removeBots');
  s = await stateWhere(me, (st) => st.players.length === 1);
  console.log('✔ bot seeker found the human hider; bots removable');
  me.disconnect();

  console.log('✔ bots test passed');
  server.close(); process.exit(0);
})().catch((e) => { console.error('✘ bots test failed:', e); process.exit(1); });
