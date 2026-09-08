/**
 * Mimic Party — shared room state machine.
 *
 * Runs on the Node/Socket.io server, and — on static hosting (GitHub Pages) — on the host
 * player's phone, where the other phones connect over WebRTC. Both transports call the same
 * `join / leave / handle` API and receive events through `emit(target, event, payload)`.
 *
 * Round timeline (all absolute timestamps on the *host* clock; clients sync their offset):
 *   listenAt  → everyone plays the reference sound
 *   recordAt  → listenAt + sound length + 3 s countdown: everyone records at the same instant
 *   recordEndAt → recordAt + record window (3–5 s)
 *   submitDeadline → recordEndAt + 8 s: results are published even if someone never submits
 */
import { SOUND_IDS, soundById, soundDurationMs, recordWindowMs, sanitizeCustomSound, CUSTOM_LIMITS } from './sounds.js';

export const PHASE = { LOBBY: 'lobby', LISTEN: 'listen', RECORD: 'record', RESULTS: 'results', FINAL: 'final' };
export const LIMITS = { maxPlayers: 12, audioBytes: 400 * 1024, rounds: [1, 20] };
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const AVATARS = ['🦁', '🐸', '🐙', '🦄', '🐧', '🐯', '🦊', '🐼', '🐨', '🐵', '🦖', '🐷'];

export function makeCode(taken) {
  let code;
  do { code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join(''); }
  while (taken && taken(code));
  return code;
}

export function cleanName(name) {
  const n = String(name || '').replace(/[\x00-\x1f<>]/g, '').trim().slice(0, 16);
  return n || 'Player';
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** Validates a player's round submission (scores are computed client-side; the core only sanity-checks). */
export function sanitizeSubmission(s) {
  if (!s || typeof s !== 'object') return null;
  const score = clamp(Math.round(num(s.score)), 0, 100);
  const pitch = clamp(Math.round(num(s.pitch)), 0, 100);
  const rhythm = clamp(Math.round(num(s.rhythm)), 0, 100);
  const contour = Array.isArray(s.contour) ? s.contour.slice(0, 200).map((v) => (v === null ? null : clamp(num(v), -60, 60))) : [];
  let audio = null;
  if (typeof s.audio === 'string' && /^data:audio\/[a-z0-9.+-]+(;codecs=[a-z0-9.,+-]+)?;base64,[a-z0-9+/=]+$/i.test(s.audio) && s.audio.length <= LIMITS.audioBytes * 1.4) audio = s.audio;
  return { score, pitch, rhythm, contour, audio, title: typeof s.title === 'string' ? s.title.slice(0, 40) : '' };
}

export class GameRoom {
  constructor({ code, hostId, emit, now = () => Date.now() }) {
    this.code = code;
    this.hostId = hostId;
    this.emit = emit;
    this.now = now;
    this.phase = PHASE.LOBBY;
    this.players = new Map();
    this.settings = { rounds: 5, countdownMs: 3000 };
    this.round = null;          // current round
    this.history = [];          // finished rounds (without audio)
    this.customSounds = [];     // host-added sounds (with audio)
    this.useBuiltIn = true;
    this.timers = [];
    this.createdAt = now();
  }

  get playerList() { return [...this.players.values()]; }
  get empty() { return this.players.size === 0; }

  snapshot() {
    const r = this.round;
    return {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      settings: this.settings,
      serverNow: this.now(),
      players: this.playerList.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, ready: p.ready, total: p.total, submitted: !!(r && r.submissions.has(p.id)), lastScore: p.lastScore })),
      round: r ? {
        n: r.n, of: this.settings.rounds, soundId: r.soundId, listenAt: r.listenAt, recordAt: r.recordAt, recordEndAt: r.recordEndAt, submitDeadline: r.submitDeadline,
        results: r.results ? r.results.map(({ audio, ...rest }) => rest) : null,   // audio travels once in round:results
      } : null,
      standings: this.standings(),
      sounds: { builtIn: this.useBuiltIn, custom: this.customSounds.map(({ audio, contour, ...rest }) => ({ ...rest, bytes: audio.length })) },
    };
  }

  standings() {
    return this.playerList.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, total: p.total, rounds: p.rounds })).sort((a, b) => b.total - a.total);
  }

  broadcast() { this.emit('*', 'room:state', this.snapshot()); }
  fail(id, message) { this.emit(id, 'error:msg', { message }); return { ok: false, error: message }; }
  later(ms, fn) { this.timers.push(setTimeout(fn, Math.max(0, ms))); }
  clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; }
  dispose() { this.clearTimers(); }

  /* ── membership ── */
  join(id, { name, avatar } = {}) {
    if (this.players.size >= LIMITS.maxPlayers) return this.fail(id, 'Room is full (12 players).');
    const used = new Set(this.playerList.map((p) => p.avatar));
    const pick = AVATARS.includes(avatar) && !used.has(avatar) ? avatar : (AVATARS.find((a) => !used.has(a)) || AVATARS[this.players.size % AVATARS.length]);
    this.players.set(id, { id, name: cleanName(name), avatar: pick, ready: false, total: 0, rounds: [], lastScore: null });
    this.emit(id, 'room:joined', { code: this.code, id });
    this.broadcast();
    return { ok: true };
  }

  leave(id) {
    if (!this.players.delete(id)) return;
    if (this.empty) { this.dispose(); return; }
    if (this.hostId === id) this.hostId = this.players.keys().next().value;
    if (this.round && !this.round.results && this.playerList.every((p) => this.round.submissions.has(p.id))) this.finishRound('all-submitted');
    else this.broadcast();
  }

  /* ── rounds ── */
  startRound(soundId) {
    const used = new Set(this.history.map((h) => h.soundId));
    const all = [...(this.useBuiltIn || !this.customSounds.length ? SOUND_IDS : []), ...this.customSounds.map((c) => c.id)];
    const pool = all.filter((s) => !used.has(s));
    const from = pool.length ? pool : all;
    const pick = all.includes(soundId) ? soundId : from[Math.floor(Math.random() * from.length)];
    const sound = soundById(pick, this.customSounds);
    const now = this.now();
    const listenAt = now + 1500;
    const recordAt = listenAt + soundDurationMs(sound) + this.settings.countdownMs;
    const recordEndAt = recordAt + recordWindowMs(sound);
    this.round = { n: this.history.length + 1, soundId: pick, listenAt, recordAt, recordEndAt, submitDeadline: recordEndAt + 8000, submissions: new Map(), results: null };
    for (const p of this.players.values()) p.lastScore = null;
    this.clearTimers();
    this.phase = PHASE.LISTEN;
    // custom sounds travel with the round so every phone can play and score them
    this.emit('*', 'round:start', { ...this.snapshot().round, sound: sound.custom ? sound : null, serverNow: now });
    this.broadcast();
    this.later(recordAt - now, () => { if (this.round && !this.round.results) { this.phase = PHASE.RECORD; this.broadcast(); } });
    this.later(this.round.submitDeadline - now, () => { if (this.round && !this.round.results) this.finishRound('deadline'); });
  }

  finishRound(reason) {
    const r = this.round;
    if (!r || r.results) return;
    this.clearTimers();
    const results = this.playerList.map((p) => {
      const s = r.submissions.get(p.id) || { score: 0, pitch: 0, rhythm: 0, contour: [], audio: null, title: 'Stage fright 🫣', missing: true };
      return { id: p.id, name: p.name, avatar: p.avatar, ...s };
    }).sort((a, b) => b.score - a.score);
    results.forEach((res, i) => {
      res.rank = i + 1;
      const p = this.players.get(res.id);
      p.total += res.score; p.lastScore = res.score; p.rounds.push(res.score);
    });
    r.results = results;
    this.history.push({ n: r.n, soundId: r.soundId, scores: results.map(({ id, score }) => ({ id, score })) });
    this.phase = PHASE.RESULTS;
    this.emit('*', 'round:results', { n: r.n, soundId: r.soundId, reason, results, standings: this.standings() });
    this.broadcast();
  }

  endGame() {
    this.clearTimers();
    this.phase = PHASE.FINAL;
    this.emit('*', 'game:final', { standings: this.standings(), rounds: this.history });
    this.broadcast();
  }

  /* ── actions ── */
  handle(id, event, payload = {}) {
    const p = this.players.get(id);
    if (!p) return { ok: false };
    payload = payload && typeof payload === 'object' ? payload : {};
    switch (event) {
      case 'time:ping':
        return { ok: true, serverNow: this.now(), echo: payload.t };

      case 'player:name':
        p.name = cleanName(payload.name); this.broadcast(); return { ok: true };

      case 'player:ready':
        p.ready = !!payload.ready; this.broadcast(); return { ok: true };

      case 'room:settings':
        if (this.hostId !== id) return { ok: false };
        this.settings.rounds = clamp(Math.round(num(payload.rounds, this.settings.rounds)), LIMITS.rounds[0], LIMITS.rounds[1]);
        this.broadcast(); return { ok: true };

      case 'room:addSound': {
        if (this.hostId !== id) return { ok: false };
        if (this.customSounds.length >= CUSTOM_LIMITS.maxSounds) return this.fail(id, `Up to ${CUSTOM_LIMITS.maxSounds} custom sounds per room.`);
        const snd = sanitizeCustomSound(payload);
        if (!snd) return this.fail(id, 'That clip has no clear pitch — try a louder, cleaner sound (max 4 s).');
        this.customSounds.push(snd); this.broadcast(); return { ok: true, id: snd.id };
      }
      case 'room:removeSound':
        if (this.hostId !== id) return { ok: false };
        this.customSounds = this.customSounds.filter((c) => c.id !== payload.id); this.broadcast(); return { ok: true };
      case 'room:builtIn':
        if (this.hostId !== id) return { ok: false };
        this.useBuiltIn = !!payload.enabled || this.customSounds.length === 0; this.broadcast(); return { ok: true };

      case 'round:start':
        if (this.hostId !== id) return this.fail(id, 'Only the host can start a round.');
        if (this.phase === PHASE.LISTEN || this.phase === PHASE.RECORD) return { ok: false };
        if (this.history.length >= this.settings.rounds) { this.endGame(); return { ok: true, final: true }; }
        if (this.phase === PHASE.LOBBY && this.playerList.some((q) => !q.ready)) return this.fail(id, 'Everyone needs to enable their mic and tap Ready.');
        this.startRound(payload.soundId);
        return { ok: true };

      case 'round:submit': {
        const r = this.round;
        if (!r || r.results) return { ok: false };
        if (this.now() < r.recordAt) return this.fail(id, 'Recording has not started yet.');
        const sub = sanitizeSubmission(payload);
        if (!sub) return this.fail(id, 'Invalid submission.');
        r.submissions.set(id, sub);
        if (this.playerList.every((q) => r.submissions.has(q.id))) this.finishRound('all-submitted');
        else this.broadcast();
        return { ok: true };
      }

      case 'game:end':
        if (this.hostId !== id) return { ok: false };
        this.endGame(); return { ok: true };

      case 'game:reset':
        if (this.hostId !== id) return { ok: false };
        this.clearTimers();
        this.round = null; this.history = [];
        for (const q of this.players.values()) { q.total = 0; q.rounds = []; q.lastScore = null; }
        this.phase = PHASE.LOBBY; this.broadcast(); return { ok: true };

      default:
        return { ok: false };
    }
  }
}
