/* End-to-end game-flow test against the real server with three socket clients. */
'use strict';
const assert = require('assert');
const { server, rooms } = require('../server');
const { io } = require('socket.io-client');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function once(sock, ev) { return new Promise((res) => sock.once(ev, res)); }
const latest = new Map();
function track(sock) { sock.on('room:state', (s) => latest.set(sock, s)); return sock; }
/** Resolves with the first room state (already received or upcoming) that satisfies pred. */
function stateWhere(sock, pred) {
  const cur = latest.get(sock);
  if (cur && pred(cur)) return Promise.resolve(cur);
  return new Promise((res) => { const h = (s) => { if (pred(s)) { sock.off('room:state', h); res(s); } }; sock.on('room:state', h); });
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const [host, hider2, seeker] = [1, 2, 3].map(() => track(io(url, { transports: ['websocket'] })));
  await Promise.all([host, hider2, seeker].map((s) => once(s, 'connect')));

  // create + join
  host.emit('room:create', { name: 'Fahad', role: 'hider' });
  const { code } = await once(host, 'room:joined');
  assert.strictEqual(code.length, 4, 'room code');
  hider2.emit('room:join', { code: code.toLowerCase(), name: 'Sara', role: 'hider' });
  await once(hider2, 'room:joined');
  seeker.emit('room:join', { code, name: 'Omar', role: 'seeker' });
  await once(seeker, 'room:joined');
  let s = await stateWhere(host, (st) => st.players.length === 3);
  assert.strictEqual(s.hostId, host.id);
  assert.deepStrictEqual(s.players.map((p) => p.role), ['hider', 'hider', 'seeker']);

  // bad join
  const err = once(seeker, 'error:msg');
  seeker.emit('room:join', { code: 'ZZZZ', name: 'x' });
  assert.match((await err).message, /not found/i);

  // start → hide phase
  host.emit('room:settings', { hideSeconds: 30, seekSeconds: 40 });
  host.emit('game:start');
  s = await stateWhere(seeker, (st) => st.phase === 'hide');
  assert.ok(s.phaseEndsAt > Date.now(), 'hide timer');

  // hidden data must stay secret during the hide phase
  host.emit('hider:ready', { position: [1, 0, -2], rotationY: 0.5, scale: 1, color: '#336699', texture: 'data:image/jpeg;base64,/9j/AAAA', mode: 'xr' });
  s = await stateWhere(seeker, (st) => st.players[0].ready);
  assert.strictEqual(s.players[0].hidden, null, 'hidden must not leak in hide phase');
  assert.strictEqual(s.players[0].placed, true);

  // invalid payload rejected
  const bad = once(hider2, 'error:msg');
  hider2.emit('hider:ready', { position: ['a', 0, 0] });
  assert.match((await bad).message, /invalid/i);

  // second hider ready → seek phase starts immediately
  hider2.emit('hider:ready', { position: [-1, 0, -1], rotationY: 0, scale: 0.8, color: 'not-a-color' });
  s = await stateWhere(seeker, (st) => st.phase === 'seek');
  const hidden = s.players.map((p) => p.hidden);
  assert.deepStrictEqual(hidden[0].position, [1, 0, -2]);
  assert.strictEqual(hidden[0].texture.startsWith('data:image/jpeg'), true);
  assert.strictEqual(hidden[1].color, '#8a8a8a', 'bad color falls back');
  assert.strictEqual(hidden[2], null, 'seeker has no hidden');

  // hider cannot "find"
  await new Promise((res) => host.emit('seeker:found', { targetId: hider2.id }, (r) => { assert.strictEqual(r.ok, false); res(); }));
  // seeker finds both
  const foundEvt = once(hider2, 'player:found');
  await new Promise((res) => seeker.emit('seeker:found', { targetId: hider2.id }, (r) => { assert.strictEqual(r.ok, true); res(); }));
  assert.strictEqual((await foundEvt).targetId, hider2.id);
  await new Promise((res) => seeker.emit('seeker:found', { targetId: hider2.id }, (r) => { assert.strictEqual(r.ok, false, 'double find'); res(); }));
  const results = once(host, 'game:results');
  await new Promise((res) => seeker.emit('seeker:found', { targetId: host.id }, (r) => { assert.strictEqual(r.ok, true); res(); }));
  const res = await results;
  assert.strictEqual(res.winner, 'seekers');
  assert.strictEqual(res.foundCount, 2);
  s = await stateWhere(host, (st) => st.phase === 'results');

  // reset + host migration + room cleanup
  host.emit('game:reset');
  s = await stateWhere(seeker, (st) => st.phase === 'lobby');
  host.disconnect();
  s = await stateWhere(seeker, (st) => st.players.length === 2);
  assert.strictEqual(s.hostId, hider2.id, 'host migrates');
  hider2.disconnect(); seeker.disconnect();
  await wait(100);
  assert.strictEqual(rooms.size, 0, 'empty room deleted');

  console.log('✔ flow test passed');
  server.close(); process.exit(0);
})().catch((e) => { console.error('✘ flow test failed:', e); process.exit(1); });
