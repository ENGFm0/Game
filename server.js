'use strict';

/**
 * Meccha — WebAR Multiplayer Hide & Seek
 * Backend: Express static host + Socket.io game server.
 *
 *   npm install
 *   npm start                  → http://localhost:3000  (Glitch/Replit/Render terminate HTTPS for you)
 *   npm run certs && npm start → https://localhost:3000 (self-signed, for phones on your LAN)
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const express = require('express');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const PHASE = { LOBBY: 'lobby', HIDE: 'hide', SEEK: 'seek', RESULTS: 'results' };
const ROLE = { HIDER: 'hider', SEEKER: 'seeker' };
const LIMITS = { hideSeconds: [20, 600], seekSeconds: [20, 900], maxPlayers: 12, textureBytes: 120 * 1024 };

/* ───────────────────────── HTTP(S) server ───────────────────────── */
const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/api/health', (_req, res) => res.json({ ok: true, rooms: rooms.size, uptime: process.uptime() }));

function createServer() {
  const keyPath = path.join(__dirname, 'certs', 'key.pem');
  const certPath = path.join(__dirname, 'certs', 'cert.pem');
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { server: https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, app), secure: true };
  }
  return { server: http.createServer(app), secure: false };
}
const { server, secure } = createServer();
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 1e6, pingTimeout: 30000 });

/* ───────────────────────── Room state ───────────────────────── */
/** @type {Map<string, object>} */
const rooms = new Map();

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode() {
  let code;
  do { code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join(''); }
  while (rooms.has(code));
  return code;
}

function createRoom(hostId) {
  const room = {
    code: makeCode(),
    hostId,
    phase: PHASE.LOBBY,
    phaseEndsAt: null,
    settings: { hideSeconds: 90, seekSeconds: 180 },
    players: new Map(),
    timer: null,
    createdAt: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

function cleanName(name) {
  const n = String(name || '').replace(/[\x00-\x1f<>]/g, '').trim().slice(0, 16);
  return n || 'Player';
}

function hiders(room) { return [...room.players.values()].filter((p) => p.role === ROLE.HIDER); }
function seekers(room) { return [...room.players.values()].filter((p) => p.role === ROLE.SEEKER); }

/** What each client is allowed to see. Hidden positions are only revealed in the seek/results phases. */
function publicRoom(room) {
  const reveal = room.phase === PHASE.SEEK || room.phase === PHASE.RESULTS;
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    phaseEndsAt: room.phaseEndsAt,
    settings: room.settings,
    serverNow: Date.now(),
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      ready: p.ready,
      placed: !!p.hidden,
      found: p.found,
      foundBy: p.foundBy,
      foundAt: p.foundAt,
      hidden: reveal ? p.hidden : null,
    })),
  };
}

function broadcast(room) { io.to(room.code).emit('room:state', publicRoom(room)); }

function clearTimer(room) { if (room.timer) { clearTimeout(room.timer); room.timer = null; } }

function setPhase(room, phase, seconds) {
  clearTimer(room);
  room.phase = phase;
  room.phaseEndsAt = seconds ? Date.now() + seconds * 1000 : null;
  if (seconds) {
    room.timer = setTimeout(() => {
      if (!rooms.has(room.code)) return;
      if (room.phase === PHASE.HIDE) startSeek(room, 'time');
      else if (room.phase === PHASE.SEEK) endGame(room, 'time');
    }, seconds * 1000 + 250);
  }
  io.to(room.code).emit('game:phase', { phase, endsAt: room.phaseEndsAt, serverNow: Date.now() });
  broadcast(room);
}

function startHide(room) {
  for (const p of room.players.values()) { p.ready = false; p.hidden = null; p.found = false; p.foundBy = null; p.foundAt = null; }
  setPhase(room, PHASE.HIDE, room.settings.hideSeconds);
}

function startSeek(room, reason) {
  // Hiders who never placed themselves count as found (they are not in the room).
  for (const p of hiders(room)) if (!p.hidden) { p.found = true; p.foundBy = null; p.foundAt = Date.now(); }
  io.to(room.code).emit('game:seekStart', { reason });
  setPhase(room, PHASE.SEEK, room.settings.seekSeconds);
  if (hiders(room).every((p) => p.found)) endGame(room, 'nobody-hid');
}

function endGame(room, reason) {
  const hs = hiders(room);
  const foundCount = hs.filter((p) => p.found && p.foundBy).length;
  const winner = hs.length === 0 ? 'nobody' : foundCount === hs.length ? 'seekers' : 'hiders';
  io.to(room.code).emit('game:results', { reason, winner, foundCount, hiderCount: hs.length });
  setPhase(room, PHASE.RESULTS, 0);
}

function deleteRoom(room) { clearTimer(room); rooms.delete(room.code); }

/** Validates the payload a hider sends when they lock their position. */
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

/* ───────────────────────── Socket handlers ───────────────────────── */
io.on('connection', (socket) => {
  let room = null;

  const me = () => (room ? room.players.get(socket.id) : null);
  const fail = (message) => socket.emit('error:msg', { message });

  function leaveRoom() {
    if (!room) return;
    const r = room;
    r.players.delete(socket.id);
    socket.leave(r.code);
    room = null;
    if (r.players.size === 0) { deleteRoom(r); return; }
    if (r.hostId === socket.id) r.hostId = r.players.keys().next().value;
    // If the last unready hider / unfound hider leaves mid-game, resolve the round.
    if (r.phase === PHASE.HIDE && hiders(r).length && hiders(r).every((p) => p.ready)) startSeek(r, 'all-ready');
    else if (r.phase === PHASE.SEEK && hiders(r).every((p) => p.found)) endGame(r, 'all-found');
    else broadcast(r);
  }

  function joinRoom(r, name, role) {
    if (r.players.size >= LIMITS.maxPlayers) return fail('Room is full.');
    room = r;
    r.players.set(socket.id, { id: socket.id, name: cleanName(name), role: role === ROLE.SEEKER ? ROLE.SEEKER : ROLE.HIDER, ready: false, hidden: null, found: false, foundBy: null, foundAt: null });
    socket.join(r.code);
    socket.emit('room:joined', { code: r.code, id: socket.id });
    broadcast(r);
  }

  socket.on('room:create', ({ name, role } = {}) => {
    leaveRoom();
    joinRoom(createRoom(socket.id), name, role);
  });

  socket.on('room:join', ({ code, name, role } = {}) => {
    const r = rooms.get(String(code || '').trim().toUpperCase());
    if (!r) return fail('Room not found. Check the code.');
    leaveRoom();
    joinRoom(r, name, role);
  });

  socket.on('room:leave', () => leaveRoom());

  socket.on('player:role', ({ role } = {}) => {
    const p = me();
    if (!p || room.phase !== PHASE.LOBBY) return;
    p.role = role === ROLE.SEEKER ? ROLE.SEEKER : ROLE.HIDER;
    broadcast(room);
  });

  socket.on('player:name', ({ name } = {}) => {
    const p = me();
    if (!p) return;
    p.name = cleanName(name);
    broadcast(room);
  });

  socket.on('room:settings', ({ hideSeconds, seekSeconds } = {}) => {
    if (!room || room.hostId !== socket.id || room.phase !== PHASE.LOBBY) return;
    const clamp = (v, [lo, hi], d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);
    room.settings.hideSeconds = clamp(hideSeconds, LIMITS.hideSeconds, room.settings.hideSeconds);
    room.settings.seekSeconds = clamp(seekSeconds, LIMITS.seekSeconds, room.settings.seekSeconds);
    broadcast(room);
  });

  socket.on('game:start', () => {
    if (!room || room.hostId !== socket.id) return fail('Only the host can start.');
    if (room.phase !== PHASE.LOBBY && room.phase !== PHASE.RESULTS) return;
    if (hiders(room).length === 0) return fail('You need at least one hider.');
    if (seekers(room).length === 0) return fail('You need at least one seeker.');
    startHide(room);
  });

  /** Hider locks position + camouflage. */
  socket.on('hider:ready', (payload = {}) => {
    const p = me();
    if (!p || room.phase !== PHASE.HIDE || p.role !== ROLE.HIDER) return;
    const hidden = sanitizeHidden(payload);
    if (!hidden) return fail('Invalid hiding spot data.');
    p.hidden = hidden;
    p.ready = true;
    if (hiders(room).every((h) => h.ready)) startSeek(room, 'all-ready');
    else broadcast(room);
  });

  socket.on('hider:unready', () => {
    const p = me();
    if (!p || room.phase !== PHASE.HIDE || p.role !== ROLE.HIDER) return;
    p.ready = false;
    broadcast(room);
  });

  /** Seeker tapped an avatar. */
  socket.on('seeker:found', ({ targetId } = {}, ack) => {
    const reply = (r) => { if (typeof ack === 'function') ack(r); };
    const p = me();
    if (!p || room.phase !== PHASE.SEEK || p.role !== ROLE.SEEKER) return reply({ ok: false });
    const t = room.players.get(targetId);
    if (!t || t.role !== ROLE.HIDER || !t.hidden || t.found) return reply({ ok: false });
    t.found = true; t.foundBy = socket.id; t.foundAt = Date.now();
    io.to(room.code).emit('player:found', { targetId: t.id, targetName: t.name, seekerId: p.id, seekerName: p.name, at: t.foundAt });
    reply({ ok: true });
    if (hiders(room).every((h) => h.found)) endGame(room, 'all-found');
    else broadcast(room);
  });

  socket.on('game:reset', () => {
    if (!room || room.hostId !== socket.id) return;
    for (const p of room.players.values()) { p.ready = false; p.hidden = null; p.found = false; p.foundBy = null; p.foundAt = null; }
    setPhase(room, PHASE.LOBBY, 0);
  });

  socket.on('disconnect', () => leaveRoom());
});

/* Drop stale empty rooms (defensive; empty rooms are normally deleted immediately). */
setInterval(() => {
  const cutoff = Date.now() - 6 * 3600 * 1000;
  for (const r of rooms.values()) if (r.createdAt < cutoff && r.players.size === 0) deleteRoom(r);
}, 10 * 60 * 1000).unref();

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Meccha Hide & Seek running on ${secure ? 'https' : 'http'}://localhost:${PORT}`);
    if (!secure) console.log('Tip: phones need HTTPS for the camera. Run `npm run certs` for a local certificate, or host on Glitch/Replit/Render.');
  });
}

module.exports = { app, server, io, rooms };
