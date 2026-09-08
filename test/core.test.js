/* Room state machine: join, ready, round timeline, submissions, results, standings, final. */
import assert from 'node:assert';
import { GameRoom, PHASE } from '../shared/game-core.js';
import { soundById, soundDurationMs, recordWindowMs } from '../shared/sounds.js';

let now = 1_000_000;
const events = [];
const room = new GameRoom({ code: 'TEST', hostId: 'a', emit: (target, ev, payload) => events.push({ target, ev, payload }), now: () => now });
const last = (ev) => [...events].reverse().find((e) => e.ev === ev);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// join
assert.strictEqual(room.join('a', { name: 'Fahad', avatar: '🦁' }).ok, true);
assert.strictEqual(room.join('b', { name: '<b>Sara</b>', avatar: '🦁' }).ok, true);   // duplicate avatar gets another one
const snap = last('room:state').payload;
assert.deepStrictEqual(snap.players.map((p) => p.name), ['Fahad', 'bSara/b']);
assert.notStrictEqual(snap.players[0].avatar, snap.players[1].avatar);
assert.strictEqual(room.phase, PHASE.LOBBY);

// cannot start until everyone is ready
assert.strictEqual(room.handle('a', 'round:start').ok, false);
assert.match(last('error:msg').payload.message, /Ready/);
assert.strictEqual(room.handle('b', 'round:start').ok, false, 'non-host cannot start');
room.handle('a', 'player:ready', { ready: true }); room.handle('b', 'player:ready', { ready: true });
room.handle('a', 'room:settings', { rounds: 2 });
assert.strictEqual(room.settings.rounds, 2);

// clock sync
const ping = room.handle('b', 'time:ping', { t: 5 });
assert.deepStrictEqual(ping, { ok: true, serverNow: now, echo: 5 });

// round 1 timeline
assert.strictEqual(room.handle('a', 'round:start', { soundId: 'doorbell' }).ok, true);
const rs = last('round:start').payload;
const sound = soundById('doorbell');
assert.strictEqual(rs.soundId, 'doorbell');
assert.strictEqual(rs.listenAt, now + 1500);
assert.strictEqual(rs.recordAt, rs.listenAt + soundDurationMs(sound) + 3000);
assert.strictEqual(rs.recordEndAt, rs.recordAt + recordWindowMs(sound));
assert.ok(recordWindowMs(sound) >= 3000 && recordWindowMs(sound) <= 5000, 'record window 3–5 s');
assert.strictEqual(room.phase, PHASE.LISTEN);

// too early to submit
assert.strictEqual(room.handle('a', 'round:submit', { score: 90 }).ok, false);
now = rs.recordEndAt + 10;
assert.strictEqual(room.handle('a', 'round:submit', { score: 91.6, pitch: 95, rhythm: 80, contour: [0, 1.5, null, 2], audio: 'data:audio/webm;codecs=opus;base64,AAAA', title: 'Golden' }).ok, true);
assert.strictEqual(room.round.results, null, 'waits for the second player');
assert.strictEqual(last('room:state').payload.players[0].submitted, true);
assert.strictEqual(room.handle('b', 'round:submit', { score: 300, pitch: -5, rhythm: 'x', audio: 'javascript:alert(1)' }).ok, true);
const res = last('round:results').payload;
assert.strictEqual(room.phase, PHASE.RESULTS);
assert.deepStrictEqual(res.results.map((r) => [r.name, r.score, r.rank]), [['bSara/b', 100, 1], ['Fahad', 92, 2]]);
assert.strictEqual(res.results[0].audio, null, 'bad audio dropped');
assert.strictEqual(res.results[1].audio.startsWith('data:audio/webm'), true);
assert.strictEqual(last('room:state').payload.round.results[1].audio, undefined, 'snapshot never carries audio');
assert.deepStrictEqual(room.standings().map((s) => [s.name, s.total]), [['bSara/b', 100], ['Fahad', 92]]);

// round 2 with a missing submission resolves at the deadline
now += 10;
room.handle('a', 'round:start');
const r2 = last('round:start').payload;
assert.notStrictEqual(r2.soundId, 'doorbell', 'sounds are not repeated while others remain');
now = r2.recordEndAt + 5;
room.handle('b', 'round:submit', { score: 40, pitch: 40, rhythm: 40 });
assert.strictEqual(room.round.results, null);
room.finishRound('deadline');   // what the timer does at submitDeadline
const res2 = last('round:results').payload;
assert.strictEqual(res2.reason, 'deadline');
assert.strictEqual(res2.results.find((r) => r.id === 'a').missing, true);
assert.strictEqual(res2.results.find((r) => r.id === 'a').score, 0);

// after the last round the host's "next" ends the game
assert.deepStrictEqual(room.handle('a', 'round:start'), { ok: true, final: true });
assert.strictEqual(room.phase, PHASE.FINAL);
assert.deepStrictEqual(last('game:final').payload.standings.map((s) => s.total), [140, 92]);

// reset + host migration + leave during a round
room.handle('a', 'game:reset');
assert.strictEqual(room.phase, PHASE.LOBBY);
assert.strictEqual(room.standings()[0].total, 0);
room.leave('a');
assert.strictEqual(room.hostId, 'b');
room.leave('b');
assert.strictEqual(room.empty, true);

// real timers: phase flips to RECORD at recordAt and results publish at the deadline
{
  const fast = new GameRoom({ code: 'FAST', hostId: 'x', emit: () => {} });
  fast.join('x', { name: 'X' }); fast.handle('x', 'player:ready', { ready: true });
  fast.settings.countdownMs = 100;
  fast.startRound('laser');
  const r = fast.round;
  await wait(r.recordAt - Date.now() + 50);
  assert.strictEqual(fast.phase, PHASE.RECORD);
  fast.round.submitDeadline = Date.now() + 100; fast.clearTimers(); fast.later(100, () => fast.finishRound('deadline'));
  await wait(200);
  assert.strictEqual(fast.phase, PHASE.RESULTS);
  fast.dispose();
}

console.log('✔ core test passed');

// custom sounds: host adds one, it joins the pool, travels with round:start, and can be removed
{
  const evs = [];
  const r = new GameRoom({ code: 'SND', hostId: 'h', emit: (t, ev, p) => evs.push({ t, ev, p }) });
  r.join('h', { name: 'Host' }); r.join('g', { name: 'Guest' });
  const clip = { name: 'Meow<b>', audio: 'data:audio/wav;base64,UklGRg==', durationMs: 1200, contour: [{ t: 0, f: 400 }, { t: 20, f: 420 }, { t: 40, f: 440 }], onsets: [0] };
  assert.strictEqual(r.handle('g', 'room:addSound', clip).ok, false, 'guest cannot add sounds');
  const added = r.handle('h', 'room:addSound', clip);
  assert.strictEqual(added.ok, true);
  const snap = [...evs].reverse().find((e) => e.ev === 'room:state').p;
  assert.deepStrictEqual(snap.sounds.custom.map((c) => c.name), ['Meowb']);
  assert.strictEqual(snap.sounds.custom[0].audio, undefined, 'snapshot never carries audio');
  assert.strictEqual(r.handle('h', 'room:addSound', { name: 'silent', audio: 'data:audio/wav;base64,AA==', durationMs: 1000, contour: [{ t: 0, f: null }] }).ok, false, 'clips without pitch are rejected');
  r.handle('h', 'player:ready', { ready: true }); r.handle('g', 'player:ready', { ready: true });
  r.handle('h', 'room:builtIn', { enabled: false });
  r.handle('h', 'round:start');
  const start = [...evs].reverse().find((e) => e.ev === 'round:start').p;
  assert.strictEqual(start.soundId, added.id, 'only the custom sound remains in the pool');
  assert.strictEqual(start.sound.audio, clip.audio, 'custom sound travels with the round');
  assert.strictEqual(start.recordEndAt - start.recordAt, 3000, 'record window clamps to 3 s');
  r.handle('h', 'game:reset');
  r.handle('h', 'room:removeSound', { id: added.id });
  assert.strictEqual(r.customSounds.length, 0);
  assert.strictEqual(r.useBuiltIn, false);   // flag stays; startRound falls back to built-ins when no custom sounds remain
  r.handle('h', 'round:start');
  assert.ok(!String([...evs].reverse().find((e) => e.ev === 'round:start').p.soundId).startsWith('custom-'));
  r.dispose();
  console.log('✔ custom sound test passed');
}
