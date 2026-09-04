/**
 * Meccha — shared game core.
 * The same room state machine runs on the Node server (Socket.io mode) and on the
 * host's phone (serverless WebRTC mode on static hosting such as GitHub Pages).
 *
 * Works as CommonJS (Node) and as a classic browser script (window.MecchaCore).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MecchaCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PHASE = { LOBBY: 'lobby', HIDE: 'hide', SEEK: 'seek', RESULTS: 'results' };
  const ROLE = { HIDER: 'hider', SEEKER: 'seeker' };
  const LIMITS = { hideSeconds: [20, 600], seekSeconds: [20, 900], maxPlayers: 12, textureBytes: 120 * 1024 };
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function makeCode(taken) {
    let code;
    do { code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join(''); }
    while (taken && taken(code));
    return code;
  }

  function cleanName(name) {
    const n = String(name || '').replace(/[\x00-\x1f<>]/g, '').trim().slice(0, 16);
    return n || 'Player';
  }

  /** Validates the payload a hider sends when they lock their position. Returns null if invalid. */
  function sanitizeHidden(h) {
    if (!h || typeof h !== 'object') return null;
    const pos = Array.isArray(h.position) ? h.position.map(Number) : null;
    if (!pos || pos.length !== 3 || pos.some((n) => !Number.isFinite(n) || Math.abs(n) > 200)) return null;
    const rotationY = Number.isFinite(Number(h.rotationY)) ? Number(h.rotationY) : 0;
    const scale = Math.min(2, Math.max(0.2, Number(h.scale) || 1));
    const color = /^#[0-9a-f]{6}$/i.test(h.color) ? h.color.toLowerCase() : '#8a8a8a';
    let texture = null;
    if (typeof h.texture === 'string' && /^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(h.texture) && h.texture.length <= LIMITS.textureBytes) texture = h.texture;
    const mode = h.mode === 'xr' ? 'xr' : 'fallback';
    return { position: pos, rotationY, scale, color, texture, mode, lockedAt: Date.now() };
  }

  /**
   * One game room.
   * `emit(target, event, payload)` delivers events: target is a player id or '*' for everyone.
   */
  class GameRoom {
    constructor({ code, hostId, emit }) {
      this.code = code;
      this.hostId = hostId;
      this.emit = emit;
      this.phase = PHASE.LOBBY;
      this.phaseEndsAt = null;
      this.settings = { hideSeconds: 90, seekSeconds: 180 };
      this.players = new Map();
      this.timer = null;
      this.createdAt = Date.now();
    }

    get hiders() { return [...this.players.values()].filter((p) => p.role === ROLE.HIDER); }
    get seekers() { return [...this.players.values()].filter((p) => p.role === ROLE.SEEKER); }
    get empty() { return this.players.size === 0; }

    /** What clients are allowed to see. Hidden positions are only revealed in seek/results. */
    snapshot() {
      const reveal = this.phase === PHASE.SEEK || this.phase === PHASE.RESULTS;
      return {
        code: this.code,
        hostId: this.hostId,
        phase: this.phase,
        phaseEndsAt: this.phaseEndsAt,
        settings: this.settings,
        serverNow: Date.now(),
        players: [...this.players.values()].map((p) => ({
          id: p.id, name: p.name, role: p.role, ready: p.ready, placed: !!p.hidden,
          found: p.found, foundBy: p.foundBy, foundAt: p.foundAt, hidden: reveal ? p.hidden : null,
        })),
      };
    }

    broadcast() { this.emit('*', 'room:state', this.snapshot()); }
    fail(id, message) { this.emit(id, 'error:msg', { message }); return { ok: false, error: message }; }

    clearTimer() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } }
    dispose() { this.clearTimer(); }

    setPhase(phase, seconds) {
      this.clearTimer();
      this.phase = phase;
      this.phaseEndsAt = seconds ? Date.now() + seconds * 1000 : null;
      if (seconds) {
        this.timer = setTimeout(() => {
          if (this.phase === PHASE.HIDE) this.startSeek('time');
          else if (this.phase === PHASE.SEEK) this.endGame('time');
        }, seconds * 1000 + 250);
      }
      this.emit('*', 'game:phase', { phase, endsAt: this.phaseEndsAt, serverNow: Date.now() });
      this.broadcast();
    }

    resetPlayers() {
      for (const p of this.players.values()) { p.ready = false; p.hidden = null; p.found = false; p.foundBy = null; p.foundAt = null; }
    }

    startHide() { this.resetPlayers(); this.setPhase(PHASE.HIDE, this.settings.hideSeconds); }

    startSeek(reason) {
      // Hiders who never placed themselves count as found (they are not in the room).
      for (const p of this.hiders) if (!p.hidden) { p.found = true; p.foundBy = null; p.foundAt = Date.now(); }
      this.emit('*', 'game:seekStart', { reason });
      this.setPhase(PHASE.SEEK, this.settings.seekSeconds);
      if (this.hiders.every((p) => p.found)) this.endGame('nobody-hid');
    }

    endGame(reason) {
      const hs = this.hiders;
      const foundCount = hs.filter((p) => p.found && p.foundBy).length;
      const winner = hs.length === 0 ? 'nobody' : foundCount === hs.length ? 'seekers' : 'hiders';
      this.emit('*', 'game:results', { reason, winner, foundCount, hiderCount: hs.length });
      this.setPhase(PHASE.RESULTS, 0);
    }

    /* ── membership ── */
    join(id, { name, role } = {}) {
      if (this.players.size >= LIMITS.maxPlayers) return this.fail(id, 'Room is full.');
      this.players.set(id, { id, name: cleanName(name), role: role === ROLE.SEEKER ? ROLE.SEEKER : ROLE.HIDER, ready: false, hidden: null, found: false, foundBy: null, foundAt: null });
      this.emit(id, 'room:joined', { code: this.code, id });
      this.broadcast();
      return { ok: true };
    }

    leave(id) {
      if (!this.players.delete(id)) return;
      if (this.empty) { this.dispose(); return; }
      if (this.hostId === id) this.hostId = this.players.keys().next().value;
      // If the last unready / unfound hider leaves mid-round, resolve the round.
      if (this.phase === PHASE.HIDE && this.hiders.length && this.hiders.every((p) => p.ready)) this.startSeek('all-ready');
      else if (this.phase === PHASE.SEEK && this.hiders.every((p) => p.found)) this.endGame('all-found');
      else this.broadcast();
    }

    /* ── actions: returns an ack result ── */
    handle(id, event, payload = {}) {
      const p = this.players.get(id);
      if (!p) return { ok: false };
      payload = payload && typeof payload === 'object' ? payload : {};
      switch (event) {
        case 'player:role':
          if (this.phase !== PHASE.LOBBY) return { ok: false };
          p.role = payload.role === ROLE.SEEKER ? ROLE.SEEKER : ROLE.HIDER;
          this.broadcast(); return { ok: true };

        case 'player:name':
          p.name = cleanName(payload.name); this.broadcast(); return { ok: true };

        case 'room:settings': {
          if (this.hostId !== id || this.phase !== PHASE.LOBBY) return { ok: false };
          const clamp = (v, [lo, hi], d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);
          this.settings.hideSeconds = clamp(payload.hideSeconds, LIMITS.hideSeconds, this.settings.hideSeconds);
          this.settings.seekSeconds = clamp(payload.seekSeconds, LIMITS.seekSeconds, this.settings.seekSeconds);
          this.broadcast(); return { ok: true };
        }

        case 'game:start':
          if (this.hostId !== id) return this.fail(id, 'Only the host can start.');
          if (this.phase !== PHASE.LOBBY && this.phase !== PHASE.RESULTS) return { ok: false };
          if (this.hiders.length === 0) return this.fail(id, 'You need at least one hider.');
          if (this.seekers.length === 0) return this.fail(id, 'You need at least one seeker.');
          this.startHide(); return { ok: true };

        case 'hider:ready': {
          if (this.phase !== PHASE.HIDE || p.role !== ROLE.HIDER) return { ok: false };
          const hidden = sanitizeHidden(payload);
          if (!hidden) return this.fail(id, 'Invalid hiding spot data.');
          p.hidden = hidden; p.ready = true;
          if (this.hiders.every((h) => h.ready)) this.startSeek('all-ready'); else this.broadcast();
          return { ok: true };
        }

        case 'hider:unready':
          if (this.phase !== PHASE.HIDE || p.role !== ROLE.HIDER) return { ok: false };
          p.ready = false; this.broadcast(); return { ok: true };

        case 'seeker:found': {
          if (this.phase !== PHASE.SEEK || p.role !== ROLE.SEEKER) return { ok: false };
          const t = this.players.get(payload.targetId);
          if (!t || t.role !== ROLE.HIDER || !t.hidden || t.found) return { ok: false };
          t.found = true; t.foundBy = id; t.foundAt = Date.now();
          this.emit('*', 'player:found', { targetId: t.id, targetName: t.name, seekerId: p.id, seekerName: p.name, at: t.foundAt });
          if (this.hiders.every((h) => h.found)) this.endGame('all-found'); else this.broadcast();
          return { ok: true };
        }

        case 'game:reset':
          if (this.hostId !== id) return { ok: false };
          this.resetPlayers(); this.setPhase(PHASE.LOBBY, 0); return { ok: true };

        default:
          return { ok: false };
      }
    }
  }

  return { GameRoom, PHASE, ROLE, LIMITS, makeCode, cleanName, sanitizeHidden };
});
